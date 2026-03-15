'use client'

import { type KeyboardEvent, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { Input, Label } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import AuthBackground from '@/app/(auth)/components/auth-background'
import { BrandedButton } from '@/app/(auth)/components/branded-button'
import { SupportFooter } from '@/app/(auth)/components/support-footer'
import Navbar from '@/app/(home)/components/navbar/navbar'

const logger = createLogger('SSOAuth')

interface SSOAuthProps {
  identifier: string
}

const validateEmailField = (emailValue: string): string[] => {
  const errors: string[] = []

  if (!emailValue || !emailValue.trim()) {
    errors.push('Email is required.')
    return errors
  }

  const validation = quickValidateEmail(emailValue.trim().toLowerCase())
  if (!validation.isValid) {
    errors.push(validation.reason || 'Please enter a valid email address.')
  }

  return errors
}

export default function SSOAuth({ identifier }: SSOAuthProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [emailErrors, setEmailErrors] = useState<string[]>([])
  const [showEmailValidationError, setShowEmailValidationError] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAuthenticate()
    }
  }

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)
    setShowEmailValidationError(false)
    setEmailErrors([])
  }

  const handleAuthenticate = async () => {
    const emailValidationErrors = validateEmailField(email)
    setEmailErrors(emailValidationErrors)
    setShowEmailValidationError(emailValidationErrors.length > 0)

    if (emailValidationErrors.length > 0) {
      return
    }

    setIsLoading(true)

    try {
      const checkResponse = await fetch(`/api/chat/${identifier}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email, checkSSOAccess: true }),
      })

      if (!checkResponse.ok) {
        const errorData = await checkResponse.json()
        setEmailErrors([errorData.error || 'Email not authorized for this chat'])
        setShowEmailValidationError(true)
        setIsLoading(false)
        return
      }

      const callbackUrl = `/chat/${identifier}`
      const ssoUrl = `/sso?email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`
      router.push(ssoUrl)
    } catch (error) {
      logger.error('SSO authentication error:', error)
      setEmailErrors(['An error occurred during authentication'])
      setShowEmailValidationError(true)
      setIsLoading(false)
    }
  }

  return (
    <AuthBackground className='dark font-[430] font-season'>
      <main className='relative flex min-h-screen flex-col text-[#ECECEC]'>
        <header className='shrink-0 bg-[#1C1C1C]'>
          <Navbar logoOnly />
        </header>
        <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
          <div className='w-full max-w-lg px-4'>
            <div className='flex flex-col items-center justify-center'>
              <div className='space-y-1 text-center'>
                <h1 className='font-[500] text-[#ECECEC] text-[32px] tracking-tight'>
                  SSO Authentication
                </h1>
                <p className='font-[380] text-[#999] text-[16px]'>
                  This chat requires SSO authentication
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleAuthenticate()
                }}
                className='mt-8 w-full max-w-[410px] space-y-6'
              >
                <div className='space-y-2'>
                  <div className='flex items-center justify-between'>
                    <Label htmlFor='email'>Work Email</Label>
                  </div>
                  <Input
                    id='email'
                    name='email'
                    required
                    type='email'
                    autoCapitalize='none'
                    autoComplete='email'
                    autoCorrect='off'
                    placeholder='Enter your work email'
                    value={email}
                    onChange={handleEmailChange}
                    onKeyDown={handleKeyDown}
                    className={cn(
                      showEmailValidationError &&
                        emailErrors.length > 0 &&
                        'border-red-500 focus:border-red-500'
                    )}
                    autoFocus
                  />
                  {showEmailValidationError && emailErrors.length > 0 && (
                    <div className='mt-1 space-y-1 text-red-400 text-xs'>
                      {emailErrors.map((error, index) => (
                        <p key={index}>{error}</p>
                      ))}
                    </div>
                  )}
                </div>

                <BrandedButton type='submit' loading={isLoading} loadingText='Redirecting to SSO'>
                  Continue with SSO
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
