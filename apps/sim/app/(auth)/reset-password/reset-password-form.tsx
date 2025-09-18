'use client'

import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { inter } from '@/app/fonts/inter'

interface RequestResetFormProps {
  email: string
  onEmailChange: (email: string) => void
  onSubmit: (email: string) => Promise<void>
  isSubmitting: boolean
  statusType: 'success' | 'error' | null
  statusMessage: string
  className?: string
}

export function RequestResetForm({
  email,
  onEmailChange,
  onSubmit,
  isSubmitting,
  statusType,
  statusMessage,
  className,
}: RequestResetFormProps) {
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

    window.addEventListener('resize', checkCustomBrand)
    const observer = new MutationObserver(checkCustomBrand)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })

    return () => {
      window.removeEventListener('resize', checkCustomBrand)
      observer.disconnect()
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(email)
  }

  return (
    <form onSubmit={handleSubmit} className={cn(`${inter.className} space-y-8`, className)}>
      <div className='space-y-6'>
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <Label htmlFor='reset-email'>Email</Label>
          </div>
          <Input
            id='reset-email'
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder='Enter your email'
            type='email'
            disabled={isSubmitting}
            required
            className='rounded-[10px] shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100'
          />
          <p className='text-muted-foreground text-sm'>
            We'll send a password reset link to this email address.
          </p>
        </div>

        {/* Status message display */}
        {statusType && statusMessage && (
          <div
            className={cn('text-xs', statusType === 'success' ? 'text-[#4CAF50]' : 'text-red-400')}
          >
            <p>{statusMessage}</p>
          </div>
        )}
      </div>

      <Button
        type='submit'
        disabled={isSubmitting}
        className={`${buttonClass} flex w-full items-center justify-center gap-2 rounded-[10px] border font-medium text-[15px] text-white transition-all duration-200`}
      >
        {isSubmitting ? 'Sending...' : 'Send Reset Link'}
      </Button>
    </form>
  )
}

interface SetNewPasswordFormProps {
  token: string | null
  onSubmit: (password: string) => Promise<void>
  isSubmitting: boolean
  statusType: 'success' | 'error' | null
  statusMessage: string
  className?: string
}

export function SetNewPasswordForm({
  token,
  onSubmit,
  isSubmitting,
  statusType,
  statusMessage,
  className,
}: SetNewPasswordFormProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [validationMessage, setValidationMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
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

    window.addEventListener('resize', checkCustomBrand)
    const observer = new MutationObserver(checkCustomBrand)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })

    return () => {
      window.removeEventListener('resize', checkCustomBrand)
      observer.disconnect()
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password.length < 8) {
      setValidationMessage('Password must be at least 8 characters long')
      return
    }

    if (password !== confirmPassword) {
      setValidationMessage('Passwords do not match')
      return
    }

    setValidationMessage('')
    onSubmit(password)
  }

  return (
    <form onSubmit={handleSubmit} className={cn(`${inter.className} space-y-8`, className)}>
      <div className='space-y-6'>
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <Label htmlFor='password'>New Password</Label>
          </div>
          <div className='relative'>
            <Input
              id='password'
              type={showPassword ? 'text' : 'password'}
              autoCapitalize='none'
              autoComplete='new-password'
              autoCorrect='off'
              disabled={isSubmitting || !token}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder='Enter new password'
              className={cn(
                'rounded-[10px] pr-10 shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                validationMessage &&
                  'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
              )}
            />
            <button
              type='button'
              onClick={() => setShowPassword(!showPassword)}
              className='-translate-y-1/2 absolute top-1/2 right-3 text-gray-500 transition hover:text-gray-700'
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <Label htmlFor='confirmPassword'>Confirm Password</Label>
          </div>
          <div className='relative'>
            <Input
              id='confirmPassword'
              type={showConfirmPassword ? 'text' : 'password'}
              autoCapitalize='none'
              autoComplete='new-password'
              autoCorrect='off'
              disabled={isSubmitting || !token}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder='Confirm new password'
              className={cn(
                'rounded-[10px] pr-10 shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                validationMessage &&
                  'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
              )}
            />
            <button
              type='button'
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className='-translate-y-1/2 absolute top-1/2 right-3 text-gray-500 transition hover:text-gray-700'
              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
            >
              {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {validationMessage && (
          <div className='mt-1 space-y-1 text-red-400 text-xs'>
            <p>{validationMessage}</p>
          </div>
        )}

        {statusType && statusMessage && (
          <div
            className={cn(
              'mt-1 space-y-1 text-xs',
              statusType === 'success' ? 'text-[#4CAF50]' : 'text-red-400'
            )}
          >
            <p>{statusMessage}</p>
          </div>
        )}
      </div>

      <Button
        disabled={isSubmitting || !token}
        type='submit'
        className={`${buttonClass} flex w-full items-center justify-center gap-2 rounded-[10px] border font-medium text-[15px] text-white transition-all duration-200`}
      >
        {isSubmitting ? 'Resetting...' : 'Reset Password'}
      </Button>
    </form>
  )
}
