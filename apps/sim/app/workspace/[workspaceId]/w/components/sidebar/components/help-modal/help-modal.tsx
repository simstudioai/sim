'use client'

import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { createLogger } from '@sim/logger'
import { useMutation } from '@tanstack/react-query'
import imageCompression from 'browser-image-compression'
import { X } from 'lucide-react'
import Image from 'next/image'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  Button,
  Combobox,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

const logger = createLogger('HelpModal')

const MAX_FILE_SIZE = 20 * 1024 * 1024
const TARGET_SIZE_MB = 2
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
    error: 'Please select a request type',
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

interface SubmitHelpVariables {
  data: FormValues
  images: ImageWithPreview[]
  workflowId?: string
  workspaceId: string
}

async function compressImage(file: File): Promise<File> {
  if (file.size < TARGET_SIZE_MB * 1024 * 1024 || file.type === 'image/gif') {
    return file
  }

  try {
    const compressedFile = await imageCompression(file, {
      maxSizeMB: TARGET_SIZE_MB,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: file.type,
      initialQuality: 0.8,
      alwaysKeepResolution: true,
    })

    return new File([compressedFile], file.name, {
      type: file.type,
      lastModified: Date.now(),
    })
  } catch (error) {
    logger.warn('Image compression failed, using original file:', { error })
    return file
  }
}

async function submitHelpRequest({ data, images, workflowId, workspaceId }: SubmitHelpVariables) {
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

  // boundary-raw-fetch: multipart/form-data submission with image attachments, requestJson only supports JSON bodies
  const response = await fetch('/api/help', {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => null)
    throw new Error(errorData?.error || 'Failed to submit help request')
  }
}

export function HelpModal({ open, onOpenChange, workflowId, workspaceId }: HelpModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const imagesRef = useRef<ImageWithPreview[]>([])

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

  const helpMutation = useMutation({
    mutationFn: submitHelpRequest,
    onSuccess: (_data, variables) => {
      setSubmitStatus('success')
      reset()
      variables.images.forEach((image) => URL.revokeObjectURL(image.preview))
      setImages([])
    },
    onError: (error) => {
      logger.error('Error submitting help request:', { error })
      setSubmitStatus('error')
    },
  })

  useEffect(() => {
    imagesRef.current = images
  }, [images])

  useEffect(() => {
    if (open) {
      setSubmitStatus(null)
      setIsDragging(false)
      setIsProcessing(false)
      helpMutation.reset()
      reset({
        subject: '',
        message: '',
        type: DEFAULT_REQUEST_TYPE,
      })
    } else {
      const previewsToRevoke = imagesRef.current
      if (previewsToRevoke.length > 0) {
        previewsToRevoke.forEach((image) => URL.revokeObjectURL(image.preview))
        setImages([])
      }
    }
  }, [open, reset])

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.preview))
    }
  }, [])

  useEffect(() => {
    if (submitStatus === 'success') {
      const timer = setTimeout(() => {
        setSubmitStatus(null)
      }, SUCCESS_RESET_DELAY_MS)
      return () => clearTimeout(timer)
    }
  }, [submitStatus])

  useEffect(() => {
    if (images.length > 0 && scrollContainerRef.current) {
      const scrollContainer = scrollContainerRef.current
      const timer = setTimeout(() => {
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight,
          behavior: 'smooth',
        })
      }, SCROLL_DELAY_MS)
      return () => clearTimeout(timer)
    }
  }, [images.length])

  async function processFiles(files: FileList | File[]) {
    if (!files || files.length === 0) return

    setIsProcessing(true)

    try {
      const newImages: ImageWithPreview[] = []
      let hasError = false

      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_SIZE) {
          hasError = true
          continue
        }

        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
          hasError = true
          continue
        }

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

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      await processFiles(e.target.files)
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(e.dataTransfer.files)
    }
  }

  function removeImage(index: number) {
    setImages((prev) => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  function onSubmit(data: FormValues) {
    if (helpMutation.isPending) return
    setSubmitStatus(null)
    helpMutation.mutate({ data, images, workflowId, workspaceId })
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='md'>
        <ModalHeader>Help &amp; Support</ModalHeader>

        <form onSubmit={handleSubmit(onSubmit)} className='flex min-h-0 flex-1 flex-col'>
          <ModalBody>
            <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto'>
              <div className='space-y-3'>
                <div className='flex flex-col gap-2'>
                  <p className='font-medium text-[var(--text-secondary)] text-sm'>Request</p>
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

                <div className='flex flex-col gap-2'>
                  <p className='font-medium text-[var(--text-secondary)] text-sm'>Subject</p>
                  <Input
                    id='subject'
                    placeholder='Brief description of your request'
                    {...register('subject')}
                    className={cn(errors.subject && 'border-[var(--text-error)]')}
                  />
                </div>

                <div className='flex flex-col gap-2'>
                  <p className='font-medium text-[var(--text-secondary)] text-sm'>Message</p>
                  <Textarea
                    id='message'
                    placeholder='Please provide details about your request...'
                    rows={6}
                    {...register('message')}
                    className={cn(errors.message && 'border-[var(--text-error)]')}
                  />
                </div>

                <div className='flex flex-col gap-2'>
                  <p className='font-medium text-[var(--text-secondary)] text-sm'>
                    Attach Images (Optional)
                  </p>
                  <Button
                    type='button'
                    variant='default'
                    onClick={() => fileInputRef.current?.click()}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    className={cn(
                      '!bg-[var(--surface-1)] hover-hover:!bg-[var(--surface-4)] w-full justify-center border border-[var(--border-1)] border-dashed py-2.5',
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
                    <div className='flex flex-col gap-0.5 text-center'>
                      <span className='text-[var(--text-primary)]'>
                        {isDragging ? 'Drop images here' : 'Drop images here or click to browse'}
                      </span>
                      <span className='text-[var(--text-tertiary)] text-xs'>
                        PNG, JPEG, WebP, GIF (max 20MB each)
                      </span>
                    </div>
                  </Button>
                </div>

                {images.length > 0 && (
                  <div className='space-y-2'>
                    <p className='font-medium text-[var(--text-secondary)] text-sm'>
                      Uploaded Images
                    </p>
                    <div className='grid grid-cols-2 gap-3'>
                      {images.map((image, index) => (
                        <div
                          className='group relative overflow-hidden rounded-sm border'
                          key={image.preview}
                        >
                          <div className='relative flex max-h-[120px] min-h-[80px] w-full items-center justify-center'>
                            <Image
                              src={image.preview}
                              alt={`Preview ${index + 1}`}
                              fill
                              unoptimized
                              sizes='(max-width: 768px) 100vw, 50vw'
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
                          <div className='truncate p-1.5 text-caption'>{image.name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button
              variant='default'
              onClick={() => onOpenChange(false)}
              type='button'
              disabled={helpMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type='submit'
              variant='primary'
              disabled={helpMutation.isPending || isProcessing}
            >
              {helpMutation.isPending
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
