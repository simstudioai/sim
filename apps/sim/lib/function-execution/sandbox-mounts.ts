import { createLogger } from '@sim/logger'
import {
  assertUserFileContentAccess,
  type ExecutionMaterializationContext,
  readUserFileContentWithContributors,
} from '@/lib/execution/payloads/materialization.server'
import { MAX_SANDBOX_URL_MOUNT_BYTES } from '@/lib/execution/remote-sandbox/output-limits'
import { SANDBOX_INPUT_DIR } from '@/lib/execution/remote-sandbox/sandbox-paths'
import type { SandboxFile } from '@/lib/execution/remote-sandbox/types'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'
import { generatePresignedDownloadUrl, hasCloudStorage } from '@/lib/uploads/core/storage-service'
import type { StorageContext } from '@/lib/uploads/shared/types'
import {
  isGeneratedDocumentSourceType,
  resolveTrustedFileContext,
} from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'

const logger = createLogger('SandboxMounts')

/**
 * Lifetime of a presigned URL handed to the sandbox to fetch a mounted object.
 * The URL grants read to exactly that one object and dies with the sandbox.
 *
 * Sized well past the worst provisioning path rather than the typical one: a
 * runtime-strategy sandbox can spend up to RUNTIME_INSTALL_TIMEOUT_MS installing
 * dependencies, and only then does the in-sandbox `curl` start its own 300s
 * window. At the previous 600s the URL could expire mid-download and surface as
 * an opaque "failed to fetch mounted file".
 */
export const MOUNT_URL_TTL_SECONDS = 1800

/**
 * Per-file ceiling for URL-mounted files, shared with the sandbox layer that
 * enforces it on the transferred bytes so the pre-check and the backstop can
 * never drift apart.
 */
export const MOUNT_URL_MAX_BYTES = MAX_SANDBOX_URL_MOUNT_BYTES

/**
 * Aggregate ceiling across all URL mounts in one request. Rejects an oversized
 * request up front instead of filling the sandbox disk one slow fetch at a time.
 */
export const MAX_TOTAL_URL_BYTES = 2 * 1024 * 1024 * 1024

/** Per-file ceiling when bytes must pass through the web process. */
export const MAX_INLINE_MOUNT_FILE_BYTES = 10 * 1024 * 1024

/** Aggregate ceiling for buffered mounts, bounding web heap rather than disk. */
export const MAX_INLINE_MOUNT_TOTAL_BYTES = 50 * 1024 * 1024

/**
 * Running byte totals for one resolve pass. `buffered` bytes pass through the web
 * process; `url` bytes are fetched straight into the sandbox. Tracked separately
 * because the two ceilings protect different resources — web heap vs sandbox disk.
 */
export interface SandboxMountBudget {
  buffered: number
  url: number
}

export function createSandboxMountBudget(): SandboxMountBudget {
  return { buffered: 0, url: 0 }
}

/** One object to mount, independent of how the caller located it. */
export interface SandboxMountSource {
  mountPath: string
  key: string
  storageContext: StorageContext
  /** Size recorded for the stored object, used for the pre-read ceilings. */
  declaredSize: number
  /**
   * True when `key` holds generator source rather than the servable bytes. Such
   * an object must never be presigned: the sandbox would receive source text
   * under a `.docx` name and the caller's script would fail on a file that looks
   * fine. It also means {@link declaredSize} describes the generator, not the
   * document, so the pre-read ceilings say nothing and the read is capped instead.
   */
  rendersFromSource: boolean
  /**
   * Bounded read producing the inline payload. Only called on the buffered
   * branch, so a URL mount never reads bytes into the web process.
   */
  readInline(maxBytes: number): Promise<SandboxInlineMountPayload>
}

export interface SandboxInlineMountPayload {
  content: string
  encoding?: 'base64'
  /** Decoded length, which is what the buffered budget counts. */
  byteLength: number
}

/**
 * Mounts one stored object into the sandbox and records its bytes against the
 * running totals.
 *
 * With cloud storage the sandbox fetches the bytes itself from a presigned URL;
 * with local storage a presigned URL is an app-internal serve path a remote
 * sandbox cannot reach, so the bytes are buffered through the web process under
 * the tighter inline ceilings.
 */
export async function pushSandboxFileMount(
  sandboxFiles: SandboxFile[],
  source: SandboxMountSource,
  budget: SandboxMountBudget
): Promise<void> {
  if (hasCloudStorage() && !source.rendersFromSource) {
    if (source.declaredSize > MOUNT_URL_MAX_BYTES) {
      throw new Error(
        `Input file "${source.mountPath}" is ${Math.round(source.declaredSize / 1024 / 1024)}MB, over the ${MOUNT_URL_MAX_BYTES / 1024 / 1024}MB per-file mount limit.`
      )
    }
    if (budget.url + source.declaredSize > MAX_TOTAL_URL_BYTES) {
      throw new Error(
        `Mounting "${source.mountPath}" would exceed the ${MAX_TOTAL_URL_BYTES / 1024 / 1024 / 1024}GB total mount limit. Mount fewer or smaller files.`
      )
    }
    const url = await generatePresignedDownloadUrl(
      source.key,
      source.storageContext,
      MOUNT_URL_TTL_SECONDS
    )
    // The checks above run on the size the record reported; this caps what the
    // sandbox will actually accept, so an understated size cannot pull down an
    // object larger than the per-file limit.
    sandboxFiles.push({
      type: 'url',
      path: source.mountPath,
      url,
      maxBytes: MOUNT_URL_MAX_BYTES,
    })
    budget.url += source.declaredSize
    return
  }

  const remainingBudget = Math.max(0, MAX_INLINE_MOUNT_TOTAL_BYTES - budget.buffered)

  if (!source.rendersFromSource) {
    if (source.declaredSize > MAX_INLINE_MOUNT_FILE_BYTES) {
      throw new Error(
        `Input file "${source.mountPath}" is ${Math.round(source.declaredSize / 1024 / 1024)}MB, over the ${MAX_INLINE_MOUNT_FILE_BYTES / 1024 / 1024}MB per-file mount limit.`
      )
    }
    if (source.declaredSize > remainingBudget) {
      throw new Error(
        `Mounting "${source.mountPath}" would exceed the ${MAX_INLINE_MOUNT_TOTAL_BYTES / 1024 / 1024}MB total mount limit. Mount fewer or smaller files.`
      )
    }
  }

  const inline = await source.readInline(Math.min(MAX_INLINE_MOUNT_FILE_BYTES, remainingBudget))
  sandboxFiles.push({
    path: source.mountPath,
    content: inline.content,
    ...(inline.encoding ? { encoding: inline.encoding } : {}),
  })
  budget.buffered += inline.byteLength
}

