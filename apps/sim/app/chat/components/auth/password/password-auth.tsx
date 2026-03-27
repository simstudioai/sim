'use client'

import { type KeyboardEvent, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Input, Label } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import AuthBackground from '@/app/(auth)/components/auth-background'
import { AUTH_SUBMIT_BTN } from '@/app/(auth)/components/auth-button-classes'
import { SupportFooter } from '@/app/(auth)/components/support-footer'
import Navbar from '@/app/(home)/components/navbar/navbar'

const logger = createLogger('PasswordAuth')

interface PasswordAuthProps {
  identifier: string
  onAuthSuccess: () => void
}

export default function PasswordAuth({ identifier, onAuthSuccess }: PasswordAuthProps) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showValidationError, setShowValidationError] = useState(false)
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const [isAuthenticating, setIsAuthenticating] = useState(false)

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAuthenticate()
    }
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setPassword(newPassword)
    setShowValidationError(false)
    setPasswordErrors([])
  }

  const handleAuthenticate = async () => {
    if (!password.trim()) {
      setPasswordErrors(['Password is required'])
      setShowValidationError(true)
      return
    }

    setIsAuthenticating(true)

    try {
      const payload = { password }

      const response = await fetch(`/api/chat/${identifier}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setPasswordErrors([errorData.error || 'Invalid password. Please try again.'])
        setShowValidationError(true)
        return
      }

      onAuthSuccess()
      setPassword('')
    } catch (error) {
      logger.error('Authentication error:', error)
      setPasswordErrors(['An error occurred during authentication'])
      setShowValidationError(true)
    } finally {
      setIsAuthenticating(false)
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
                  This chat is password-protected
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleAuthenticate()
                }}
                className='mt-8 w-full max-w-[410px] space-y-6'
              >
                <div className='space-y-6'>
                  <div className='flex items-center justify-between'>
                    <Label htmlFor='password'>Password</Label>
                  </div>
                  <div className='relative'>
                    <div className='relative'>
                      <Input
                        id='password'
                        name='password'
                        required
                        type={showPassword ? 'text' : 'password'}
                        autoCapitalize='none'
                        autoComplete='new-password'
                        autoCorrect='off'
                        placeholder='Enter password'
                        value={password}
                        onChange={handlePasswordChange}
                        onKeyDown={handleKeyDown}
                        className={cn(
                          'pr-10',
                          showValidationError &&
                            passwordErrors.length > 0 &&
                            'border-red-500 focus:border-red-500'
                        )}
                        autoFocus
                      />
                      <button
                        type='button'
                        onClick={() => setShowPassword(!showPassword)}
                        className='-translate-y-1/2 absolute top-1/2 right-3 text-[var(--landing-text-muted)] hover:text-[var(--landing-text)]'
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <div
                      className={cn(
                        'absolute right-0 left-0 z-10 grid transition-[grid-template-rows] duration-200 ease-out',
                        showValidationError && passwordErrors.length > 0
                          ? 'grid-rows-[1fr]'
                          : 'grid-rows-[0fr]'
                      )}
                      aria-live='polite'
                    >
                      <div className='overflow-hidden'>
                        <div className='mt-1 space-y-1 text-red-400 text-xs'>
                          {passwordErrors.map((error, index) => (
                            <p key={index}>{error}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type='submit'
                  disabled={!password.trim() || isAuthenticating}
                  className={AUTH_SUBMIT_BTN}
                >
                  {isAuthenticating ? (
                    <span className='flex items-center gap-2'>
                      <Loader2 className='h-4 w-4 animate-spin' />
                      Authenticating...
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
