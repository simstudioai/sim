import { useCallback, useState } from 'react'

export interface ChatFile {
  id: string
  name: string
  size: number
  type: string
  file: File
}

const MAX_FILES = 15
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * Hook for handling file uploads in the chat modal
 * Manages file state, validation, and drag-drop functionality
 */
export function useChatFileUpload() {
  const [chatFiles, setChatFiles] = useState<ChatFile[]>([])
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [dragCounter, setDragCounter] = useState(0)

  const isDragOver = dragCounter > 0

  /**
   * Validate and add files
   * Uses functional state update to avoid stale closure issues with rapid file additions
   */
  const addFiles = useCallback((files: File[]) => {
    setChatFiles((currentFiles) => {
      const remainingSlots = Math.max(0, MAX_FILES - currentFiles.length)
      const candidateFiles = files.slice(0, remainingSlots)
      const errors: string[] = []
      const validNewFiles: ChatFile[] = []

      for (const file of candidateFiles) {
        // Check file size
        if (file.size > MAX_FILE_SIZE) {
          errors.push(`${file.name} is too large (max 10MB)`)
          continue
        }

        // Check for duplicates against current files and newly added valid files
        const isDuplicateInCurrent = currentFiles.some(
          (existingFile) => existingFile.name === file.name && existingFile.size === file.size
        )
        const isDuplicateInNew = validNewFiles.some(
          (newFile) => newFile.name === file.name && newFile.size === file.size
        )
        if (isDuplicateInCurrent || isDuplicateInNew) {
          errors.push(`${file.name} already added`)
          continue
        }

        validNewFiles.push({
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          type: file.type,
          file,
        })
      }

      // Update errors outside the state setter to avoid nested state updates
      if (errors.length > 0) {
        // Use setTimeout to avoid state update during render
        setTimeout(() => setUploadErrors(errors), 0)
      } else if (validNewFiles.length > 0) {
        setTimeout(() => setUploadErrors([]), 0)
      }

      if (validNewFiles.length > 0) {
        return [...currentFiles, ...validNewFiles]
      }
      return currentFiles
    })
  }, [])

  /**
   * Remove a file
   */
  const removeFile = useCallback((fileId: string) => {
    setChatFiles((prev) => prev.filter((f) => f.id !== fileId))
  }, [])

  /**
   * Clear all files
   */
  const clearFiles = useCallback(() => {
    setChatFiles([])
    setUploadErrors([])
  }, [])

  /**
   * Clear errors
   */
  const clearErrors = useCallback(() => {
    setUploadErrors([])
  }, [])

  /**
   * Handle file input change
   */
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files) return

      const fileArray = Array.from(files)
      addFiles(fileArray)

      // Reset input value to allow selecting the same file again
      e.target.value = ''
    },
    [addFiles]
  )

  /**
   * Handle drag enter
   */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter((prev) => prev + 1)
  }, [])

  /**
   * Handle drag over
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  /**
   * Handle drag leave
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter((prev) => Math.max(0, prev - 1))
  }, [])

  /**
   * Handle drop
   */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setDragCounter(0)

      const droppedFiles = Array.from(e.dataTransfer.files)
      if (droppedFiles.length > 0) {
        addFiles(droppedFiles)
      }
    },
    [addFiles]
  )

  return {
    chatFiles,
    uploadErrors,
    isDragOver,
    addFiles,
    removeFile,
    clearFiles,
    clearErrors,
    handleFileInputChange,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}
