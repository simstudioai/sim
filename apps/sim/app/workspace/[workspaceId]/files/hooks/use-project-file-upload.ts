import { useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useLimitUpgradeToast } from '@/lib/billing/client'
import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'
import { isSupportedFileUpload } from '@/app/workspace/[workspaceId]/files/utils'
import { useUploadProjectFile } from '@/hooks/queries/project-files'

interface UploadProgress {
  completed: number
  total: number
  currentPercent: number
  folderId: string | null
}

/** Captures the upload destination for a batch and retires it when its owner view unmounts. */
export function useProjectFileUpload(projectId: string, canWrite: boolean) {
  const mutation = useUploadProjectFile()
  const notifyLimit = useLimitUpgradeToast()
  const active = useRef<AbortController | null>(null)
  const canWriteRef = useRef(canWrite)
  canWriteRef.current = canWrite
  const [progress, setProgress] = useState<UploadProgress | null>(null)

  useEffect(
    () => () => {
      active.current?.abort()
      active.current = null
    },
    []
  )

  useEffect(() => {
    if (!canWrite) active.current?.abort()
  }, [canWrite])

  async function uploadFiles(files: File[], folderId: string | null) {
    if (!canWriteRef.current || active.current || files.length === 0) return
    const allowed: File[] = []
    for (const file of files) {
      if (file.size > MAX_WORKSPACE_FILE_SIZE) {
        toast.error(`${file.name} exceeds the 5 GiB upload limit`)
      } else if (!isSupportedFileUpload(file.name)) {
        toast.error(`Unsupported file type: ${file.name}`)
      } else {
        allowed.push(file)
      }
    }
    if (allowed.length === 0) return
    const controller = new AbortController()
    active.current = controller
    const updateProgress = (completed: number, currentPercent: number) => {
      if (active.current === controller && !controller.signal.aborted) {
        setProgress({ completed, currentPercent, total: allowed.length, folderId })
      }
    }
    updateProgress(0, 0)
    try {
      for (const [index, file] of allowed.entries()) {
        if (controller.signal.aborted || !canWriteRef.current) break
        try {
          await mutation.mutateAsync({
            projectId,
            folderId,
            file,
            signal: controller.signal,
            onProgress: ({ percent }) => updateProgress(index, percent),
          })
        } catch (error) {
          if (controller.signal.aborted) break
          const message = getErrorMessage(error, `Unable to upload ${file.name}`)
          if (/storage limit/i.test(message)) notifyLimit('storage', message)
          else toast.error(message)
        }
        updateProgress(index + 1, 0)
      }
    } finally {
      if (active.current === controller) {
        active.current = null
        setProgress(null)
      }
    }
  }

  const label = progress
    ? `${progress.completed}/${progress.total}${progress.currentPercent > 0 && progress.currentPercent < 100 ? ` · ${progress.currentPercent}%` : ''}`
    : 'Upload'
  return { uploadFiles, progress, label, uploading: progress !== null }
}
