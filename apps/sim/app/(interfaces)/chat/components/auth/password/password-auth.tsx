'use client'

import { useState } from 'react'
import { cn, Label } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { PublicAuthHeader } from '@/components/auth/public-auth-header'
import { AuthSubmitButton, PasswordInput } from '@/app/(auth)/components'
import { useChatPasswordAuth } from '@/hooks/queries/chats'

const logger = createLogger('PasswordAuth')

interface PasswordAuthProps {
  identifier: string
}

export default function PasswordAuth({ identifier }: PasswordAuthProps) {
  const [password, setPassword] = useState('')
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])
  const hasPasswordError = passwordErrors.length > 0
  const authenticate = useChatPasswordAuth(identifier)

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setPassword(newPassword)
    setPasswordErrors([])
  }

  const handleAuthenticate = async () => {
    if (!password.trim()) {
      setPasswordErrors(['Password is required'])
      return
    }

    try {
      await authenticate.mutateAsync({ password })
      setPassword('')
    } catch (error) {
      logger.error('Authentication error:', error)
      setPasswordErrors([toError(error).message || 'Invalid password. Please try again.'])
    }
  }

  return (
    <div className='flex flex-1 items-center justify-center px-4 py-16'>
      <div className='w-full max-w-[410px]'>
        <div className='flex flex-col items-center justify-center'>
          <PublicAuthHeader
            title='Password Required'
            description='This chat is password-protected'
          />

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
                <PasswordInput
                  id='password'
                  name='password'
                  required
                  autoCapitalize='none'
                  autoComplete='new-password'
                  autoCorrect='off'
                  placeholder='Enter password'
                  value={password}
                  onChange={handlePasswordChange}
                  className='h-[34px]'
                  error={hasPasswordError}
                />
                <div
                  className={cn(
                    'absolute right-0 left-0 z-10 grid transition-[grid-template-rows] duration-200 ease-out',
                    hasPasswordError ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                  )}
                  aria-live='polite'
                >
                  <div className='overflow-hidden'>
                    <div className='mt-1 space-y-1 text-[var(--text-error)] text-xs'>
                      {passwordErrors.map((error) => (
                        <p key={error}>{error}</p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <AuthSubmitButton
              type='submit'
              disabled={!password.trim()}
              loading={authenticate.isPending}
              loadingLabel='Authenticating…'
            >
              Continue
            </AuthSubmitButton>
          </form>
        </div>
      </div>
    </div>
  )
}
