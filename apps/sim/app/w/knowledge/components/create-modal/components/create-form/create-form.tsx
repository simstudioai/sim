'use client'

import { useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Upload, X, FileIcon, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { getDocumentIcon } from '@/app/w/knowledge/icons/document-icons'

// Define form schema
const formSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),
  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .optional(),
})

type FormValues = z.infer<typeof formSchema>

// File upload constraints
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const ACCEPTED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

interface FileWithPreview extends File {
  preview: string
}

interface CreateFormProps {
  onClose: () => void
}

export function CreateForm({ onClose }: CreateFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'success' | 'error' | null>(
    null
  )
  const [errorMessage, setErrorMessage] = useState('')
  const [files, setFiles] = useState<FileWithPreview[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
    },
    mode: 'onChange',
  })

  const processFiles = async (fileList: FileList | File[]) => {
    setFileError(null)

    if (!fileList || fileList.length === 0) return

    try {
      const newFiles: FileWithPreview[] = []
      let hasError = false

      for (const file of Array.from(fileList)) {
        // Check file size
        if (file.size > MAX_FILE_SIZE) {
          setFileError(`File ${file.name} is too large. Maximum size is 50MB.`)
          hasError = true
          continue
        }

        // Check file type
        if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
          setFileError(
            `File ${file.name} has an unsupported format. Please use PDF, DOC, DOCX, TXT, CSV, XLS, or XLSX.`
          )
          hasError = true
          continue
        }

        // Create file with preview (using file icon since these aren't images)
        const fileWithPreview = Object.assign(file, {
          preview: URL.createObjectURL(file),
        }) as FileWithPreview

        newFiles.push(fileWithPreview)
      }

      if (!hasError && newFiles.length > 0) {
        setFiles((prev) => [...prev, ...newFiles])
      }
    } catch (error) {
      console.error('Error processing files:', error)
      setFileError(
        'An error occurred while processing files. Please try again.'
      )
    } finally {
      // Reset the input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await processFiles(e.target.files)
    }
  }

  // Handle drag events
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(e.dataTransfer.files)
    }
  }

  const removeFile = (index: number) => {
    setFiles((prev) => {
      // Revoke the URL to avoid memory leaks
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  const getFileIcon = (mimeType: string, filename: string) => {
    const IconComponent = getDocumentIcon(mimeType, filename)
    return <IconComponent className="w-8 h-10" />
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
  }

  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true)
    setSubmitStatus(null)

    try {
      // Create FormData to handle file uploads
      const formData = new FormData()

      // Add form fields
      formData.append('name', data.name)
      if (data.description) {
        formData.append('description', data.description)
      }

      // Add files
      files.forEach((file, index) => {
        formData.append(`file_${index}`, file)
      })

      const response = await fetch('/api/knowledge-base', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create knowledge base')
      }

      setSubmitStatus('success')
      reset()

      // Clean up file previews
      files.forEach((file) => URL.revokeObjectURL(file.preview))
      setFiles([])

      // Close modal after a short delay to show success message
      setTimeout(() => {
        onClose()
      }, 2000)
    } catch (error) {
      console.error('Error creating knowledge base:', error)
      setSubmitStatus('error')
      setErrorMessage(
        error instanceof Error ? error.message : 'An unknown error occurred'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex h-full flex-col">
      {/* Scrollable Content */}
      <div
        ref={scrollContainerRef}
        className="scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/25 scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6"
      >
        <div className="py-4">
          {submitStatus === 'success' ? (
            <Alert className="mb-6 border-border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
              <div className="flex items-start gap-4 py-1">
                <div className="mt-[-1.5px] flex-shrink-0">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                </div>
                <div className="mr-4 flex-1 space-y-2">
                  <AlertTitle className="-mt-0.5 flex items-center justify-between">
                    <span className="font-medium text-green-600 dark:text-green-400">
                      Success
                    </span>
                  </AlertTitle>
                  <AlertDescription className="text-green-600 dark:text-green-400">
                    Your knowledge base has been created successfully!
                  </AlertDescription>
                </div>
              </div>
            </Alert>
          ) : submitStatus === 'error' ? (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>
                {errorMessage ||
                  'There was an error creating your knowledge base. Please try again.'}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="Enter knowledge base name"
                {...register('name')}
                className={errors.name ? 'border-red-500' : ''}
              />
              {errors.name && (
                <p className="mt-1 text-red-500 text-sm">
                  {errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe what this knowledge base contains (optional)"
                rows={3}
                {...register('description')}
                className={errors.description ? 'border-red-500' : ''}
              />
              {errors.description && (
                <p className="mt-1 text-red-500 text-sm">
                  {errors.description.message}
                </p>
              )}
            </div>

            {/* File Upload Section */}
            <div className="mt-6 space-y-2">
              <Label>Upload Documents</Label>
              {files.length === 0 ? (
                <div
                  ref={dropZoneRef}
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative rounded-lg border-[1px] border-dashed p-16 text-center transition-colors cursor-pointer ${
                    isDragging
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_FILE_TYPES.join(',')}
                    onChange={handleFileChange}
                    className="hidden"
                    multiple
                  />
                  <div className="flex flex-col items-center gap-2">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">
                        Drop files here or click to browse
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Supports PDF, DOC, DOCX, TXT, CSV, XLS, XLSX (max 50MB
                        each)
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="space-y-2">
                    {/* Compact drop area at top of file list */}
                    <div
                      ref={dropZoneRef}
                      onDragEnter={handleDragEnter}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`flex items-center justify-center rounded-md border border-dashed p-3 transition-colors cursor-pointer ${
                        isDragging
                          ? 'border-primary bg-primary/5'
                          : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={ACCEPTED_FILE_TYPES.join(',')}
                        onChange={handleFileChange}
                        className="hidden"
                        multiple
                      />
                      <div className="text-center">
                        <p className="text-sm font-medium">
                          Drop more files or click to browse
                        </p>
                        <p className="text-xs text-muted-foreground">
                          PDF, DOC, DOCX, TXT, CSV, XLS, XLSX (max 50MB each)
                        </p>
                      </div>
                    </div>

                    {/* File list */}
                    {files.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-3 rounded-md border p-3"
                      >
                        {getFileIcon(file.type, file.name)}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {file.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(index)}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {fileError && (
                <p className="mt-1 text-red-500 text-sm">{fileError}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Fixed Footer */}
      <div className="mt-auto border-t px-6 pt-4 pb-6">
        <div className="flex justify-between">
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="bg-[#701FFC] text-primary-foreground shadow-[0_0_0_0_#701FFC] hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)] transition-all duration-200 font-[480]"
          >
            {isSubmitting ? 'Creating...' : 'Create Knowledge Base'}
          </Button>
        </div>
      </div>
    </form>
  )
}
