'use client'

import { KeyboardEvent, useState } from 'react'
import { Loader2, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChatHeader } from '../../header/header'

interface PasswordAuthProps {
  subdomain: string
  starCount: string
  onAuthSuccess: () => void
  title?: string
  primaryColor?: string
}

export default function PasswordAuth({
  subdomain,
  starCount,
  onAuthSuccess,
  title = 'chat',
  primaryColor = '#802FFF',
}: PasswordAuthProps) {
  // Password auth state
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [isAuthenticating, setIsAuthenticating] = useState(false)

  // Handle keyboard input for auth forms
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAuthenticate()
    }
  }

  // Handle authentication
  const handleAuthenticate = async () => {
    if (!password.trim()) {
      setAuthError('Password is required')
      return
    }

    setAuthError(null)
    setIsAuthenticating(true)

    try {
      const payload = { password }

      const response = await fetch(`/api/chat/${subdomain}`, {
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
        setAuthError(errorData.error || 'Authentication failed')
        return
      }

      // Authentication successful, notify parent
      onAuthSuccess()

      // Reset auth state
      setPassword('')
    } catch (error) {
      console.error('Authentication error:', error)
      setAuthError('An error occurred during authentication')
    } finally {
      setIsAuthenticating(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="p-6 max-w-md w-full mx-auto bg-white rounded-xl shadow-md">
        <div className="flex justify-between items-center w-full mb-4">
          <a href="https://simstudio.ai" target="_blank" rel="noopener noreferrer">
            <svg
              width="32"
              height="32"
              viewBox="0 0 50 50"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="rounded-[6px]"
            >
              <rect width="50" height="50" fill="#701FFC" />
              <path
                d="M34.1455 20.0728H16.0364C12.7026 20.0728 10 22.7753 10 26.1091V35.1637C10 38.4975 12.7026 41.2 16.0364 41.2H34.1455C37.4792 41.2 40.1818 38.4975 40.1818 35.1637V26.1091C40.1818 22.7753 37.4792 20.0728 34.1455 20.0728Z"
                fill="#701FFC"
                stroke="white"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M25.0919 14.0364C26.7588 14.0364 28.1101 12.6851 28.1101 11.0182C28.1101 9.35129 26.7588 8 25.0919 8C23.425 8 22.0737 9.35129 22.0737 11.0182C22.0737 12.6851 23.425 14.0364 25.0919 14.0364Z"
                fill="#701FFC"
                stroke="white"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M25.0915 14.856V19.0277V14.856ZM20.5645 32.1398V29.1216V32.1398ZM29.619 29.1216V32.1398V29.1216Z"
                fill="#701FFC"
              />
              <path
                d="M25.0915 14.856V19.0277M20.5645 32.1398V29.1216M29.619 29.1216V32.1398"
                stroke="white"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="25" cy="11" r="2" fill="#701FFC" />
            </svg>
          </a>
          <ChatHeader chatConfig={null} starCount={starCount} />
        </div>
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold mb-2">{title}</h2>
          <p className="text-gray-600">
            This chat is password-protected. Please enter the password to continue.
          </p>
        </div>

        <div className="w-full max-w-sm mx-auto">
          <div className="bg-white dark:bg-black/10 rounded-lg shadow-sm p-6 space-y-4 border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-center">
              <div className="p-2 rounded-full bg-primary/10 text-primary">
                <Lock className="h-5 w-5" />
              </div>
            </div>

            <h2 className="text-lg font-medium text-center">Password Required</h2>
            <p className="text-neutral-500 dark:text-neutral-400 text-sm text-center">
              Enter the password to access this chat
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleAuthenticate()
              }}
            >
              <div className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="password" className="text-sm font-medium sr-only">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter password"
                    disabled={isAuthenticating}
                    autoComplete="new-password"
                    className="w-full"
                  />
                </div>

                {authError && (
                  <div className="text-sm text-red-600 dark:text-red-500">{authError}</div>
                )}

                <Button
                  type="submit"
                  disabled={!password || isAuthenticating}
                  className="w-full"
                  style={{ backgroundColor: primaryColor }}
                >
                  {isAuthenticating ? (
                    <div className="flex items-center justify-center">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Authenticating...
                    </div>
                  ) : (
                    'Continue'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
