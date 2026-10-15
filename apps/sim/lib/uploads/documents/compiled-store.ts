import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { z } from 'zod'
import { assertKnownSizeWithinLimit, isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type { WorkspaceFileSecretProvenanceIdentity } from '@/lib/uploads/contexts/workspace/file-secret-provenance'
import { isObjectNotFoundError } from '@/lib/uploads/core/errors'
import { downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { OWNED_FILE_CONTEXTS } from '@/lib/workspace-files/owned-files'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'

const logger = createLogger('CopilotDocCompiledStore')

export const COMPILED_PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])
export const COMPILED_ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])

/**
 * Compiled-artifact store for Python-generated documents.
 *
 * The Python doc path keeps the SOURCE as the primary file (the agent reads and
 * edits it exactly like the JS path). The compiled binary is stored as its own
 * S3 object, content-addressed by (owner, sha256(source + referenced-input identity), ext) —
 * the hash is in the key, so source or referenced-file content changes invalidate the artifact. Every read path
 * (serve, preview, /compiled) loads the artifact for the current source hash and
 * recompiles only when it is absent. No fileId in the key means any site with
 * the source (e.g. the serve route) can find it. S3 is cheap; stale artifacts
 * are inert.
 */
export function compiledArtifactKey(
  owner: string | EditableFileOwner,
  source: string,
  ext: string,
  referencedInputIdentity?: string
): string {
  const cacheInput = referencedInputIdentity
    ? JSON.stringify({ version: 1, source, referencedInputIdentity })
    : source
  const hash = createHash('sha256').update(cacheInput, 'utf-8').digest('hex')
  return typeof owner === 'string' || owner.entityType === 'workspace'
    ? `copilot-doc-compiled/${typeof owner === 'string' ? owner : owner.entityId}/${hash}.${ext}`
    : `project/${owner.entityId}/compiled/${hash}.${ext}`
}

function publishedArtifactPointerKey(
  owner: string | EditableFileOwner,
  source: string,
  ext: string
): string {
  const sourceHash = createHash('sha256').update(source, 'utf-8').digest('hex')
  return publishedArtifactPointerKeyFromHash(owner, sourceHash, ext)
}

function publishedArtifactPointerKeyFromHash(
  owner: string | EditableFileOwner,
  sourceHash: string,
  ext: string
): string {
  return typeof owner === 'string' || owner.entityType === 'workspace'
    ? `copilot-doc-compiled/${typeof owner === 'string' ? owner : owner.entityId}/${sourceHash}.${ext}.published.json`
    : `project/${owner.entityId}/compiled/${sourceHash}.${ext}.published.json`
}

export interface CompiledDocReadOptions {
  maxBytes?: number
  signal?: AbortSignal
}

interface PublishedArtifactPointer {
  version: 1
  referencedInputIdentity: string
}

