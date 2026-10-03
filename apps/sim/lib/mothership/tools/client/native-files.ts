import type {
  DesktopLocalFileManifest,
  DesktopLocalFileRequest,
  DesktopLocalFileResponse,
} from '@sim/desktop-bridge'
import { MAX_DESKTOP_IMPORT_FILE_BYTES } from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  createWorkspaceFileFolderContract,
  listWorkspaceFileFoldersContract,
} from '@/lib/api/contracts/workspace-file-folders'
import { getDesktopBridge } from '@/lib/desktop'
import { ASYNC_TOOL_CONFIRMATION_STATUS } from '@/lib/mothership/async-runs/lifecycle'
import {
  reportClientToolCompletion,
  reportClientToolCompletionOnPageExit,
} from '@/lib/mothership/tools/client/completion'
import { uploadWorkspaceFileSession } from '@/lib/uploads/client/session-upload'

const logger = createLogger('DesktopLocalFiles')

async function invoke(
  request: DesktopLocalFileRequest,
  signal?: AbortSignal
): Promise<DesktopLocalFileResponse> {
  signal?.throwIfAborted()
  const bridge = getDesktopBridge()
  if (!bridge?.localFiles) throw new Error('Update the Sim desktop app to use native file tools.')
  const response = await bridge.localFiles(request)
  signal?.throwIfAborted()
  return response
}

interface ImportedFile {
  id: string
  name: string
  relativePath: string
}
interface ImportedFolder {
  id: string
  relativePath: string
}

/** The manifest is produced from canonical pending-tool arguments in Electron, never renderer paths. */
export async function importNativeFiles(
  toolCallId: string,
  manifest: DesktopLocalFileManifest,
  signal?: AbortSignal
) {
  const files: ImportedFile[] = []
  const folders: ImportedFolder[] = []
  const parents = new Map<string, string | undefined>([['', manifest.folderId]])
  try {
    if (
      manifest.entries.some(
        (entry) => entry.kind === 'file' && entry.size > MAX_DESKTOP_IMPORT_FILE_BYTES
      )
    )
      throw new Error(
        'Desktop imports support files up to 64 MB. Use the file uploader for larger files.'
      )
    for (const entry of manifest.entries) {
      signal?.throwIfAborted()
      const segments = entry.relativePath.split('/').filter(Boolean)
      const name = segments.at(-1) ?? manifest.name
      const parentPath = segments.slice(0, -1).join('/')
      const parentId = entry.relativePath === '' ? manifest.folderId : parents.get(parentPath)
      if (entry.relativePath && !parents.has(parentPath))
        throw new Error('The import directory manifest is out of order.')
      if (entry.kind === 'directory') {
        let folderId: string
        try {
          const result = await requestJson(createWorkspaceFileFolderContract, {
            params: { id: manifest.targetWorkspaceId },
            body: { name, parentId: parentId ?? null },
            signal,
          })
          folderId = result.folder.id
        } catch (error) {
          if (!(error instanceof ApiClientError) || error.status !== 409) throw error
          const result = await requestJson(listWorkspaceFileFoldersContract, {
            params: { id: manifest.targetWorkspaceId },
            query: { scope: 'active' },
            signal,
          })
          const existing = result.folders.find(
            (folder) => folder.name === name && folder.parentId === (parentId ?? null)
          )
          if (!existing) throw error
          folderId = existing.id
        }
        parents.set(entry.relativePath, folderId)
        folders.push({ id: folderId, relativePath: entry.relativePath })
        continue
      }
      const parts: Uint8Array<ArrayBuffer>[] = []
      let offset = 0
      do {
        const response = await invoke(
          {
            operation: 'chunk',
            toolCallId,
            relativePath: entry.relativePath,
            offset,
            revision: entry.revision,
          },
          signal
        )
        if (!response.ok) throw new Error(response.error)
        if (response.data.kind !== 'chunk') throw new Error('Unexpected file chunk response.')
        const bytes = new Uint8Array(response.data.bytes)
        parts.push(bytes)
        offset += bytes.length
        if (
          offset > entry.size ||
          (response.data.eof && offset !== entry.size) ||
          (!response.data.eof && bytes.length === 0)
        )
          throw new Error('The local file changed or its transfer was incomplete.')
        if (response.data.eof) break
      } while (offset < entry.size)
      const saved = await uploadWorkspaceFileSession({
        workspaceId: manifest.targetWorkspaceId,
        folderId: parentId,
        file: new File(parts, name),
        signal,
      })
      files.push({ id: saved.id, name: saved.name, relativePath: entry.relativePath })
    }
    return { success: true, workspaceId: manifest.targetWorkspaceId, files, folders }
  } catch (error) {
    return {
      success: false,
      workspaceId: manifest.targetWorkspaceId,
      files,
      folders,
      error: getErrorMessage(error),
      partial: files.length > 0 || folders.length > 0,
      doNotRetry: true,
      outcomeUnknown: true,
    }
  }
}

/** The server claims imports before reading their manifest, preventing replayed uploads. */
export async function executeNativeFileTool(
  toolCallId: string,
  toolName: string,
  signal?: AbortSignal
): Promise<void> {
  let settled = false
  const onPageHide = () => {
    if (!settled)
      reportClientToolCompletionOnPageExit(
        toolCallId,
        ASYNC_TOOL_CONFIRMATION_STATUS.error,
        'The window closed during a local file operation. Inspect the workspace before retrying an import.',
        { outcomeUnknown: true, doNotRetry: true }
      ).catch((error) =>
        logger.warn('Could not report local file operation on page exit', {
          error: getErrorMessage(error),
          toolCallId,
        })
      )
  }
  window.addEventListener('pagehide', onPageHide)
  try {
    const response = await invoke(
      { operation: toolName === 'read_local_file' ? 'read' : 'manifest', toolCallId },
      signal
    )
    if (!response.ok) {
      if (response.code === 'ALREADY_STARTED') return
      throw new Error(response.error)
    }
    const result =
      response.data.kind === 'manifest'
        ? await importNativeFiles(toolCallId, response.data, signal)
        : response.data
    if ('kind' in result && result.kind === 'chunk')
      throw new Error('Unexpected chunk outside an import.')
    const failed = 'success' in result && result.success === false
    await reportClientToolCompletion(
      toolCallId,
      failed ? ASYNC_TOOL_CONFIRMATION_STATUS.error : ASYNC_TOOL_CONFIRMATION_STATUS.success,
      failed
        ? 'Some files could not be imported; inspect the partial result.'
        : 'Local file operation completed.',
      result
    )
    settled = true
  } catch (error) {
    await reportClientToolCompletion(
      toolCallId,
      ASYNC_TOOL_CONFIRMATION_STATUS.error,
      getErrorMessage(error),
      {
        error: getErrorMessage(error),
        outcomeUnknown: toolName === 'import_local_files',
        doNotRetry: toolName === 'import_local_files',
      }
    ).catch((reportError) =>
      logger.error('Could not report local file result', {
        error: getErrorMessage(reportError),
        toolCallId,
      })
    )
    settled = true
  } finally {
    window.removeEventListener('pagehide', onPageHide)
  }
}
