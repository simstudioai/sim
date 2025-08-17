'use client'

import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import imageCompression from 'browser-image-compression'
import { AlertCircle, CheckCircle2, Upload, X } from 'lucide-react'
import Image from 'next/image'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

const logger = createLogger('HelpModal')

const formSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().min(1, 'Message is required'),
  type: z.enum(['bug', 'feedback', 'feature_request', 'other'], {
    required_error: 'Please select a request type',
  }),
})

type FormValues = z.infer<typeof formSchema>

// Increased maximum upload size to 20MB
const MAX_FILE_SIZE = 20 * 1024 * 1024
// Target size after compression (2MB)
const TARGET_SIZE_MB = 2
const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']

interface ImageWithPreview extends File {
  preview: string
}

interface HelpModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function HelpModal({ open, onOpenChange }: HelpModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'success' | 'error' | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [images, setImages] = useState<ImageWithPreview[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

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
      type: 'bug', // Set default value to 'bug'
    },
    mode: 'onSubmit',
  })

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      // Reset states when modal opens
      setSubmitStatus(null)
      setErrorMessage('')
      setImageError(null)
      setImages([])
      setIsDragging(false)
      setIsProcessing(false)
      // Reset form to default values
      reset({
        subject: '',
        message: '',
        type: 'bug',
      })
    }
  }, [open, reset])

  // Listen for the custom event to open the help modal
  useEffect(() => {
    const handleOpenHelp = () => {
      onOpenChange(true)
    }

    // Add event listener
    window.addEventListener('open-help', handleOpenHelp as EventListener)

    // Clean up
    return () => {
      window.removeEventListener('open-help', handleOpenHelp as EventListener)
    }
  }, [onOpenChange])

  // Set default value for type on component mount
  useEffect(() => {
    setValue('type', 'bug')
  }, [setValue])

  // Scroll to top when success message appears
  useEffect(() => {
    if (submitStatus === 'success' && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [submitStatus])

  // Clean up object URLs when component unmounts
  useEffect(() => {
    return () => {
      images.forEach((image) => URL.revokeObjectURL(image.preview))
    }
  }, [images])

  // Scroll to bottom when images are added
  useEffect(() => {
    if (images.length > 0 && scrollContainerRef.current) {
      const scrollContainer = scrollContainerRef.current
      setTimeout(() => {
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight,
          behavior: 'smooth',
        })
      }, 100) // Small delay to ensure DOM has updated
    }
  }, [images.length])

  const compressImage = async (file: File): Promise<File> => {
    // Skip compression for small files or GIFs (which don't compress well)
    if (file.size < TARGET_SIZE_MB * 1024 * 1024 || file.type === 'image/gif') {
      return file
    }

    const options = {
      maxSizeMB: TARGET_SIZE_MB,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: file.type,
      // Ensure we maintain proper file naming and MIME types
      initialQuality: 0.8,
      alwaysKeepResolution: true,
    }

    try {
      const compressedFile = await imageCompression(file, options)

      // Create a new File object with the original name and type to ensure compatibility
      return new File([compressedFile], file.name, {
        type: file.type,
        lastModified: Date.now(),
      })
    } catch (error) {
      logger.warn('Image compression failed, using original file:', { error })
      return file
    }
  }

  const processFiles = async (files: FileList | File[]) => {
    setImageError(null)

    if (!files || files.length === 0) return

    setIsProcessing(true)

    try {
      const newImages: ImageWithPreview[] = []
      let hasError = false

      for (const file of Array.from(files)) {
        // Check file size
        if (file.size > MAX_FILE_SIZE) {
          setImageError(`File ${file.name} is too large. Maximum size is 20MB.`)
          hasError = true
          continue
        }

        // Check file type
        if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
          setImageError(
            `File ${file.name} has an unsupported format. Please use JPEG, PNG, WebP, or GIF.`
          )
          hasError = true
          continue
        }

        // Compress the image (behind the scenes)
        const compressedFile = await compressImage(file)

        // Create preview URL
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

      // Reset the input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // Update the existing handleFileChange function to use processFiles
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

  const removeImage = (index: number) => {
    setImages((prev) => {
      // Revoke the URL to avoid memory leaks
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true)
    setSubmitStatus(null)

    try {
      // Create FormData to handle file uploads
      const formData = new FormData()

      // Add form fields (email will be retrieved server-side from session)
      formData.append('subject', data.subject)
      formData.append('message', data.message)
      formData.append('type', data.type)

      // Add images
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

      // Clean up image previews
      images.forEach((image) => URL.revokeObjectURL(image.preview))
      setImages([])
    } catch (error) {
      logger.error('Error submitting help request:', { error })
      setSubmitStatus('error')
      setErrorMessage(error instanceof Error ? error.message : 'An unknown error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    onOpenChange(false)
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className='flex h-[75vh] max-h-[75vh] flex-col gap-0 p-0 sm:max-w-[700px]'>
        <AlertDialogHeader className='flex-shrink-0 px-6 py-5'>
          <AlertDialogTitle className='font-medium text-lg'>Help & Support</AlertDialogTitle>
        </AlertDialogHeader>

        <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden'>
          <form onSubmit={handleSubmit(onSubmit)} className='flex min-h-0 flex-1 flex-col'>
            {/* Scrollable Content */}
            <div
              ref={scrollContainerRef}
              className='scrollbar-hide min-h-0 flex-1 overflow-y-auto pb-20'
            >
              <div className='px-6'>
                {submitStatus === 'success' ? (
                  <Alert className='mb-6 border-border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30'>
                    <div className='flex items-start gap-4 py-1'>
                      <div className='mt-[-1.5px] flex-shrink-0'>
                        <CheckCircle2 className='h-4 w-4 text-green-600 dark:text-green-400' />
                      </div>
                      <div className='mr-4 flex-1 space-y-2'>
                        <AlertTitle className='-mt-0.5 flex items-center justify-between'>
                          <span className='font-medium text-green-600 dark:text-green-400'>
                            Success
                          </span>
                        </AlertTitle>
                        <AlertDescription className='text-green-600 dark:text-green-400'>
                          Your request has been submitted successfully. We'll get back to you soon.
                        </AlertDescription>
                      </div>
                    </div>
                  </Alert>
                ) : submitStatus === 'error' ? (
                  <Alert variant='destructive' className='mb-6'>
                    <AlertCircle className='h-4 w-4' />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>
                      {errorMessage ||
                        'There was an error submitting your request. Please try again.'}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className='space-y-4'>
                  <div className='space-y-2'>
                    <Label htmlFor='type'>Request</Label>
                    <Select
                      defaultValue='bug'
                      onValueChange={(value) => setValue('type', value as any)}
                    >
                      <SelectTrigger
                        id='type'
                        className={`h-9 rounded-[8px] ${errors.type ? 'border-red-500' : ''}`}
                      >
                        <SelectValue placeholder='Select a request type' />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='bug'>Bug Report</SelectItem>
                        <SelectItem value='feedback'>Feedback</SelectItem>
                        <SelectItem value='feature_request'>Feature Request</SelectItem>
                        <SelectItem value='other'>Other</SelectItem>
                      </SelectContent>
                    </Select>
                    {errors.type && (
                      <p className='mt-1 text-red-500 text-sm'>{errors.type.message}</p>
                    )}
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='subject'>Subject</Label>
                    <Input
                      id='subject'
                      placeholder='Brief description of your request'
                      {...register('subject')}
                      className={`h-9 rounded-[8px] ${errors.subject ? 'border-red-500' : ''}`}
                    />
                    {errors.subject && (
                      <p className='mt-1 text-red-500 text-sm'>{errors.subject.message}</p>
                    )}
                  </div>

                  <div className='space-y-2'>
                    <Label htmlFor='message'>Message</Label>
                    <Textarea
                      id='message'
                      placeholder='Please provide details about your request...'
                      rows={6}
                      {...register('message')}
                      className={`rounded-[8px] ${errors.message ? 'border-red-500' : ''}`}
                    />
                    {errors.message && (
                      <p className='mt-1 text-red-500 text-sm'>{errors.message.message}</p>
                    )}
                  </div>

                  {/* Image Upload Section */}
                  <div className='mt-6 space-y-2'>
                    <Label>Attach Images (Optional)</Label>
                    <div
                      ref={dropZoneRef}
                      onDragEnter={handleDragEnter}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      className={`cursor-pointer rounded-lg border-2 border-muted-foreground/25 border-dashed p-6 text-center transition-colors hover:bg-muted/50 ${
                        isDragging ? 'border-primary bg-primary/5' : ''
                      }`}
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
                      <Upload className='mx-auto mb-2 h-8 w-8 text-muted-foreground' />
                      <p className='text-sm'>
                        {isDragging ? 'Drop images here!' : 'Drop images here or click to browse'}
                      </p>
                      <p className='mt-1 text-muted-foreground text-xs'>
                        JPEG, PNG, WebP, GIF (max 20MB each)
                      </p>
                    </div>
                    {imageError && <p className='mt-1 text-red-500 text-sm'>{imageError}</p>}
                    {isProcessing && (
                      <p className='text-muted-foreground text-sm'>Processing images...</p>
                    )}
                  </div>

                  {/* Image Preview Section */}
                  {images.length > 0 && (
                    <div className='space-y-2'>
                      <Label>Uploaded Images</Label>
                      <div className='grid grid-cols-2 gap-4'>
                        {images.map((image, index) => (
                          <div
                            key={index}
                            className='group relative overflow-hidden rounded-md border'
                          >
                            <div className='relative aspect-video'>
                              <Image
                                src={image.preview}
                                alt={`Preview ${index + 1}`}
                                fill
                                className='object-cover'
                              />
                              <div
                                className='absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100'
                                onClick={() => removeImage(index)}
                              >
                                <X className='h-6 w-6 text-white' />
                              </div>
                            </div>
                            <div className='truncate bg-muted/50 p-2 text-xs'>{image.name}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Overlay Footer */}
            <div className='absolute inset-x-0 bottom-0 bg-background'>
              <div className='flex w-full items-center justify-between px-6 py-4'>
                <Button variant='outline' onClick={handleClose} type='button'>
                  Cancel
                </Button>
                <Button
                  type='submit'
                  disabled={isSubmitting || isProcessing}
                  className='bg-[var(--brand-primary-hex)] font-[480] text-primary-foreground shadow-[0_0_0_0_var(--brand-primary-hex)] transition-all duration-200 hover:bg-[var(--brand-primary-hover-hex)] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)] disabled:opacity-50 disabled:hover:shadow-none'
                >
                  {isSubmitting ? 'Submitting...' : 'Submit'}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
