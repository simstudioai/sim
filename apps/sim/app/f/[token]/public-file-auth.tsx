'use client'

import { useState } from 'react'
import { AuthField, PasswordInput } from '@sim/auth-ui'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { AuthSubmitButton } from '@/app/(auth)/components'
import { PublicFileAuthShell } from '@/app/f/[token]/public-file-auth-shell'
import { usePublicFileAuth } from '@/hooks/queries/public-shares'

interface PublicFileAuthProps {
  token: string
}

/**
 * Password gate for a protected public file share. On success the
 * `file_auth_{shareId}` cookie is set and the page re-renders the viewer.
 */
export function PublicFileAuth({ token }: PublicFileAuthProps) {
  const router = useRouter()
  const authenticate = usePublicFileAuth(token)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleAuthenticate = async () => {
    if (authenticate.isPending) return
    if (!password.trim()) {
      setError('Password is required.')
      return
    }
    setError(null)
    try {
      await authenticate.mutateAsync({ password })
      router.refresh()
    } catch (err) {
      setError(getErrorMessage(err, 'Invalid password. Please try again.'))
    }
  }

  return (
    <PublicFileAuthShell title='Password required' subtitle='This file is password-protected'>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleAuthenticate()
        }}
        className='au:space-y-5'
      >
        <AuthField htmlFor='password' label='Password' errors={error ? [error] : undefined}>
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
            error={Boolean(error)}
            onChange={(event) => {
              setPassword(event.target.value)
              setError(null)
            }}
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
    </PublicFileAuthShell>
  )
}
