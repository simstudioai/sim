'use client'

import { useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'

/**
 * Uploads an image for a canvas Note and returns its hosted URL, or null if the
 * upload failed.
 *
 * The workspace-file pipeline verbatim — presigned upload to S3, a
 * `workspace_files` row, and the same workspace-scoped inline URL the file
 * editor persists — so a note's images sit behind workspace auth and inside the
 * existing storage lifecycle rather than a note-only namespace. `folderId: null`
 * lands them in the Files root, where they stay visible and deletable like any
 * other upload. The mutation owns its own success/failure toasts.
 *
 * Shared by the two surfaces that can add one: the editor's paste/drop/`/image`
 * flow and the canvas context menu's "Add image".
 */
export function useNoteImageUpload(): (file: File) => Promise<{ url: string; alt: string } | null> {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const uploadFile = useUploadWorkspaceFile()

  return useCallback(
    async (file: File) => {
      const result = await uploadFile
        .mutateAsync({ workspaceId, file, folderId: null })
        .catch(() => null)
      return result?.file ? { url: result.file.url, alt: file.name } : null
    },
    [uploadFile.mutateAsync, workspaceId]
  )
}
