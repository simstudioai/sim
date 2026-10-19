import { useCallback, useRef } from 'react'
import { createLogger } from '@sim/logger'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  deriveMarkdownFileName,
  isUntitledName,
  uniqueMarkdownName,
} from '@/app/workspace/[workspaceId]/files/untitled-title'
import { useRenameWorkspaceFile } from '@/hooks/queries/workspace-files'

const logger = createLogger('DeriveTitleFromHeading')

/**
 * While a file is still untitled, names it after the leading heading the user types in its editor.
 * The editor reports the heading once the user finishes it — possibly on unmount, after the view
 * has moved to another file, so the file is looked up by the id it reports. Re-checks the file is
 * still untitled, derives a unique `.md` name among its folder siblings, and renames.
 */
export function useDeriveTitleFromHeading(workspaceId: string, files: WorkspaceFileRecord[]) {
  const filesRef = useRef(files)
  filesRef.current = files
  const renameFile = useRenameWorkspaceFile()
  return useCallback(
    (fileId: string, headingText: string) => {
      const currentFile = filesRef.current.find((f) => f.id === fileId)
      if (!currentFile || !isUntitledName(currentFile.name)) return
      const derived = deriveMarkdownFileName(headingText)
      if (!derived) return
      const siblingNames = new Set(
        filesRef.current
          .filter(
            (f) =>
              (f.folderId ?? null) === (currentFile.folderId ?? null) && f.id !== currentFile.id
          )
          .map((f) => f.name)
      )
      const name = uniqueMarkdownName(derived, siblingNames)
      if (name === currentFile.name) return
      renameFile
        .mutateAsync({ workspaceId, fileId: currentFile.id, name })
        .catch((err) => logger.error('Failed to auto-name file from heading:', err))
    },
    // Mutation objects are unstable; mutateAsync is stable in v5.
    [workspaceId]
  )
}
