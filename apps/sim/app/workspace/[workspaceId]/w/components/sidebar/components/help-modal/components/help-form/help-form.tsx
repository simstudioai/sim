'use client'

import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import imageCompression from 'browser-image-compression'
import { AlertCircle, CheckCircle2, Upload, X } from 'lucide-react'
import Image from 'next/image'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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

const logger = createLogger('HelpForm')

// Define form schema
const formSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
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

interface HelpFormProps {
  onClose: () => void
}

export function HelpForm({ onClose }: HelpFormProps) {
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
      email: '',
      subject: '',
      message: '',
      type: 'bug', // Set default value to 'bug'
    },
    mode: 'onChange',
  })

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

      // Add form fields
      formData.append('email', data.email)
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className='flex h-full flex-col'>
      {/* Scrollable Content */}
      <div
        ref={scrollContainerRef}
        className='scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/25 scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'
      >
        <div className='py-4'>
          {submitStatus === 'success' ? (
            <Alert className='mb-6 border-border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30'>
              <div className='flex items-start gap-4 py-1'>
                <div className='mt-[-1.5px] flex-shrink-0'>
                  <CheckCircle2 className='h-4 w-4 text-green-600 dark:text-green-400' />
                </div>
                <div className='mr-4 flex-1 space-y-2'>
                  <AlertTitle className='-mt-0.5 flex items-center justify-between'>
                    <span className='font-medium text-green-600 dark:text-green-400'>Success</span>
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
                {errorMessage || 'There was an error submitting your request. Please try again.'}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='type'>Request</Label>
              <Select defaultValue='bug' onValueChange={(value) => setValue('type', value as any)}>
                <SelectTrigger id='type' className={errors.type ? 'border-red-500' : ''}>
                  <SelectValue placeholder='Select a request type' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='bug'>Bug Report</SelectItem>
                  <SelectItem value='feedback'>Feedback</SelectItem>
                  <SelectItem value='feature_request'>Feature Request</SelectItem>
                  <SelectItem value='other'>Other</SelectItem>
                </SelectContent>
              </Select>
              {errors.type && <p className='mt-1 text-red-500 text-sm'>{errors.type.message}</p>}
            </div>

            <div className='space-y-2'>
              <Label htmlFor='email'>Email</Label>
              <Input
                id='email'
                placeholder='your.email@example.com'
                {...register('email')}
                className={errors.email ? 'border-red-500' : ''}
              />
              {errors.email && <p className='mt-1 text-red-500 text-sm'>{errors.email.message}</p>}
            </div>

            <div className='space-y-2'>
              <Label htmlFor='subject'>Subject</Label>
              <Input
                id='subject'
                placeholder='Brief description of your request'
                {...register('subject')}
                className={errors.subject ? 'border-red-500' : ''}
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
                rows={5}
                {...register('message')}
                className={errors.message ? 'border-red-500' : ''}
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
                className={`flex items-center gap-4 ${
                  isDragging ? 'rounded-md bg-primary/5 p-2' : ''
                }`}
              >
                <input
                  ref={fileInputRef}
                  type='file'
                  accept={ACCEPTED_IMAGE_TYPES.join(',')}
                  onChange={handleFileChange}
                  className='hidden'
                  multiple
                />
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => fileInputRef.current?.click()}
                  className='flex items-center justify-center gap-2'
                >
                  <Upload className='h-4 w-4' />
                  Upload Images
                </Button>
                <p className='text-muted-foreground text-xs'>
                  Drop images here or click to upload. Max 20MB per image.
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
                    <div key={index} className='group relative overflow-hidden rounded-md border'>
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

      {/* Fixed Footer */}
      <div className='mt-auto border-t px-6 pt-4 pb-6'>
        <div className='flex justify-between'>
          <Button variant='outline' onClick={onClose} type='button'>
            Cancel
          </Button>
          <Button type='submit' disabled={isSubmitting || isProcessing}>
            {isSubmitting ? 'Submitting...' : 'Submit'}
          </Button>
        </div>
      </div>
    </form>
  )
}
