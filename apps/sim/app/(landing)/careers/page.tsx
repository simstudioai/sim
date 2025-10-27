'use client'

import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { LegalLayout } from '@/app/(landing)/components'
import { soehne } from '@/app/fonts/soehne/soehne'

const careersFormSchema = z.object({
  name: z.string().min(2, { message: 'Name must be at least 2 characters' }),
  email: z.string().email({ message: 'Please enter a valid email address' }),
  phone: z.string().optional(),
  position: z.string().min(2, { message: 'Please specify the position you are interested in' }),
  linkedin: z
    .string()
    .url({ message: 'Please enter a valid LinkedIn URL' })
    .optional()
    .or(z.literal('')),
  portfolio: z
    .string()
    .url({ message: 'Please enter a valid portfolio URL' })
    .optional()
    .or(z.literal('')),
  experience: z.enum(['0-1', '1-3', '3-5', '5-10', '10+'], {
    required_error: 'Please select your years of experience',
  }),
  location: z.string().min(2, { message: 'Please enter your location' }),
  message: z
    .string()
    .min(50, { message: 'Please tell us more about yourself (at least 50 characters)' }),
})

type CareersFormValues = z.infer<typeof careersFormSchema>

export default function CareersPage() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const form = useForm<CareersFormValues>({
    resolver: zodResolver(careersFormSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      position: '',
      linkedin: '',
      portfolio: '',
      experience: undefined,
      location: '',
      message: '',
    },
  })

  async function onSubmit(data: CareersFormValues) {
    setIsSubmitting(true)
    setSubmitStatus('idle')

    try {
      const response = await fetch('/api/careers/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error('Failed to submit application')
      }

      setSubmitStatus('success')
      form.reset()
    } catch (error) {
      console.error('Error submitting application:', error)
      setSubmitStatus('error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <LegalLayout title='Join Our Team'>
      <div className={`${soehne.className} mx-auto max-w-2xl`}>
        {/* Form Section */}
        <section className='rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-10'>
          <h2 className='mb-2 font-medium text-2xl sm:text-3xl'>Apply Now</h2>
          <p className='mb-8 text-gray-600 text-sm sm:text-base'>
            Help us build the future of AI workflows
          </p>

          {submitStatus === 'success' && (
            <div className='mb-6 rounded-md border border-green-200 bg-green-50 p-4'>
              <p className='font-medium text-green-800'>Thank you for your application!</p>
              <p className='text-green-700 text-sm'>
                We've received your submission and will get back to you soon.
              </p>
            </div>
          )}

          {submitStatus === 'error' && (
            <div className='mb-6 rounded-md border border-red-200 bg-red-50 p-4'>
              <p className='font-medium text-red-800'>Something went wrong</p>
              <p className='text-red-700 text-sm'>
                Please try again or email us directly at careers@sim.ai
              </p>
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-5'>
              {/* Name and Email */}
              <div className='grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='name'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='font-medium text-sm'>Full Name *</FormLabel>
                      <FormControl>
                        <Input placeholder='John Doe' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='email'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='font-medium text-sm'>Email *</FormLabel>
                      <FormControl>
                        <Input type='email' placeholder='john@example.com' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Phone and Position */}
              <div className='grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='phone'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='font-medium text-sm'>Phone Number</FormLabel>
                      <FormControl>
                        <Input type='tel' placeholder='+1 (555) 123-4567' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='position'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='font-medium text-sm'>Position of Interest *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder='e.g. Full Stack Engineer, Product Designer'
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* LinkedIn and Portfolio */}
              <div className='grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='linkedin'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='font-medium text-sm'>LinkedIn Profile</FormLabel>
                      <FormControl>
                        <Input
                          type='url'
                          placeholder='https://linkedin.com/in/yourprofile'
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='portfolio'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='font-medium text-sm'>Portfolio / Website</FormLabel>
                      <FormControl>
                        <Input type='url' placeholder='https://yourportfolio.com' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Experience and Location */}
              <div className='grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='experience'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='font-medium text-sm'>Years of Experience *</FormLabel>
                      <FormControl>
                        <select
                          className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm'
                          {...field}
                        >
                          <option value=''>Select experience level</option>
                          <option value='0-1'>0-1 years</option>
                          <option value='1-3'>1-3 years</option>
                          <option value='3-5'>3-5 years</option>
                          <option value='5-10'>5-10 years</option>
                          <option value='10+'>10+ years</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='location'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className='font-medium text-sm'>Location *</FormLabel>
                      <FormControl>
                        <Input placeholder='e.g. San Francisco, CA or Remote' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Message */}
              <FormField
                control={form.control}
                name='message'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='font-medium text-sm'>Tell us about yourself *</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder='Tell us about your experience, what excites you about Sim, and why you would be a great fit for this role...'
                        className='min-h-[140px] resize-y'
                        {...field}
                      />
                    </FormControl>
                    <p className='mt-1.5 text-gray-500 text-xs'>Minimum 50 characters</p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Submit Button */}
              <div className='flex justify-end pt-2'>
                <Button type='submit' disabled={isSubmitting} className='min-w-[160px]' size='lg'>
                  {isSubmitting ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      Submitting...
                    </>
                  ) : (
                    'Submit Application'
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </section>

        {/* Additional Info */}
        <section className='mt-6 text-center text-gray-600 text-sm'>
          <p>
            Questions? Email us at{' '}
            <a
              href='mailto:careers@sim.ai'
              className='font-medium text-gray-900 underline transition-colors hover:text-gray-700'
            >
              careers@sim.ai
            </a>
          </p>
        </section>
      </div>
    </LegalLayout>
  )
}
