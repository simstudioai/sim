import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { downloadFile, headObject, uploadFile } from '@/lib/uploads/core/storage-service'
import { MAX_RENDERED_DOCUMENT_BYTES } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('CopilotDocCompiledStore')

/**
 * Compiled-artifact store for Python-generated documents.
 *
 * The Python doc path keeps the SOURCE as the primary file (the agent reads and
 * edits it exactly like the JS path). The compiled binary is stored as its own
 * S3 object, content-addressed by (workspaceId, sha256(source + referenced-input identity), ext) —
 * the hash is in the key, so source or referenced-file content changes invalidate the artifact. Every read path
 * (serve, preview, /compiled) loads the artifact for the current source hash and
 * recompiles only when it is absent. No fileId in the key means any site with
 * the source (e.g. the serve route) can find it. S3 is cheap; stale artifacts
 * are inert.
 */
function compiledArtifactKey(
  workspaceId: string,
  source: string,
  ext: string,
  referencedInputIdentity?: string
): string {
  const cacheInput = referencedInputIdentity
    ? JSON.stringify({ version: 1, source, referencedInputIdentity })
    : source
  const hash = createHash('sha256').update(cacheInput, 'utf-8').digest('hex')
  return `copilot-doc-compiled/${workspaceId}/${hash}.${ext}`
}

function publishedArtifactPointerKey(workspaceId: string, source: string, ext: string): string {
  const sourceHash = createHash('sha256').update(source, 'utf-8').digest('hex')
  return `copilot-doc-compiled/${workspaceId}/${sourceHash}.${ext}.published.json`
}

interface PublishedArtifactPointer {
  version: 1
  referencedInputIdentity: string
}

async function loadPublishedArtifactPointer(key: string): Promise<PublishedArtifactPointer | null> {
  const stored = await headObject(key, 'copilot')
  if (!stored) return null
  const encoded = await downloadFile({ key, context: 'copilot' })

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
 * A size breach is rethrown rather than folded into `null`: null means "not built
 * yet", which callers answer with "still being prepared, try again", and an artifact
 * that is too large would retry forever behind that.
 */
export async function loadCompiledDoc(
  workspaceId: string,
  source: string,
  ext: string,
  referencedInputIdentity?: string
): Promise<Buffer | null> {
  const key = compiledArtifactKey(workspaceId, source, ext, referencedInputIdentity)
  try {
    return await downloadFile({ key, context: 'copilot', maxBytes: MAX_RENDERED_DOCUMENT_BYTES })
  } catch (error) {
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
  workspaceId: string,
  source: string,
  ext: string,
  referencedInputIdentity: string
): Promise<void> {
  if (!referencedInputIdentity) {
    throw new Error('Published compiled document identity must not be empty')
  }
  const key = publishedArtifactPointerKey(workspaceId, source, ext)
  const existing = await loadPublishedArtifactPointer(key)
  if (existing?.referencedInputIdentity === referencedInputIdentity) return
  const pointer: PublishedArtifactPointer = { version: 1, referencedInputIdentity }
  try {
    await uploadFile({
      file: Buffer.from(JSON.stringify(pointer), 'utf-8'),
      fileName: `doc.${ext}.published.json`,
      contentType: 'application/json',
      context: 'copilot',
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

/** Loads an artifact previously published by an authorized compile, or null before cutover. */
export async function loadPublishedCompiledDoc(
  workspaceId: string,
  source: string,
  ext: string
): Promise<Buffer | null> {
  const key = publishedArtifactPointerKey(workspaceId, source, ext)
  const pointer = await loadPublishedArtifactPointer(key)
  if (!pointer) return null
  const artifact = await loadCompiledDoc(workspaceId, source, ext, pointer.referencedInputIdentity)
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
  workspaceId: string,
  source: string,
  ext: string,
  contentType: string,
  binary: Buffer,
  referencedInputIdentity?: string
): Promise<void> {
  const key = compiledArtifactKey(workspaceId, source, ext, referencedInputIdentity)
  try {
    await uploadFile({
      file: binary,
      fileName: `doc.${ext}`,
      contentType,
      context: 'copilot',
      customKey: key,
      preserveKey: true,
    })
    if (referencedInputIdentity) {
      await publishCompiledDocArtifact(workspaceId, source, ext, referencedInputIdentity)
    }
  } catch (err) {
    logger.error('Failed to store compiled doc artifact', {
      key,
      error: getErrorMessage(err),
    })
    throw toError(err)
  }
}