async function loadPublishedArtifactPointer(
  key: string,
  options: CompiledDocReadOptions = {}
): Promise<PublishedArtifactPointer | null> {
  options.signal?.throwIfAborted()
  let encoded: Buffer
  try {
    encoded = await downloadFile({
      key,
      context: key.startsWith('project/') ? 'project' : 'copilot',
      maxBytes: Math.min(
        options.maxBytes ?? MAX_BUFFERED_TRANSFER_BYTES,
        MAX_BUFFERED_TRANSFER_BYTES
      ),
      signal: options.signal,
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    if (isObjectNotFoundError(error)) return null
    throw error
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(encoded.toString('utf-8'))
  } catch {
    throw new Error(`Published compiled document pointer is malformed: ${key}`)
  }
  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    !('version' in decoded) ||
    decoded.version !== 1 ||
    !('referencedInputIdentity' in decoded) ||
    typeof decoded.referencedInputIdentity !== 'string' ||
    !decoded.referencedInputIdentity
  ) {
    throw new Error(`Published compiled document pointer is invalid: ${key}`)
  }
  return { version: 1, referencedInputIdentity: decoded.referencedInputIdentity }
}

/**
 * Loads the compiled binary for the current source, or null if not yet built.
 *
 * The artifact is what a download or a public share actually serves, and it is read
 * separately from the source — so a source that cleared its own ceiling says nothing
 * about the size of this. Bounding it here rather than on the finished response is
 * what keeps an oversized artifact from being materialized before it is refused.
 *
 * The default is the widest ceiling consumers allow. Callers can tighten it before
 * downloading, so indexing does not materialize an artifact it will immediately reject.
 *
 * A size breach is rethrown rather than folded into `null`: null means "not built
 * yet", which callers answer with "still being prepared, try again", and an artifact
 * that is too large would retry forever behind that.
 */
export async function loadCompiledDoc(
  owner: string | EditableFileOwner,
  source: string,
  ext: string,
  referencedInputIdentity?: string,
  options: CompiledDocReadOptions = {}
): Promise<Buffer | null> {
  const key = compiledArtifactKey(owner, source, ext, referencedInputIdentity)
  try {
    return await downloadFile({
      key,
      context: key.startsWith('project/') ? 'project' : 'copilot',
      maxBytes: Math.min(
        options.maxBytes ?? MAX_BUFFERED_TRANSFER_BYTES,
        MAX_BUFFERED_TRANSFER_BYTES
      ),
      signal: options.signal,
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    if (isPayloadSizeLimitError(error)) throw error
    return null
  }
}

/**
 * Publishes the exact dependency-bound artifact that was produced under an authorized Principal.
 * Public shares consume this pointer without gaining authority to read the referenced workspace
 * files or compile arbitrary source themselves.
 */
export async function publishCompiledDocArtifact(
  owner: string | EditableFileOwner,
  source: string,
  ext: string,
  referencedInputIdentity: string
): Promise<void> {
  if (!referencedInputIdentity) {
    throw new Error('Published compiled document identity must not be empty')
  }
  const key = publishedArtifactPointerKey(owner, source, ext)
  const existing = await loadPublishedArtifactPointer(key)
  if (existing?.referencedInputIdentity === referencedInputIdentity) return
  const pointer: PublishedArtifactPointer = { version: 1, referencedInputIdentity }
  try {
    await uploadFile({
      file: Buffer.from(JSON.stringify(pointer), 'utf-8'),
      fileName: `doc.${ext}.published.json`,
      contentType: 'application/json',
      context: key.startsWith('project/') ? 'project' : 'copilot',
      customKey: key,
      preserveKey: true,
    })
  } catch (error) {
    logger.error('Failed to publish compiled doc artifact', {
      key,
      error: getErrorMessage(error),
    })
    throw toError(error)
  }
}

const publishedInputsSchema = z.object({
  version: z.literal(1),
  inputs: z.array(
    z.object({
      fileId: z.string().min(1),
      key: z.string().min(1),
      context: z.enum(['workspace', 'mothership', 'execution', ...OWNED_FILE_CONTEXTS]),
      contentVersion: z.iso.datetime(),
    })
  ),
})

/**
 * Reads the published artifact's captured input revisions without loading or rebuilding its bytes.
 * Matches public format detection: binaries stop at their header; source is hashed as streamed UTF-8.
 */
export async function loadPublishedCompiledDocInputs(
  workspaceId: string,
  sourceStream: Readable,
  ext: string
): Promise<WorkspaceFileSecretProvenanceIdentity[]> {
  const magic = ext === 'pdf' ? COMPILED_PDF_MAGIC : COMPILED_ZIP_MAGIC
  let prefix = Buffer.alloc(0)
  let total = 0
  const hash = createHash('sha256')
  const decoder = new StringDecoder('utf8')
  for await (const chunk of sourceStream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (prefix.length < magic.length) {
      prefix = Buffer.concat([prefix, bytes.subarray(0, magic.length - prefix.length)])
      if (prefix.equals(magic)) return []
    }
    total += bytes.length
    assertKnownSizeWithinLimit(total, MAX_BUFFERED_TRANSFER_BYTES, 'Compiled document source')
    hash.update(decoder.write(bytes), 'utf8')
  }
  hash.update(decoder.end(), 'utf8')
  const pointer = await loadPublishedArtifactPointer(
    publishedArtifactPointerKeyFromHash(workspaceId, hash.digest('hex'), ext)
  )
  if (!pointer) return []
  let decoded: unknown
  try {
    decoded = JSON.parse(pointer.referencedInputIdentity)
  } catch {
    throw new Error('Published compiled document inputs are malformed')
  }
  const parsed = publishedInputsSchema.safeParse(decoded)
  if (!parsed.success) throw new Error('Published compiled document inputs are invalid')
  return parsed.data.inputs.map(({ fileId, key, context, contentVersion }) => ({
    fileId,
    key,
    context,
    contentUpdatedAt: new Date(contentVersion),
  }))
}

/** Loads an artifact previously published by an authorized compile, or null before cutover. */
export async function loadPublishedCompiledDoc(
  owner: string | EditableFileOwner,
  source: string,
  ext: string,
  options: CompiledDocReadOptions = {}
): Promise<Buffer | null> {
  const key = publishedArtifactPointerKey(owner, source, ext)
  const pointer = await loadPublishedArtifactPointer(key, options)
  if (!pointer) return null
  const artifact = await loadCompiledDoc(
    owner,
    source,
    ext,
    pointer.referencedInputIdentity,
    options
  )
  if (!artifact) throw new Error(`Published compiled document artifact is missing: ${key}`)
  return artifact
}

/**
 * Stores the compiled binary as the source's associated S3 artifact.
 *
 * Throws on failure (does not swallow): the serve route is load-only and cannot
 * self-heal a missing artifact, so a silent store failure would make a write
 * report success while leaving the document unrenderable. Propagating lets the
 * write fail honestly so the caller (and the agent) can retry.
 */
export async function storeCompiledDoc(
  owner: string | EditableFileOwner,
  source: string,
  ext: string,
  contentType: string,
  binary: Buffer,
  referencedInputIdentity?: string
): Promise<void> {
  const key = compiledArtifactKey(owner, source, ext, referencedInputIdentity)
  try {
    await uploadFile({
      file: binary,
      fileName: `doc.${ext}`,
      contentType,
      context: key.startsWith('project/') ? 'project' : 'copilot',
      customKey: key,
      preserveKey: true,
    })
    if (referencedInputIdentity) {
      await publishCompiledDocArtifact(owner, source, ext, referencedInputIdentity)
    }
  } catch (err) {
    logger.error('Failed to store compiled doc artifact', {
      key,
      error: getErrorMessage(err),
    })
    throw toError(err)
  }
}
