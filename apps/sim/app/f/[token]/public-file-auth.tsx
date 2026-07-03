'use client'

import { useState } from 'react'
import { cn, Input, Label } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { Eye, EyeOff } from 'lucide-react'
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
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAuthenticate = async () => {
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
    <PublicFileAuthShell title='Password Required' subtitle='This file is password-protected'>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleAuthenticate()
        }}
        className='space-y-6'
      >
        <div className='space-y-2'>
          <Label htmlFor='password'>Password</Label>
          <div className='relative'>
            <Input
              id='password'
              name='password'
              required
              type={showPassword ? 'text' : 'password'}
              autoCapitalize='none'
              autoComplete='current-password'
              autoCorrect='off'
              placeholder='Enter password'
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(null)
              }}
              className={cn(
                'pr-10',
                error && 'border-[var(--text-error)] focus:border-[var(--text-error)]'
              )}
            />
            <button
              type='button'
              onClick={() => setShowPassword(!showPassword)}
              className='-translate-y-1/2 absolute top-1/2 right-3 text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {error ? <p className='text-[var(--text-error)] text-xs'>{error}</p> : null}
        </div>

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
