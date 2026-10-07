import type {
  DesktopLocalFileManifest,
  DesktopLocalFileRequest,
  DesktopLocalFileResponse,
} from '@sim/desktop-bridge'
import {
  assertImportableManifest,
  type DesktopLocalFileImportResult,
  localFileImportCompletion,
  localFileImportFailure,
  localFileReadCompletion,
  readImportEntry,
} from '@sim/desktop-bridge/tool-results'
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

/** The manifest is produced from canonical pending-tool arguments in Electron, never renderer paths. */
export async function importNativeFiles(
  toolCallId: string,
  manifest: DesktopLocalFileManifest,
  signal?: AbortSignal
): Promise<DesktopLocalFileImportResult> {
  const files: DesktopLocalFileImportResult['files'] = []
  const folders: DesktopLocalFileImportResult['folders'] = []
  const parents = new Map<string, string | undefined>([['', manifest.folderId]])
  try {
    assertImportableManifest(manifest)
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
      const parts = await readImportEntry(
        toolCallId,
        entry,
        (request) => invoke(request, signal),
        signal
      )
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
    return localFileImportFailure(
      { workspaceId: manifest.targetWorkspaceId, files, folders },
      getErrorMessage(error)
    )
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
    if (response.data.kind === 'chunk') throw new Error('Unexpected chunk outside an import.')
    const completion =
      response.data.kind === 'manifest'
        ? localFileImportCompletion(await importNativeFiles(toolCallId, response.data, signal))
        : localFileReadCompletion(response)
    await reportClientToolCompletion(
      toolCallId,
      completion.status,
      completion.message,
      completion.data
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
