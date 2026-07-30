import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import * as Y from 'yjs'
import { getWorkspaceFile, updateWorkspaceFileContent } from '@/lib/uploads/contexts/workspace'
import { hashMarkdown, saveCollabDocState } from './collab-state'
import { yDocToFileMarkdown } from './converter'

const logger = createLogger('FileDocPersist')

/**
 * Project a live collaborative document back to durable markdown and write it to the file. This is the
 * server-authoritative durable path — the realtime relay owns the live Yjs doc but not the conversion
 * engine or blob/DB access, so it ships the doc state here and the app persists it. Called debounced
 * while the doc is being edited and when the last collaborator leaves; it replaces the editor's
 * client-side autosave, so a copilot (or any server) edit can never be clobbered by a stale keystroke
 * saving over it.
 *
 * Returns `false` when the file is genuinely absent (deleted) — nothing to write. Any other failure
 * (conversion / blob / DB) THROWS so the caller surfaces a non-2xx and can retry on the next debounce.
 *
 * `userId` is attribution only (blob metadata) — the last collaborator to touch the doc; the caller is
 * already trusted via the internal `x-api-key` gate, so this does not re-authorize.
 */
export async function persistFileDoc(
  workspaceId: string,
  fileId: string,
  userId: string,
  docState: Uint8Array
): Promise<boolean> {
  const record = await getWorkspaceFile(workspaceId, fileId, { throwOnError: true })
  if (!record) return false

  const ydoc = new Y.Doc()
  let markdownBuffer: Buffer
  try {
    Y.applyUpdate(ydoc, docState)
    markdownBuffer = Buffer.from(yDocToFileMarkdown(ydoc), 'utf-8')
  } finally {
    ydoc.destroy()
  }

  // `syncLiveDoc: false`: this write IS the projection of the live doc back to markdown, so merging it
  // back into that same doc would be a persist → merge → persist self-loop. The doc already holds this
  // exact content; peers are already converged through the relay.
  await updateWorkspaceFileContent(workspaceId, fileId, userId, markdownBuffer, undefined, {
    syncLiveDoc: false,
  })

  // Cache the Yjs binary (tagged with the exact markdown just written) so a later cold room open loads
  // it directly instead of re-converting markdown → Yjs. Best-effort: the markdown IS the durable file,
  // so a cache failure only means the next cold open re-converts — never lost data.
  try {
    await saveCollabDocState(fileId, docState, hashMarkdown(markdownBuffer))
  } catch (error) {
    logger.warn(`Failed to cache collab doc state for file ${fileId}`, {
      error: getErrorMessage(error),
    })
  }

  logger.info(`Persisted live collaborative document to file ${fileId} (workspace ${workspaceId})`)
  return true
}
