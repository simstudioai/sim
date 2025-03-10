'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import imageCompression from 'browser-image-compression'
import { AlertCircle, CheckCircle2, Image as ImageIcon, Upload, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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

// Define form schema
const formSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  subject: z.string().min(1, 'Subject is required'),
  message: z.string().min(10, 'Message must be at least 10 characters'),
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

export default function HelpForm() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'success' | 'error' | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [images, setImages] = useState<ImageWithPreview[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

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
      type: undefined,
    },
  })

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
        lastModified: new Date().getTime(),
      })
    } catch (error) {
      console.warn('Image compression failed, using original file:', error)
      return file
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setImageError(null)
    const files = e.target.files

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
      console.error('Error processing images:', error)
      setImageError('An error occurred while processing images. Please try again.')
    } finally {
      setIsProcessing(false)

      // Reset the input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
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
      console.error('Error submitting help request:', error)
      setSubmitStatus('error')
      setErrorMessage(error instanceof Error ? error.message : 'An unknown error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="container mx-auto max-w-2xl py-10">
      <Card className="bg-background border-border">
        <CardHeader>
          <CardTitle className="text-2xl">Help & Support</CardTitle>
          <CardDescription>
            Submit a bug report, feedback, or feature request. Our team will get back to you as soon
            as possible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {submitStatus === 'success' && (
            <Alert className="mb-6 bg-green-50 text-green-800 border-green-200">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle>Success!</AlertTitle>
              <AlertDescription>
                Your request has been submitted successfully. We'll get back to you as soon as
                possible.
              </AlertDescription>
            </Alert>
          )}

          {submitStatus === 'error' && (
            <Alert className="mb-6 bg-red-50 text-red-800 border-red-200">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>
                {errorMessage || 'Failed to submit your request. Please try again.'}
              </AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="type">Request Type</Label>
              <Select onValueChange={(value) => setValue('type', value as FormValues['type'])}>
                <SelectTrigger id="type" className={errors.type ? 'border-red-500' : ''}>
                  <SelectValue placeholder="Select a request type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bug">Bug Report</SelectItem>
                  <SelectItem value="feedback">Feedback</SelectItem>
                  <SelectItem value="feature_request">Feature Request</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              {errors.type && <p className="text-sm text-red-500">{errors.type.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="your.email@example.com"
                className={errors.email ? 'border-red-500' : ''}
                {...register('email')}
              />
              {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                placeholder="Brief description of your request"
                className={errors.subject ? 'border-red-500' : ''}
                {...register('subject')}
              />
              {errors.subject && <p className="text-sm text-red-500">{errors.subject.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                placeholder="Please provide details about your request..."
                className={`min-h-[150px] ${errors.message ? 'border-red-500' : ''}`}
                {...register('message')}
              />
              {errors.message && <p className="text-sm text-red-500">{errors.message.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="images">Attach Images (Optional)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="images"
                  type="file"
                  accept="image/*"
                  multiple
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={isProcessing}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2"
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <span className="animate-spin mr-1">⟳</span>
                      Processing...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Upload Images
                    </>
                  )}
                </Button>
                <p className="text-sm text-muted-foreground">
                  Max 20MB per image. JPEG, PNG, WebP, GIF accepted.
                </p>
              </div>
              {imageError && <p className="text-sm text-red-500 mt-1">{imageError}</p>}

              {images.length > 0 && (
                <div className="mt-4 space-y-2">
                  <Label>Attached Images ({images.length})</Label>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                    {images.map((image, index) => (
                      <div key={index} className="relative group">
                        <div className="relative aspect-square overflow-hidden rounded-md border bg-muted">
                          <div className="h-full w-full relative">
                            <Image
                              src={image.preview}
                              alt={image.name}
                              fill
                              style={{ objectFit: 'cover' }}
                              className="rounded-md"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeImage(index)}
                            className="absolute right-1 top-1 rounded-full bg-foreground/10 p-1 text-white hover:bg-foreground/20 focus:outline-none focus:ring-2 focus:ring-offset-2"
                          >
                            <X className="h-4 w-4" />
                            <span className="sr-only">Remove</span>
                          </button>
                          <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-2 py-1 text-xs text-white truncate">
                            {image.name}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </form>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={isSubmitting || isProcessing}>
            {isSubmitting ? 'Submitting...' : 'Submit Request'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
