'use client'

import { useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Input, Label } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import AuthBackground from '@/app/(auth)/components/auth-background'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'
import { SupportFooter } from '@/app/(auth)/components/support-footer'
import Navbar from '@/app/(home)/components/navbar/navbar'

interface PasswordAuthProps {
  onSubmit: (password: string) => void
  error?: string | null
}

export function PasswordAuth({ onSubmit, error }: PasswordAuthProps) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password.trim()) return

    setIsSubmitting(true)
    try {
      await onSubmit(password)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthBackground className='dark font-[430] font-season'>
      <main className='relative flex min-h-full flex-col text-[var(--landing-text)]'>
        <header className='shrink-0 bg-[var(--landing-bg)]'>
          <Navbar logoOnly />
        </header>
        <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
          <div className='w-full max-w-lg px-4'>
            <div className='flex flex-col items-center justify-center'>
              <div className='space-y-1 text-center'>
                <h1 className='text-balance font-[430] font-season text-[40px] text-white leading-[110%] tracking-[-0.02em]'>
                  Password Required
                </h1>
                <p className='font-[430] font-season text-[color-mix(in_srgb,var(--landing-text-subtle)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
                  Enter the password to access this form.
                </p>
              </div>

              <form onSubmit={handleSubmit} className='mt-8 w-full max-w-[410px] space-y-6'>
                <div className='space-y-2'>
                  <Label htmlFor='form-password'>Password</Label>
                  <div className='relative'>
                    <Input
                      id='form-password'
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder='Enter password'
                      className={cn(error && 'border-red-500 focus:border-red-500')}
                      autoFocus
                    />
                    <button
                      type='button'
                      onClick={() => setShowPassword(!showPassword)}
                      className='-translate-y-1/2 absolute top-1/2 right-3 text-[var(--landing-text-muted)] hover:text-[var(--landing-text)]'
                    >
                      {showPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                    </button>
                  </div>
                  {error && <p className='text-red-500 text-sm'>{error}</p>}
                </div>

                <button
                  type='submit'
                  disabled={!password.trim() || isSubmitting}
                  className={AUTH_SUBMIT_BTN}
                >
                  {isSubmitting ? (
                    <span className='flex items-center gap-2'>
                      <Loader2 className='h-4 w-4 animate-spin' />
                      Verifying...
                    </span>
                  ) : (
                    'Continue'
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
        <SupportFooter position='absolute' />
      </main>
    </AuthBackground>
  )
}
