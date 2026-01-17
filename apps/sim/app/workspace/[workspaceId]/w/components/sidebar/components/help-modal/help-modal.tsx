'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { createLogger } from '@sim/logger'
import imageCompression from 'browser-image-compression'
import { X } from 'lucide-react'
import Image from 'next/image'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  Button,
  Combobox,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

const logger = createLogger('HelpModal')

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB maximum upload size
const TARGET_SIZE_MB = 2 // Target size after compression
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']

const SCROLL_DELAY_MS = 100
const SUCCESS_RESET_DELAY_MS = 2000

const DEFAULT_REQUEST_TYPE = 'bug'

const REQUEST_TYPE_OPTIONS = [
  { label: 'Bug Report', value: 'bug' },
  { label: 'Feedback', value: 'feedback' },
  { label: 'Feature Request', value: 'feature_request' },
  { label: 'Other', value: 'other' },
]

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
  workflowId?: string
  workspaceId: string
}

export function HelpModal({ open, onOpenChange, workflowId, workspaceId }: HelpModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'success' | 'error' | null>(null)
  const [images, setImages] = useState<ImageWithPreview[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
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
   * Fix z-index for popover/dropdown when inside modal
   */
  useEffect(() => {
    if (!open) return

    const updatePopoverZIndex = () => {
      const allDivs = document.querySelectorAll('div')
      allDivs.forEach((div) => {
        const element = div as HTMLElement
        const computedZIndex = window.getComputedStyle(element).zIndex
        const zIndexNum = Number.parseInt(computedZIndex) || 0

        if (zIndexNum === 10000001 || (zIndexNum > 0 && zIndexNum <= 10000100)) {
          const hasPopoverStructure =
            element.hasAttribute('data-radix-popover-content') ||
            (element.hasAttribute('role') && element.getAttribute('role') === 'dialog') ||
            element.querySelector('[role="listbox"]') !== null ||
            element.classList.contains('rounded-[8px]') ||
            element.classList.contains('rounded-[4px]')

          if (hasPopoverStructure && element.offsetParent !== null) {
            element.style.zIndex = '10000101'
          }
        }
      })
    }

    // Create a style element to override popover z-index
    const styleId = 'help-modal-popover-z-index'
    let styleElement = document.getElementById(styleId) as HTMLStyleElement | null

    if (!styleElement) {
      styleElement = document.createElement('style')
      styleElement.id = styleId
      document.head.appendChild(styleElement)
    }

    styleElement.textContent = `
      [data-radix-popover-content] {
        z-index: 10000101 !important;
      }
      div[style*="z-index: 10000001"],
      div[style*="z-index:10000001"] {
        z-index: 10000101 !important;
      }
    `

    const observer = new MutationObserver(() => {
      updatePopoverZIndex()
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    })

    updatePopoverZIndex()

    const intervalId = setInterval(updatePopoverZIndex, 100)

    return () => {
      const element = document.getElementById(styleId)
      if (element) {
        element.remove()
      }
      observer.disconnect()
      clearInterval(intervalId)
    }
  }, [open])

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
      if (!files || files.length === 0) return

      setIsProcessing(true)

      try {
        const newImages: ImageWithPreview[] = []
        let hasError = false

        for (const file of Array.from(files)) {
          // Validate file size
          if (file.size > MAX_FILE_SIZE) {
            hasError = true
            continue
          }

          // Validate file type
          if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
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

      try {
        const formData = new FormData()
        formData.append('subject', data.subject)
        formData.append('message', data.message)
        formData.append('type', data.type)
        formData.append('workspaceId', workspaceId)
        formData.append('userAgent', navigator.userAgent)
        if (workflowId) {
          formData.append('workflowId', workflowId)
        }

        images.forEach((image, index) => {
          formData.append(`image_${index}`, image)
        })

        const response = await fetch('/api/help', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to submit help request')
        }

        setSubmitStatus('success')
        reset()

        images.forEach((image) => URL.revokeObjectURL(image.preview))
        setImages([])
      } catch (error) {
        logger.error('Error submitting help request:', { error })
        setSubmitStatus('error')
      } finally {
        setIsSubmitting(false)
      }
    },
    [images, reset, workflowId, workspaceId]
  )

  /**
   * Handle modal close action
   */
  const handleClose = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='md'>
        <ModalHeader>Help &amp; Support</ModalHeader>

        <form onSubmit={handleSubmit(onSubmit)} className='flex min-h-0 flex-1 flex-col'>
          <ModalBody>
            <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto'>
              <div className='space-y-[12px]'>
                <div className='flex flex-col gap-[8px]'>
                  <Label htmlFor='type'>Request</Label>
                  <Combobox
                    id='type'
                    options={REQUEST_TYPE_OPTIONS}
                    value={watch('type') || DEFAULT_REQUEST_TYPE}
                    selectedValue={watch('type') || DEFAULT_REQUEST_TYPE}
                    onChange={(value) => setValue('type', value as FormValues['type'])}
                    placeholder='Select a request type'
                    editable={false}
                    filterOptions={false}
                    className={cn(errors.type && 'border-[var(--text-error)]')}
                  />
                </div>

                <div className='flex flex-col gap-[8px]'>
                  <Label htmlFor='subject'>Subject</Label>
                  <Input
                    id='subject'
                    placeholder='Brief description of your request'
                    {...register('subject')}
                    className={cn(errors.subject && 'border-[var(--text-error)]')}
                  />
                </div>

                <div className='flex flex-col gap-[8px]'>
                  <Label htmlFor='message'>Message</Label>
                  <Textarea
                    id='message'
                    placeholder='Please provide details about your request...'
                    rows={6}
                    {...register('message')}
                    className={cn(errors.message && 'border-[var(--text-error)]')}
                  />
                </div>

                <div className='flex flex-col gap-[8px]'>
                  <Label>Attach Images (Optional)</Label>
                  <Button
                    type='button'
                    variant='default'
                    onClick={() => fileInputRef.current?.click()}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={cn(
                      '!bg-[var(--surface-1)] hover:!bg-[var(--surface-4)] w-full justify-center border border-[var(--border-1)] border-dashed py-[10px]',
                      {
                        'border-[var(--surface-7)]': isDragging,
                      }
                    )}
                  >
                    <input
                      ref={fileInputRef}
                      type='file'
                      accept={ACCEPTED_IMAGE_TYPES.join(',')}
                      onChange={handleFileChange}
                      className='hidden'
                      multiple
                    />
                    <div className='flex flex-col gap-[2px] text-center'>
                      <span className='text-[var(--text-primary)]'>
                        {isDragging ? 'Drop images here' : 'Drop images here or click to browse'}
                      </span>
                      <span className='text-[11px] text-[var(--text-tertiary)]'>
                        PNG, JPEG, WebP, GIF (max 20MB each)
                      </span>
                    </div>
                  </Button>
                </div>

                {images.length > 0 && (
                  <div className='space-y-2'>
                    <Label>Uploaded Images</Label>
                    <div className='grid grid-cols-2 gap-3'>
                      {images.map((image, index) => (
                        <div
                          className='group relative overflow-hidden rounded-[4px] border'
                          key={index}
                        >
                          <div className='relative flex max-h-[120px] min-h-[80px] w-full items-center justify-center'>
                            <Image
                              src={image.preview}
                              alt={`Preview ${index + 1}`}
                              fill
                              unoptimized
                              className='object-contain'
                            />
                            <button
                              type='button'
                              className='absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100'
                              onClick={() => removeImage(index)}
                            >
                              <X className='h-[18px] w-[18px] text-white' />
                            </button>
                          </div>
                          <div className='truncate p-[6px] text-[12px]'>{image.name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button variant='default' onClick={handleClose} type='button' disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type='submit' variant='tertiary' disabled={isSubmitting || isProcessing}>
              {isSubmitting
                ? 'Submitting...'
                : submitStatus === 'error'
                  ? 'Error'
                  : submitStatus === 'success'
                    ? 'Success'
                    : 'Submit'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
