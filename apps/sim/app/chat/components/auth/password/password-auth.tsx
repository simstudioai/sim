'use client'

import { type KeyboardEvent, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/emcn'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/core/utils/cn'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { soehne } from '@/app/_styles/fonts/soehne/soehne'
import AuthBackground from '@/app/(auth)/components/auth-background'
import { BrandedButton } from '@/app/(auth)/components/branded-button'
import { SupportFooter } from '@/app/(auth)/components/support-footer'
import Nav from '@/app/(landing)/components/nav/nav'

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
    <AuthBackground>
      <main className='relative flex min-h-screen flex-col text-foreground'>
        <Nav hideAuthButtons={true} variant='auth' />
        <div className='relative z-30 flex flex-1 items-center justify-center px-4 pb-24'>
          <div className='w-full max-w-lg px-4'>
            <div className='flex flex-col items-center justify-center'>
              <div className='space-y-1 text-center'>
                <h1
                  className={`${soehne.className} font-medium text-[32px] text-black tracking-tight`}
                >
                  Password Required
                </h1>
                <p className={`${inter.className} font-[380] text-[16px] text-muted-foreground`}>
                  This chat is password-protected
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleAuthenticate()
                }}
                className={`${inter.className} mt-8 w-full max-w-[410px] space-y-6`}
              >
                <div className='space-y-2'>
                  <div className='flex items-center justify-between'>
                    <Label htmlFor='password'>Password</Label>
                  </div>
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
                        'rounded-[10px] pr-10 shadow-sm transition-colors focus:border-gray-400 focus:ring-2 focus:ring-gray-100',
                        showValidationError &&
                          passwordErrors.length > 0 &&
                          'border-red-500 focus:border-red-500 focus:ring-red-100 focus-visible:ring-red-500'
                      )}
                      autoFocus
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
                  {showValidationError && passwordErrors.length > 0 && (
                    <div className='mt-1 space-y-1 text-red-400 text-xs'>
                      {passwordErrors.map((error, index) => (
                        <p key={index}>{error}</p>
                      ))}
                    </div>
                  )}
                </div>

                <BrandedButton
                  type='submit'
                  disabled={!password.trim()}
                  loading={isAuthenticating}
                  loadingText='Authenticating'
                >
                  Continue
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
