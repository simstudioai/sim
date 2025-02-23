'use client'

import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const emailSchema = z.string().email('Please enter a valid email')

export default function WaitlistForm() {
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('idle')

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
        setStatus('error')
        return
      }

      setStatus('success')
      setEmail('')
    } catch (error) {
      setStatus('error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getButtonText = () => {
    if (isSubmitting) return 'Joining...'
    if (status === 'success') return 'Joined!'
    if (status === 'error') return 'Try again'
    return 'Join waitlist'
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 items-center max-w-lg mx-auto mt-8"
    >
      <div className="flex w-full gap-3">
        <Input
          type="email"
          placeholder="you@example.com"
          className="flex-1 text-sm md:text-md bg-[#020817] border-white/20 focus:border-white/30 focus:ring-white/30 rounded-md h-[50px]"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isSubmitting}
        />
        <Button
          type="submit"
          className={`rounded-md px-8 h-[48px] ${
            status === 'success'
              ? 'bg-green-500 hover:bg-green-600'
              : status === 'error'
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-white text-black hover:bg-gray-100'
          }`}
          disabled={isSubmitting}
        >
          {getButtonText()}
        </Button>
      </div>
    </form>
  )
}
