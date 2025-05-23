'use client'

import { KeyboardEvent, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

interface PasswordAuthProps {
  subdomain: string
  onAuthSuccess: () => void
  title?: string
  primaryColor?: string
}

export default function PasswordAuth({
  subdomain,
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
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-[450px] flex flex-col p-0 gap-0 overflow-hidden"
        hideCloseButton
      >
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-center">
            <a
              href="https://simstudio.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="mb-2"
            >
              <svg
                width="40"
                height="40"
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
          </div>
          <DialogTitle className="text-lg font-medium text-center">{title}</DialogTitle>
        </DialogHeader>

        <div className="p-6">
          <div className="mb-4 text-center">
            <p className="text-muted-foreground">
              This chat is password-protected. Please enter the password to continue.
            </p>
          </div>

          {authError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm">
              {authError}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleAuthenticate()
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
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
                autoFocus
              />
            </div>

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
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
