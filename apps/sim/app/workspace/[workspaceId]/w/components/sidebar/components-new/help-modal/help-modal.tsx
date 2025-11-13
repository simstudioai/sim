'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import imageCompression from 'browser-image-compression'
import { Loader2, X } from 'lucide-react'
import Image from 'next/image'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button, Input, Modal, ModalContent, ModalTitle } from '@/components/emcn'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'

const logger = createLogger('HelpModal')

// File upload constraints
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB maximum upload size
const TARGET_SIZE_MB = 2 // Target size after compression
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']

// UI timing constants
const SCROLL_DELAY_MS = 100
const SUCCESS_RESET_DELAY_MS = 2000

// Form default values
const DEFAULT_REQUEST_TYPE = 'bug'

const formSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().min(1, 'Message is required'),
  type: z.enum(['bug', 'feedback', 'feature_request', 'other'], {
    required_error: 'Please select a request type',
  }),
})

type FormValues = z.infer<typeof formSchema>

interface ImageWithPreview extends File {
  preview: string
}

interface HelpModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function HelpModal({ open, onOpenChange }: HelpModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'success' | 'error' | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [images, setImages] = useState<ImageWithPreview[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      subject: '',
      message: '',
      type: DEFAULT_REQUEST_TYPE,
    },
    mode: 'onSubmit',
  })

  /**
   * Reset all state when modal opens/closes
   */
  useEffect(() => {
    if (open) {
      setSubmitStatus(null)
      setErrorMessage('')
      setImageError(null)
      setImages([])
      setIsDragging(false)
      setIsProcessing(false)
      reset({
        subject: '',
        message: '',
        type: DEFAULT_REQUEST_TYPE,
      })
    }
  }, [open, reset])

  /**
   * Set default form value for request type
   */
  useEffect(() => {
    setValue('type', DEFAULT_REQUEST_TYPE)
  }, [setValue])

  /**
   * Clean up image preview URLs to prevent memory leaks
   */
  useEffect(() => {
    return () => {
      images.forEach((image) => URL.revokeObjectURL(image.preview))
    }
  }, [images])

  /**
   * Reset submit status back to normal after showing success for 2 seconds
   */
  useEffect(() => {
    if (submitStatus === 'success') {
      const timer = setTimeout(() => {
        setSubmitStatus(null)
      }, SUCCESS_RESET_DELAY_MS)
      return () => clearTimeout(timer)
    }
  }, [submitStatus])

  /**
   * Smooth scroll to bottom when new images are added
   */
  useEffect(() => {
    if (images.length > 0 && scrollContainerRef.current) {
      const scrollContainer = scrollContainerRef.current
      setTimeout(() => {
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight,
          behavior: 'smooth',
        })
      }, SCROLL_DELAY_MS)
    }
  }, [images.length])

  /**
   * Compress image files to reduce upload size while maintaining quality
   * @param file - The image file to compress
   * @returns The compressed file or original if compression fails/is unnecessary
   */
  const compressImage = useCallback(async (file: File): Promise<File> => {
    // Skip compression for small files or GIFs (which don't compress well)
    if (file.size < TARGET_SIZE_MB * 1024 * 1024 || file.type === 'image/gif') {
      return file
    }

    const options = {
      maxSizeMB: TARGET_SIZE_MB,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: file.type,
      initialQuality: 0.8,
      alwaysKeepResolution: true,
    }

    try {
      const compressedFile = await imageCompression(file, options)

      // Preserve original file metadata for compatibility
      return new File([compressedFile], file.name, {
        type: file.type,
        lastModified: Date.now(),
      })
    } catch (error) {
      logger.warn('Image compression failed, using original file:', { error })
      return file
    }
  }, [])

  /**
   * Process uploaded files: validate, compress, and prepare for preview
   * @param files - FileList or array of files to process
   */
  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      setImageError(null)

      if (!files || files.length === 0) return

      setIsProcessing(true)

      try {
        const newImages: ImageWithPreview[] = []
        let hasError = false

        for (const file of Array.from(files)) {
          // Validate file size
          if (file.size > MAX_FILE_SIZE) {
            setImageError(`File ${file.name} is too large. Maximum size is 20MB.`)
            hasError = true
            continue
          }

          // Validate file type
          if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
            setImageError(
              `File ${file.name} has an unsupported format. Please use JPEG, PNG, WebP, or GIF.`
            )
            hasError = true
            continue
          }

          // Compress and prepare image
          const compressedFile = await compressImage(file)
          const imageWithPreview = Object.assign(compressedFile, {
            preview: URL.createObjectURL(compressedFile),
          }) as ImageWithPreview

          newImages.push(imageWithPreview)
        }

        if (!hasError && newImages.length > 0) {
          setImages((prev) => [...prev, ...newImages])
        }
      } catch (error) {
        logger.error('Error processing images:', { error })
        setImageError('An error occurred while processing images. Please try again.')
      } finally {
        setIsProcessing(false)

        // Reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [compressImage]
  )

  /**
   * Handle file input change event
   */
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        await processFiles(e.target.files)
      }
    },
    [processFiles]
  )

  /**
   * Drag and drop event handlers
   */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        await processFiles(e.dataTransfer.files)
      }
    },
    [processFiles]
  )

  /**
   * Remove an uploaded image and clean up its preview URL
   */
  const removeImage = useCallback((index: number) => {
    setImages((prev) => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  /**
   * Handle form submission with image attachments
   */
  const onSubmit = useCallback(
    async (data: FormValues) => {
      setIsSubmitting(true)
      setSubmitStatus(null)
      setErrorMessage('')

      try {
        // Prepare form data with images
        const formData = new FormData()
        formData.append('subject', data.subject)
        formData.append('message', data.message)
        formData.append('type', data.type)

        // Attach all images to form data
        images.forEach((image, index) => {
          formData.append(`image_${index}`, image)
        })

        // Submit to API
        const response = await fetch('/api/help', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to submit help request')
        }

        // Handle success
        setSubmitStatus('success')
        reset()

        // Clean up resources
        images.forEach((image) => URL.revokeObjectURL(image.preview))
        setImages([])
      } catch (error) {
        logger.error('Error submitting help request:', { error })
        setSubmitStatus('error')
        setErrorMessage(error instanceof Error ? error.message : 'An unknown error occurred')
      } finally {
        setIsSubmitting(false)
      }
    },
    [images, reset]
  )

  /**
   * Handle modal close action
   */
  const handleClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className='flex h-[75vh] max-h-[75vh] w-full max-w-[700px] flex-col gap-0 p-0'>
        {/* Modal Header */}
        <div className='flex-shrink-0 px-6 py-5'>
          <ModalTitle className='font-medium text-[14px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
            Help & Support
          </ModalTitle>
        </div>

        {/* Modal Body */}
        <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
          <form onSubmit={handleSubmit(onSubmit)} className='flex min-h-0 flex-1 flex-col'>
            {/* Scrollable Form Content */}
            <div
              ref={scrollContainerRef}
              className='scrollbar-hide min-h-0 flex-1 overflow-y-auto pb-20'
            >
              <div className='px-6'>
                <div className='space-y-[12px]'>
                  {/* Request Type Field */}
                  <div className='space-y-[8px]'>
                    <Label
                      htmlFor='type'
                      className='font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'
                    >
                      Request
                    </Label>
                    <Select
                      defaultValue={DEFAULT_REQUEST_TYPE}
                      onValueChange={(value) => setValue('type', value as FormValues['type'])}
                    >
                      <SelectTrigger
                        id='type'
                        className={cn(
                          'h-9 rounded-[4px] border-[var(--surface-11)] bg-[var(--surface-6)] text-[13px] dark:bg-[var(--surface-9)]',
                          errors.type &&
                            'border-[var(--text-error)] dark:border-[var(--text-error)]'
                        )}
                      >
                        <SelectValue placeholder='Select a request type' />
                      </SelectTrigger>
                      <SelectContent className='z-[10000000]'>
                        <SelectItem value='bug'>Bug Report</SelectItem>
                        <SelectItem value='feedback'>Feedback</SelectItem>
                        <SelectItem value='feature_request'>Feature Request</SelectItem>
                        <SelectItem value='other'>Other</SelectItem>
                      </SelectContent>
                    </Select>
                    {errors.type && (
                      <p className='mt-[4px] text-[12px] text-[var(--text-error)] dark:text-[var(--text-error)]'>
                        {errors.type.message}
                      </p>
                    )}
                  </div>

                  {/* Subject Field */}
                  <div className='space-y-[8px]'>
                    <Label
                      htmlFor='subject'
                      className='font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'
                    >
                      Subject
                    </Label>
                    <Input
                      id='subject'
                      placeholder='Brief description of your request'
                      {...register('subject')}
                      className={cn(
                        'h-9 rounded-[4px] border-[var(--surface-11)] bg-[var(--surface-6)] text-[13px] dark:bg-[var(--surface-9)]',
                        errors.subject &&
                          'border-[var(--text-error)] dark:border-[var(--text-error)]'
                      )}
                    />
                    {errors.subject && (
                      <p className='mt-[4px] text-[12px] text-[var(--text-error)] dark:text-[var(--text-error)]'>
                        {errors.subject.message}
                      </p>
                    )}
                  </div>

                  {/* Message Field */}
                  <div className='space-y-[8px]'>
                    <Label
                      htmlFor='message'
                      className='font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'
                    >
                      Message
                    </Label>
                    <Textarea
                      id='message'
                      placeholder='Please provide details about your request...'
                      rows={6}
                      {...register('message')}
                      className={cn(
                        'rounded-[4px] border-[var(--surface-11)] bg-[var(--surface-6)] text-[13px] dark:bg-[var(--surface-9)]',
                        errors.message &&
                          'border-[var(--text-error)] dark:border-[var(--text-error)]'
                      )}
                    />
                    {errors.message && (
                      <p className='mt-[4px] text-[12px] text-[var(--text-error)] dark:text-[var(--text-error)]'>
                        {errors.message.message}
                      </p>
                    )}
                  </div>

                  {/* Image Upload Section */}
                  <div className='space-y-[8px]'>
                    <Label className='font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                      Attach Images (Optional)
                    </Label>
                    <div
                      ref={dropZoneRef}
                      onDragEnter={handleDragEnter}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={cn(
                        'cursor-pointer rounded-[4px] border-[1.5px] border-[var(--surface-11)] border-dashed bg-[var(--surface-3)] p-6 text-center transition-colors hover:bg-[var(--surface-5)] dark:bg-[var(--surface-3)] dark:hover:bg-[var(--surface-5)]',
                        isDragging &&
                          'border-[var(--brand-primary-hex)] bg-[var(--surface-5)] dark:bg-[var(--surface-5)]'
                      )}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        ref={fileInputRef}
                        type='file'
                        accept={ACCEPTED_IMAGE_TYPES.join(',')}
                        onChange={handleFileChange}
                        className='hidden'
                        multiple
                      />
                      <p className='text-[13px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                        {isDragging ? 'Drop images here!' : 'Drop images here or click to browse'}
                      </p>
                      <p className='mt-[4px] text-[12px] text-[var(--text-tertiary)] dark:text-[var(--text-tertiary)]'>
                        JPEG, PNG, WebP, GIF (max 20MB each)
                      </p>
                    </div>
                    {imageError && (
                      <p className='mt-[4px] text-[12px] text-[var(--text-error)] dark:text-[var(--text-error)]'>
                        {imageError}
                      </p>
                    )}
                    {isProcessing && (
                      <div className='flex items-center gap-[8px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                        <Loader2 className='h-4 w-4 animate-spin' />
                        <p className='text-[12px]'>Processing images...</p>
                      </div>
                    )}
                  </div>

                  {/* Image Preview Grid */}
                  {images.length > 0 && (
                    <div className='space-y-[8px]'>
                      <Label className='font-medium text-[13px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                        Uploaded Images
                      </Label>
                      <div className='grid grid-cols-2 gap-4'>
                        {images.map((image, index) => (
                          <div
                            key={index}
                            className='group relative overflow-hidden rounded-[4px] border border-[var(--surface-11)]'
                          >
                            <div className='relative aspect-video'>
                              <Image
                                src={image.preview}
                                alt={`Preview ${index + 1}`}
                                fill
                                className='object-cover'
                              />
                              <button
                                type='button'
                                className='absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100'
                                onClick={() => removeImage(index)}
                              >
                                <X className='h-6 w-6 text-white' />
                              </button>
                            </div>
                            <div className='truncate bg-[var(--surface-5)] p-2 text-[12px] text-[var(--text-secondary)] dark:bg-[var(--surface-5)] dark:text-[var(--text-secondary)]'>
                              {image.name}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Fixed Footer with Actions */}
            <div className='absolute inset-x-0 bottom-0 bg-[var(--surface-1)] dark:bg-[var(--surface-1)]'>
              <div className='flex w-full items-center justify-between gap-[8px] px-6 py-4'>
                <Button
                  variant='default'
                  onClick={handleClose}
                  type='button'
                  className='h-[32px] px-[12px] font-medium text-[13px]'
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <button
                  type='submit'
                  disabled={isSubmitting || isProcessing}
                  className={cn(
                    'flex h-[32px] items-center justify-center gap-[8px] rounded-[8px] px-[12px] font-medium text-[13px] text-white transition-all duration-200',
                    submitStatus === 'error'
                      ? 'bg-[var(--text-error)] hover:opacity-90 dark:bg-[var(--text-error)]'
                      : submitStatus === 'success'
                        ? 'bg-green-500 hover:opacity-90'
                        : 'bg-[var(--brand-primary-hex)] shadow-[0_0_0_0_var(--brand-primary-hex)] hover:bg-[var(--brand-primary-hover-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]',
                    'disabled:opacity-50 disabled:hover:bg-[var(--brand-primary-hex)] disabled:hover:shadow-none'
                  )}
                >
                  {isSubmitting && <Loader2 className='h-4 w-4 animate-spin' />}
                  {isSubmitting
                    ? 'Submitting...'
                    : submitStatus === 'error'
                      ? 'Error'
                      : submitStatus === 'success'
                        ? 'Success'
                        : 'Submit'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </ModalContent>
    </Modal>
  )
}
