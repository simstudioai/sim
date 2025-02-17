'use client'

import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const emailSchema = z.string().email('Please enter a valid email')

export default function WaitlistForm() {
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage('')

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
        setMessage(data.message || 'Failed to join waitlist')
        return
      }

      setMessage('Thanks for joining our waitlist!')
      setEmail('')
    } catch (error) {
      if (error instanceof z.ZodError) {
        setMessage('Please enter a valid email')
      } else {
        setMessage(error instanceof Error ? error.message : 'Something went wrong')
      }
    } finally {
      setIsSubmitting(false)
    }
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
          className="flex-1 text-lg bg-[#020817] border-white/20 focus:border-white/30 focus:ring-white/30 rounded-md h-12"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isSubmitting}
        />
        <Button
          type="submit"
          className="bg-white text-black hover:bg-gray-100 rounded-md px-8 h-12"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Joining...' : 'Join waitlist'}
        </Button>
      </div>
      {message && (
        <p className={`text-sm ${message.includes('Thanks') ? 'text-green-400' : 'text-red-400'}`}>
          {message}
        </p>
      )}
    </form>
  )
}
