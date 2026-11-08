'use client'

import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import {
  deriveMarkdownFileName,
  isUntitledName,
  renameToUniqueMarkdownName,
  uniqueMarkdownName,
} from '@/app/workspace/[workspaceId]/files/untitled-title'
import {
  getWorkspaceFileRecordQueryOptions,
  getWorkspaceFileSearchQueryOptions,
  isWorkspaceFileNameTaken,
  useRenameWorkspaceFile,
} from '@/hooks/queries/workspace-files'

const logger = createLogger('FileTitle')

/** How many similarly named files a derived title is made unique against. */
const TITLE_SIBLING_LIMIT = 50

/**
 * While a file is still untitled, names it after the leading heading its editor reports. The
 * editor can report on unmount, after the route moved on, so the file is read by the id it names.
 * A no-op once the file has a real name; the server numbers a name a sibling already holds.
 */
export function useDeriveFileTitle(workspaceId: string) {
  const queryClient = useQueryClient()
  const { mutateAsync: renameFile } = useRenameWorkspaceFile()
  return useCallback(
    async (fileId: string, headingText: string) => {
      try {
        const currentFile = await queryClient.fetchQuery(
          getWorkspaceFileRecordQueryOptions(queryClient, workspaceId, fileId)
        )
        if (!currentFile || !isUntitledName(currentFile.name)) return
        const derived = deriveMarkdownFileName(headingText)
        if (!derived) return
        const similar = await queryClient.fetchQuery({
          ...getWorkspaceFileSearchQueryOptions(workspaceId, {
            q: derived.replace(/\.md$/i, ''),
            folderId: currentFile.folderId ?? null,
            recursive: false,
            limit: TITLE_SIBLING_LIMIT,
          }),
          staleTime: 0,
        })
        const siblingNames = new Set(
          similar.filter((file) => file.id !== currentFile.id).map((file) => file.name)
        )
        if (uniqueMarkdownName(derived, siblingNames) === currentFile.name) return
        await renameToUniqueMarkdownName(
          derived,
          siblingNames,
          (name) => renameFile({ workspaceId, fileId: currentFile.id, name, quiet: true }),
          isWorkspaceFileNameTaken
        )
      } catch (error) {
        logger.error('Failed to name a file from its heading', { fileId, error })
      }
    },
    [queryClient, workspaceId, renameFile]
  )
}
