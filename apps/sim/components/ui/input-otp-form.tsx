'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from './button'
import { InputOTP, InputOTPGroup, InputOTPSlot } from './input-otp'

interface OTPInputFormProps {
  onSubmit: (otp: string) => void
  isLoading?: boolean
  error?: string | null
  length?: number
}

export function OTPInputForm({
  onSubmit,
  isLoading = false,
  error = null,
  length = 6,
}: OTPInputFormProps) {
  const [value, setValue] = useState('')

  const handleComplete = (value: string) => {
    setValue(value)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value.length === length && !isLoading) {
      onSubmit(value)
    }
  }

  return (
    <form onSubmit={handleSubmit} className='space-y-4'>
      <div className='flex justify-center'>
        <InputOTP
          maxLength={length}
          value={value}
          onChange={setValue}
          onComplete={handleComplete}
          disabled={isLoading}
          pattern='[0-9]*'
          inputMode='numeric'
          containerClassName='gap-2'
        >
          <InputOTPGroup>
            {Array.from({ length }).map((_, i) => (
              <InputOTPSlot key={i} index={i} className='h-12 w-10' />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>

      {error && <p className='text-center text-destructive text-sm'>{error}</p>}

      <Button type='submit' className='w-full' disabled={value.length !== length || isLoading}>
        {isLoading ? (
          <div className='flex items-center justify-center'>
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
            Verifying...
          </div>
        ) : (
          'Verify'
        )}
      </Button>
    </form>
  )
}
