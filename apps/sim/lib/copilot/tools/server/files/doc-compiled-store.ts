import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'

const logger = createLogger('CopilotDocCompiledStore')

/**
 * Compiled-artifact store for Python-generated documents.
 *
 * The Python doc path keeps the SOURCE as the primary file (the agent reads and
 * edits it exactly like the JS path). The compiled binary is stored as its own
 * S3 object, content-addressed by (workspaceId, sha256(source), ext) — the hash
 * is in the key, so when the source changes the key changes. Every read path
 * (serve, preview, /compiled) loads the artifact for the current source hash and
 * recompiles only when it is absent. No fileId in the key means any site with
 * the source (e.g. the serve route) can find it. S3 is cheap; stale artifacts
 * are inert.
 */
function compiledArtifactKey(workspaceId: string, source: string, ext: string): string {
  const hash = createHash('sha256').update(source, 'utf-8').digest('hex')
  return `copilot-doc-compiled/${workspaceId}/${hash}.${ext}`
}

/** Loads the compiled binary for the current source, or null if not yet built. */
export async function loadCompiledDoc(
  workspaceId: string,
  source: string,
  ext: string
): Promise<Buffer | null> {
  const key = compiledArtifactKey(workspaceId, source, ext)
  try {
    return await downloadFile({ key, context: 'copilot' })
  } catch {
    return null
  }
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
  binary: Buffer
): Promise<void> {
  const key = compiledArtifactKey(workspaceId, source, ext)
  try {
    await uploadFile({
      file: binary,
      fileName: `doc.${ext}`,
      contentType,
      context: 'copilot',
      customKey: key,
      preserveKey: true,
    })
  } catch (err) {
    logger.error('Failed to store compiled doc artifact', {
      key,
      error: getErrorMessage(err),
    })
    throw toError(err)
  }
}
