import { createHash } from 'node:crypto'
import { getRedisClient } from '@/lib/core/config/redis'
import type {
  SessionFileIdentity,
  SessionFileObserver,
} from '@/lib/execution/remote-sandbox/session-file-observer'
import type { WorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  bindWorkspaceFileUploadProvenance,
  readWorkspaceFileUploadProvenance,
  WORKSPACE_FILE_UPLOAD_PROVENANCE_KEY,
} from '@/lib/uploads/upload-session/workspace-file-provenance'

/** Missing/expired evidence is unknown. Redis is never a source of exact-empty by default. */
const RECEIPT_SECONDS = 24 * 60 * 60
const RECORD_RECEIPT = `
local previous = redis.call('GET', KEYS[1])
local value = ARGV[1]
if previous and previous ~= value then value = ARGV[2] end
redis.call('SET', KEYS[1], value, 'EX', ARGV[3])
return 1
`

interface WorkbenchFileScope {
  workspaceId: string
  userId: string
  sessionKey: string
  signal?: AbortSignal
}

/** One invocation holds only stream references; reusable encrypted evidence lives outside the machine. */
export function createWorkbenchFileProvenance(scope: WorkbenchFileScope) {
  const downloads = new WeakMap<ReadableStream<Uint8Array>, WorkspaceFileSecretProvenance>()
  let uploaded: WorkspaceFileSecretProvenance | undefined
  const key = (machine: SessionFileIdentity, digest: string) => {
    if (!machine.sandboxId) throw new Error('Workbench physical identity is unavailable')
    const namespace = createHash('sha256')
      .update(
        JSON.stringify([
          scope.workspaceId,
          scope.userId,
          scope.sessionKey,
          machine.providerId,
          machine.sandboxId,
        ])
      )
      .digest('hex')
    return `mothership:file-source:v1:${namespace}:${digest}`
  }
  const encoded = (provenance: WorkspaceFileSecretProvenance) =>
    JSON.stringify(bindWorkspaceFileUploadProvenance(scope.workspaceId, provenance))
  const unknown = encoded({ status: 'unknown' })

  const observeDownload: SessionFileObserver = (machine, stream) => {
    const provenance = downloads.get(stream) ?? { status: 'unknown' as const }
    return hashStream(stream, scope.signal, async (digest) => {
      const redis = getRedisClient()
      if (!redis) throw new Error('Workbench file classification storage is unavailable')
      await redis.eval(
        RECORD_RECEIPT,
        1,
        key(machine, digest),
        encoded(provenance),
        unknown,
        RECEIPT_SECONDS
      )
    })
  }
  const observeUpload: SessionFileObserver = (machine, stream) => {
    uploaded = undefined
    return hashStream(stream, scope.signal, async (digest) => {
      const redis = getRedisClient()
      if (!redis) throw new Error('Workbench file classification storage is unavailable')
      const value = await redis.get(key(machine, digest))
      let binding: unknown
      try {
        binding = value ? JSON.parse(value) : undefined
      } catch {
        binding = undefined
      }
      uploaded = readWorkspaceFileUploadProvenance({
        workspaceId: scope.workspaceId,
        metadata: { [WORKSPACE_FILE_UPLOAD_PROVENANCE_KEY]: binding },
      }) ?? { status: 'unknown' }
    })
  }

  return {
    observeDownload,
    observeUpload,
    trackDownload(stream: ReadableStream<Uint8Array>, provenance?: WorkspaceFileSecretProvenance) {
      downloads.set(stream, provenance ?? { status: 'unknown' })
    },
    uploadProvenance(): WorkspaceFileSecretProvenance {
      scope.signal?.throwIfAborted()
      if (!uploaded) throw new Error('Workbench upload source has not finished streaming')
      return uploaded
    },
  }
}

/** Hash in the host as bytes pass; EOF evidence is required before publication or completion. */
function hashStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  complete: (digest: string) => Promise<void>
): ReadableStream<Uint8Array> {
  const hash = createHash('sha256')
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        signal?.throwIfAborted()
        hash.update(chunk)
        controller.enqueue(chunk)
      },
      async flush() {
        signal?.throwIfAborted()
        await complete(hash.digest('hex'))
        signal?.throwIfAborted()
      },
    }),
    signal ? { signal } : {}
  )
}
