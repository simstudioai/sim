'use client'

import { useEffect, useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { Button, Input } from '@/components/emcn'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { soehne } from '@/app/_styles/fonts/soehne/soehne'

interface PasswordAuthProps {
  onSubmit: (password: string) => void
  error?: string | null
  primaryColor?: string
}

export function PasswordAuth({ onSubmit, error, primaryColor }: PasswordAuthProps) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [buttonClass, setButtonClass] = useState('auth-button-gradient')

  useEffect(() => {
    const checkCustomBrand = () => {
      const computedStyle = getComputedStyle(document.documentElement)
      const brandAccent = computedStyle.getPropertyValue('--brand-accent-hex').trim()

      if (brandAccent && brandAccent !== '#6f3dfa') {
        setButtonClass('auth-button-custom')
      } else {
        setButtonClass('auth-button-gradient')
      }
    }

    checkCustomBrand()
  }, [])

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
    <div className='w-full max-w-[410px]'>
      <div className='flex flex-col items-center text-center'>
        <div
          className='flex h-14 w-14 items-center justify-center rounded-full'
          style={{ backgroundColor: `${primaryColor}15` }}
        >
          <Lock className='h-6 w-6' style={{ color: primaryColor }} />
        </div>
        <h2
          className={`${soehne.className} mt-4 font-medium text-[32px] text-black tracking-tight`}
        >
          Password Required
        </h2>
        <p className={`${inter.className} mt-2 font-[380] text-[16px] text-muted-foreground`}>
          Enter the password to access this form.
        </p>
      </div>

      <form onSubmit={handleSubmit} className='mt-8 space-y-4'>
        <div className='space-y-2'>
          <label
            htmlFor='form-password'
            className={`${inter.className} font-medium text-[14px] text-foreground`}
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
              className='pr-10'
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
        </div>

        {error && <p className={`${inter.className} text-[14px] text-red-500`}>{error}</p>}

        <Button
          type='submit'
          disabled={isSubmitting || !password.trim()}
          className={`${buttonClass} flex w-full items-center justify-center gap-2 rounded-[10px] border font-medium text-[15px] text-white transition-all duration-200`}
        >
          {isSubmitting ? 'Verifying...' : 'Continue'}
        </Button>
      </form>
    </div>
  )
}
