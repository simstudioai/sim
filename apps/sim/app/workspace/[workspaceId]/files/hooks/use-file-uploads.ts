'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { useLimitUpgradeToast } from '@/lib/billing/client'
import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'
import { isAbortError } from '@/lib/uploads/utils/file-utils'
import type { UploadSelection } from '@/app/workspace/[workspaceId]/files/utils/upload-selection'
import { usePrepareUploadFolders } from '@/hooks/queries/workspace-file-folder-upload'
import { invalidateWorkspaceFileBrowsers } from '@/hooks/queries/workspace-file-folders'
import { useUploadWorkspaceFile } from '@/hooks/queries/workspace-files'

const logger = createLogger('FileUploads')
const IDLE_PROGRESS = { completed: 0, total: 0, currentPercent: 0, preparing: false }
const MAX_PENDING_UPLOAD_BATCHES = 3

interface UseFileUploadsOptions {
  workspaceId: string
  canEdit: boolean
  onStart: () => void
}

/** Serializes captured upload batches and reconciles the browser once each batch settles. */
export function useFileUploads({ workspaceId, canEdit, onStart }: UseFileUploadsOptions) {
  const queue = useRef(Promise.resolve())
  const batchesRef = useRef<Set<AbortController> | null>(null)
  const batches = (batchesRef.current ??= new Set<AbortController>())
  const mounted = useRef(true)
  const [progress, setProgress] = useState(IDLE_PROGRESS)
  const queryClient = useQueryClient()
  const { mutateAsync: prepareFolders } = usePrepareUploadFolders()
  const { mutateAsync: uploadFile } = useUploadWorkspaceFile()
  const notifyLimit = useLimitUpgradeToast()

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const batch of batches) batch.abort()
    }
  }, [workspaceId, canEdit, batches])

  const upload = useCallback(
    (
      captureSelection: (signal: AbortSignal) => UploadSelection | Promise<UploadSelection>,
      targetFolderId: string | null
    ) => {
      if (!workspaceId || !canEdit || !mounted.current) return Promise.resolve()
      if (batches.size >= MAX_PENDING_UPLOAD_BATCHES) {
        toast.error('The upload queue is full', {
          description: 'Wait for an upload to finish before adding more files or folders.',
        })
        return Promise.resolve()
      }
      const abort = new AbortController()
      batches.add(abort)
      let selected: Promise<UploadSelection>
      try {
        selected = Promise.resolve(captureSelection(abort.signal))
      } catch (error) {
        selected = Promise.reject(error)
      }
      // Native drag entries must be captured before the drop event releases its data store.
      const captured = selected.then(
        (value) => ({ success: true as const, value }),
        (error: unknown) => ({ success: false as const, error })
      )
      const run = async () => {
        if (!mounted.current || abort.signal.aborted) {
          batches.delete(abort)
          return
        }
        let attempted = false
        try {
          onStart()
          setProgress({ ...IDLE_PROGRESS, preparing: true })
          const result = await captured
          if (abort.signal.aborted) return
          if (!result.success) throw result.error
          const { directories, files } = result.value
          if (files.length === 0 && directories.length === 0) return
          const allowed = files.filter(({ file }) => file.size <= MAX_WORKSPACE_FILE_SIZE)
          const oversized = files.length - allowed.length
          if (oversized > 0)
            toast.error(
              `${oversized} file${oversized === 1 ? '' : 's'} exceed${oversized === 1 ? 's' : ''} the 5 GiB upload limit`
            )
          const folderIds = new Map<string, string>()
          if (directories.length > 0) {
            attempted = true
            try {
              const prepared = await prepareFolders({
                workspaceId,
                targetFolderId,
                paths: directories,
                signal: abort.signal,
              })
              abort.signal.throwIfAborted()
              for (const folder of prepared.folders)
                folderIds.set(JSON.stringify(folder.path), folder.id)
            } catch (error) {
              if (isAbortError(error)) throw error
              if (isApiClientError(error) && error.status >= 400 && error.status < 500) throw error
              throw new Error(
                'Could not confirm the folder upload. Check the destination folder before trying again.',
                { cause: error }
              )
            }
          }
          let failed = 0
          setProgress({ completed: 0, total: allowed.length, currentPercent: 0, preparing: false })
          for (const [index, entry] of allowed.entries()) {
            if (abort.signal.aborted) break
            const parentPath = entry.path.slice(0, -1)
            const folderId =
              parentPath.length > 0 ? folderIds.get(JSON.stringify(parentPath)) : targetFolderId
            if (folderId === undefined)
              throw new Error(`The destination for "${entry.path.join('/')}" could not be prepared`)
            attempted = true
            try {
              await uploadFile({
                workspaceId,
                file: entry.file,
                folderId,
                signal: abort.signal,
                skipToast: true,
                skipInvalidation: true,
                onProgress: ({ percent }) => {
                  if (mounted.current && !abort.signal.aborted)
                    setProgress({
                      completed: index,
                      total: allowed.length,
                      currentPercent: percent,
                      preparing: false,
                    })
                },
              })
            } catch (error) {
              if (isAbortError(error)) break
              failed += 1
              const message = getErrorMessage(error, 'Upload failed')
              logger.error('File upload failed', { error, path: entry.path.join('/') })
              if (failed <= 3) {
                if (/storage limit/i.test(message)) notifyLimit('storage', message)
                else
                  toast.error(`Failed to upload "${entry.path.join('/')}"`, {
                    description: message,
                  })
              }
            }
            if (mounted.current && !abort.signal.aborted)
              setProgress({
                completed: index + 1,
                total: allowed.length,
                currentPercent: 0,
                preparing: false,
              })
          }
          if (!abort.signal.aborted && failed === 0 && oversized === 0) {
            toast.success(
              allowed.length > 0
                ? `Uploaded ${allowed.length} file${allowed.length === 1 ? '' : 's'}`
                : 'Uploaded folders'
            )
          } else if (failed > 0) {
            toast.error(`${failed} file${failed === 1 ? '' : 's'} could not be uploaded`, {
              description: 'Completed files are available in the destination folder.',
            })
          }
        } catch (error) {
          if (!isAbortError(error)) {
            logger.error('Upload batch failed', error)
            toast.error(getErrorMessage(error, 'Could not upload the selection'))
          }
        } finally {
          batches.delete(abort)
          if (attempted) invalidateWorkspaceFileBrowsers(queryClient, workspaceId)
          if (mounted.current) setProgress(IDLE_PROGRESS)
        }
      }
      queue.current = queue.current.then(run, run)
      return queue.current
    },
    [workspaceId, canEdit, onStart, prepareFolders, uploadFile, notifyLimit, queryClient, batches]
  )

  const cancel = useCallback(() => {
    for (const batch of batches) batch.abort()
  }, [batches])

  return { upload, cancel, progress, uploading: progress.preparing || progress.total > 0 }
}