export interface PlannedUserFileMount {
  userFile: UserFile
  mountPath: string
}

/** What the running code is told about its mounts, so it never guesses a path. */
export interface SandboxMountManifestEntry {
  name: string
  path: string
  size: number
  type: string
}

/**
 * Derives a mount file name that is safe as a path segment.
 *
 * `sanitizeFileName` (via {@link buildStorageKeySegment}) already maps `/` and
 * `\` to `_`, so no traversal survives it; the explicit guards cover the
 * degenerate remainders it does leave intact, since `.` and `-` are permitted
 * characters and `..` would otherwise pass through unchanged.
 */
function safeMountFileName(name: string): string {
  const segment = buildStorageKeySegment('', name)
  if (!segment || segment === '.' || segment === '..') return 'file'
  return segment
}

function uniqueMountFileName(name: string, used: Set<string>): string {
  const safe = safeMountFileName(name)
  if (!used.has(safe)) {
    used.add(safe)
    return safe
  }
  // Two upstream blocks each producing `report.csv` must both survive: without a
  // suffix the second write silently overwrites the first and the code sees one file.
  const dot = safe.lastIndexOf('.')
  const stem = dot > 0 ? safe.slice(0, dot) : safe
  const extension = dot > 0 ? safe.slice(dot) : ''
  for (let attempt = 2; ; attempt += 1) {
    const candidate = `${stem}-${attempt}${extension}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

/**
 * Assigns each file a deterministic mount path. Pure and I/O-free, so a caller
 * can decide whether an execution needs a sandbox filesystem before spending a
 * presign or a byte of transfer on a request that may still be refused.
 */
export function planUserFileMounts(
  files: readonly UserFile[],
  mountDir: string = SANDBOX_INPUT_DIR
): PlannedUserFileMount[] {
  const used = new Set<string>()
  return files.map((userFile) => ({
    userFile,
    mountPath: `${mountDir}/${uniqueMountFileName(userFile.name, used)}`,
  }))
}

/**
 * Resolves planned platform file objects into sandbox mounts.
 *
 * Authorization runs through {@link assertUserFileContentAccess} rather than the
 * tool-file check used by ordinary integrations. For an `execution/` key the
 * latter grants on workspace membership alone, which would let a Function block
 * mount any execution file from any past run of any workflow in the workspace;
 * this one additionally requires the workflow to match and the key to be in the
 * execution's allowlist. It is asserted before the transport branches, because
 * the URL path never reads the bytes and so never reaches the check embedded in
 * the reader.
 */
export async function resolveUserFileMounts(args: {
  planned: readonly PlannedUserFileMount[]
  context: ExecutionMaterializationContext
}): Promise<{ sandboxFiles: SandboxFile[]; manifest: SandboxMountManifestEntry[] }> {
  const sandboxFiles: SandboxFile[] = []
  const manifest: SandboxMountManifestEntry[] = []
  const budget = createSandboxMountBudget()

  for (const { userFile, mountPath } of args.planned) {
    const storageContext = resolveTrustedFileContext(userFile.key, userFile.context)
    await assertUserFileContentAccess(userFile, args.context)

    await pushSandboxFileMount(
      sandboxFiles,
      {
        mountPath,
        key: userFile.key,
        storageContext,
        declaredSize: userFile.size,
        rendersFromSource: isGeneratedDocumentSourceType(userFile.type),
        readInline: async (maxBytes) => {
          // Base64 regardless of content type: the payload is reproduced exactly
          // for any byte sequence, and picking utf8 for a mistyped binary would
          // substitute U+FFFD and hand the code a corrupted file.
          const { content } = await readUserFileContentWithContributors(userFile, {
            ...args.context,
            encoding: 'base64',
            maxBytes,
            maxSourceBytes: maxBytes,
          })
          return {
            content,
            encoding: 'base64' as const,
            byteLength: Buffer.byteLength(content, 'base64'),
          }
        },
      },
      budget
    )

    manifest.push({
      name: userFile.name,
      path: mountPath,
      size: userFile.size,
      type: userFile.type,
    })
  }

  logger.info('Resolved sandbox file mounts', {
    mountCount: sandboxFiles.length,
    bufferedBytes: budget.buffered,
    urlBytes: budget.url,
  })

  return { sandboxFiles, manifest }
}
