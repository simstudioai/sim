'use client'

import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useMutation } from '@tanstack/react-query'
import Image from 'next/image'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  ACCEPTED_HELP_IMAGE_TYPES,
  compressHelpImage,
  DEFAULT_HELP_REQUEST_TYPE,
  HELP_REQUEST_TYPE_OPTIONS,
  HELP_REQUEST_TYPES,
  MAX_HELP_IMAGE_BYTES,
  submitHelpRequest,
} from '@/lib/help/request'

const logger = createLogger('HelpModal')

const SCROLL_DELAY_MS = 100
const SUCCESS_RESET_DELAY_MS = 2000

const formSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().min(1, 'Message is required'),
  type: z.enum(HELP_REQUEST_TYPES, {
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
  workspaceId?: string
}

interface SubmitHelpVariables {
  data: FormValues
  images: ImageWithPreview[]
  workflowId?: string
  workspaceId?: string
}

export function HelpModal({ open, onOpenChange, workflowId, workspaceId }: HelpModalProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const imagesRef = useRef<ImageWithPreview[]>([])

  const [submitStatus, setSubmitStatus] = useState<'success' | 'error' | null>(null)
  const [images, setImages] = useState<ImageWithPreview[]>([])
  const [isProcessing, setIsProcessing] = useState(false)

  const { control, handleSubmit, reset } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      subject: '',
      message: '',
      type: DEFAULT_HELP_REQUEST_TYPE,
    },
    mode: 'onSubmit',
  })

  const helpMutation = useMutation({
    mutationFn: (variables: SubmitHelpVariables) => submitHelpRequest(variables),
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
      setIsProcessing(false)
      helpMutation.reset()
      reset({
        subject: '',
        message: '',
        type: DEFAULT_HELP_REQUEST_TYPE,
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
        if (file.size > MAX_HELP_IMAGE_BYTES) {
          hasError = true
          continue
        }

        if (!ACCEPTED_HELP_IMAGE_TYPES.includes(file.type)) {
          hasError = true
          continue
        }

        const compressedFile = await compressHelpImage(file)
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
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Contact support' size='md'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>Contact support</ChipModalHeader>

      <form onSubmit={handleSubmit(onSubmit)} className='flex min-h-0 flex-1 flex-col'>
        <button type='submit' hidden disabled={helpMutation.isPending || isProcessing} />
        <ChipModalBody ref={scrollContainerRef} className='max-h-[60vh]'>
          <Controller
            name='type'
            control={control}
            render={({ field, fieldState }) => (
              <ChipModalField
                type='dropdown'
                title='Request'
                value={field.value}
                onChange={field.onChange}
                options={HELP_REQUEST_TYPE_OPTIONS}
                placeholder='Select a request type'
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            name='subject'
            control={control}
            render={({ field, fieldState }) => (
              <ChipModalField
                type='input'
                title='Subject'
                value={field.value}
                onChange={field.onChange}
                placeholder='Brief description of your request'
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            name='message'
            control={control}
            render={({ field, fieldState }) => (
              <ChipModalField
                type='textarea'
                title='Message'
                value={field.value}
                onChange={field.onChange}
                placeholder='Please provide details about your request...'
                rows={6}
                error={fieldState.error?.message}
              />
            )}
          />
          <ChipModalField
            type='file'
            title='Attach images (optional)'
            label='Drop images here or click to browse'
            description='PNG, JPEG, WebP, GIF (max 20MB each)'
            accept={ACCEPTED_HELP_IMAGE_TYPES.join(',')}
            multiple
            onChange={processFiles}
          />

          {images.length > 0 && (
            <ChipModalField type='custom' title='Uploaded images'>
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
                        aria-label='Remove image'
                        type='button'
                        className='absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100'
                        onClick={() => removeImage(index)}
                      >
                        <X className='size-[18px] text-white' />
                      </button>
                    </div>
                    <div className='truncate p-1.5 text-caption'>{image.name}</div>
                  </div>
                ))}
              </div>
            </ChipModalField>
          )}
        </ChipModalBody>

        <ChipModalFooter
          onCancel={() => onOpenChange(false)}
          cancelDisabled={helpMutation.isPending}
          primaryAction={{
            label: helpMutation.isPending
              ? 'Submitting...'
              : submitStatus === 'error'
                ? 'Error'
                : submitStatus === 'success'
                  ? 'Success'
                  : 'Submit',
            onClick: () => void handleSubmit(onSubmit)(),
            disabled: helpMutation.isPending || isProcessing,
          }}
        />
      </form>
    </ChipModal>
  )
}
