'use client'

import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const emailSchema = z.string().email('Please enter a valid email')

export default function WaitlistForm() {
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'exists' | 'ratelimited'>(
    'idle'
  )
  const [_errorMessage, setErrorMessage] = useState('')
  const [_retryAfter, setRetryAfter] = useState<number | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('idle')
    setErrorMessage('')
    setRetryAfter(null)

    try {
      // Validate email
      emailSchema.parse(email)

      setIsSubmitting(true)
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (!response.ok) {
        // Check for rate limiting (429 status)
        if (response.status === 429) {
          setStatus('ratelimited')
          setErrorMessage(data.message || 'Too many attempts. Please try again later.')
          setRetryAfter(data.retryAfter || 60)
        }
        // Check if the error is because the email already exists
        else if (response.status === 400 && data.message?.includes('already exists')) {
          setStatus('exists')
          setErrorMessage('Already on the waitlist')
        } else {
          setStatus('error')
          setErrorMessage(data.message || 'Failed to join waitlist')
        }
        return
      }

      setStatus('success')
      setEmail('')
    } catch (_error) {
      setStatus('error')
      setErrorMessage('Please try again')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getButtonText = () => {
    if (isSubmitting) return 'Joining...'
    if (status === 'success') return 'Joined!'
    if (status === 'error') return 'Try again'
    if (status === 'exists') return 'Already joined'
    if (status === 'ratelimited') return 'Try again later'
    return 'Join waitlist'
  }

  const getButtonStyle = () => {
    switch (status) {
      case 'success':
        return 'bg-green-500 hover:bg-green-600'
      case 'error':
        return 'bg-red-500 hover:bg-red-600'
      case 'exists':
        return 'bg-amber-500 hover:bg-amber-600'
      case 'ratelimited':
        return 'bg-gray-500 hover:bg-gray-600'
      default:
        return 'bg-white text-black hover:bg-gray-100'
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className='mx-auto mt-8 flex max-w-lg flex-col items-center gap-3'
    >
      <div className='flex w-full gap-3'>
        <Input
          type='email'
          placeholder='you@example.com'
          className='h-[49px] flex-1 rounded-md border-white/20 bg-[#020817] text-sm focus:border-white/30 focus:ring-white/30 md:text-md lg:text-[16px]'
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isSubmitting || status === 'ratelimited'}
        />
        <Button
          type='submit'
          className={`h-[48px] rounded-md px-8 text-sm md:text-md ${getButtonStyle()}`}
          disabled={isSubmitting || status === 'ratelimited'}
        >
          {getButtonText()}
        </Button>
      </div>
    </form>
  )
}
