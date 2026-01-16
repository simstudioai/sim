'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { soehne } from '@/app/_styles/fonts/soehne/soehne'
import AuthBackground from '@/app/(auth)/components/auth-background'
import { BrandedButton } from '@/app/(auth)/components/branded-button'
import { SupportFooter } from '@/app/(auth)/components/support-footer'
import Nav from '@/app/(landing)/components/nav/nav'

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
    <AuthBackground>
      <main className='relative flex min-h-screen flex-col text-foreground'>
        <Nav hideAuthButtons={true} variant='auth' />
        <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
          <div className='w-full max-w-lg px-4'>
            <div className='flex flex-col items-center justify-center'>
              <div className='space-y-1 text-center'>
                <h1
                  className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}
                >
                  Password Required
                </h1>
                <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                  Enter the password to access this form.
                </p>
              </div>

              <form
                onSubmit={handleSubmit}
                className={`${inter.className} mt-8 w-full max-w-[410px] space-y-6`}
              >
                <div className='space-y-2'>
                  <label
                    htmlFor='form-password'
                    className='font-medium text-[14px] text-foreground'
                  >
                    Password
                  </label>
                  <div className='relative'>
                    <Input
                      id='form-password'
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder='Enter password'
                      className={cn(
                        'rounded-[10px] pr-10 shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                        error && 'border-red-500 focus:border-red-500 focus:ring-red-100'
                      )}
                      autoFocus
                    />
                    <button
                      type='button'
                      onClick={() => setShowPassword(!showPassword)}
                      className='-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground hover:text-foreground'
                    >
                      {showPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                    </button>
                  </div>
                  {error && <p className='text-[14px] text-red-500'>{error}</p>}
                </div>

                <BrandedButton
                  type='submit'
                  disabled={!password.trim()}
                  loading={isSubmitting}
                  loadingText='Verifying'
                >
                  Continue
                </BrandedButton>
              </form>
            </div>
          </div>
        </div>
        <SupportFooter position='absolute' />
      </main>
    </AuthBackground>
  )
}
