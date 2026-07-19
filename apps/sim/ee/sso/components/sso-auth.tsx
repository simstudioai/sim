'use client'

import { type KeyboardEvent, useState } from 'react'
import { cn, Input, Label } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { chatSSOContract } from '@/lib/api/contracts/chats'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { AuthSubmitButton } from '@/app/(auth)/components'

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
      const { eligible } = await requestJson(chatSSOContract, {
        params: { identifier },
        body: { email },
      })

      if (!eligible) {
        setEmailErrors(['Email not authorized for this chat'])
        setShowEmailValidationError(true)
        setIsLoading(false)
        return
      }

      const callbackUrl = `/chat/${identifier}`
      const ssoUrl = `/sso?email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`
      router.push(ssoUrl)
    } catch (error) {
      if (error instanceof ApiClientError) {
        setEmailErrors([error.message || 'Email not authorized for this chat'])
        setShowEmailValidationError(true)
        setIsLoading(false)
        return
      }
      logger.error('SSO authentication error:', error)
      setEmailErrors(['An error occurred during authentication'])
      setShowEmailValidationError(true)
      setIsLoading(false)
    }
  }

  return (
    <div className='flex flex-1 items-center justify-center px-4 py-16'>
      <div className='w-full max-w-[410px]'>
        <div className='flex flex-col items-center justify-center'>
          <div className='space-y-1 text-center'>
            <h1 className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
              SSO Authentication
            </h1>
            <p className='text-[color-mix(in_srgb,var(--text-muted)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
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
                    'border-[var(--text-error)] focus:border-[var(--text-error)]'
                )}
              />
              {showEmailValidationError && emailErrors.length > 0 && (
                <div className='mt-1 space-y-1 text-[var(--text-error)] text-xs'>
                  {emailErrors.map((error) => (
                    <p key={error}>{error}</p>
                  ))}
                </div>
              )}
            </div>

            <AuthSubmitButton loading={isLoading} loadingLabel='Redirecting to SSO…'>
              Continue with SSO
            </AuthSubmitButton>
          </form>
        </div>
      </div>
    </div>
  )
}
