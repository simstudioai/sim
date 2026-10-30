'use client'

import { useState } from 'react'
import { AuthField, AuthHeader, AuthStack, PasswordInput } from '@sim/auth-ui'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { AuthShell, AuthSubmitButton } from '@/app/(auth)/components'
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
    if (authenticate.isPending) return
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
    <AuthShell>
      <AuthStack>
        <AuthHeader title='Password required' description='This chat is password-protected' />
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleAuthenticate()
          }}
          className='au:space-y-5'
        >
          <AuthField htmlFor='password' label='Password' errors={passwordErrors}>
            <PasswordInput
              id='password'
              name='password'
              required
              autoComplete='current-password'
              autoCapitalize='none'
              autoCorrect='off'
              placeholder='Enter password'
              value={password}
              disabled={authenticate.isPending}
              error={hasPasswordError}
              onChange={handlePasswordChange}
            />
          </AuthField>
          <AuthSubmitButton
            disabled={!password.trim()}
            loading={authenticate.isPending}
            loadingLabel='Authenticating…'
          >
            Continue
          </AuthSubmitButton>
        </form>
      </AuthStack>
    </AuthShell>
  )
}
