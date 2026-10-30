'use client'

import { useState } from 'react'
import { AuthField, AuthHeader, AuthInput, AuthStack } from '@sim/auth-ui'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { chatSSOContract } from '@/lib/api/contracts/chats'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { AuthShell, AuthSubmitButton } from '@/app/(auth)/components'

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

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value
    setEmail(newEmail)
    setShowEmailValidationError(false)
    setEmailErrors([])
  }

  const handleAuthenticate = async () => {
    if (isLoading) return
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
    <AuthShell>
      <AuthStack>
        <AuthHeader
          title='SSO authentication'
          description='This chat requires SSO authentication'
        />
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleAuthenticate()
          }}
          className='au:space-y-5'
        >
          <AuthField
            htmlFor='email'
            label='Work email'
            errors={showEmailValidationError ? emailErrors : undefined}
          >
            <AuthInput
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
              disabled={isLoading}
              error={showEmailValidationError && emailErrors.length > 0}
            />
          </AuthField>
          <AuthSubmitButton loading={isLoading} loadingLabel='Redirecting to SSO…'>
            Continue with SSO
          </AuthSubmitButton>
        </form>
      </AuthStack>
    </AuthShell>
  )
}
