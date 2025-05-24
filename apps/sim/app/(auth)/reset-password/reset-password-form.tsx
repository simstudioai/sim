'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface RequestResetFormProps {
  email: string
  onEmailChange: (email: string) => void
  onSubmit: (email: string) => Promise<void>
  isSubmitting: boolean
  statusType: 'success' | 'error' | null
  statusMessage: string
  className?: string
}

export function RequestResetForm({
  email,
  onEmailChange,
  onSubmit,
  isSubmitting,
  statusType,
  statusMessage,
  className,
}: RequestResetFormProps) {
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(email)
  }

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="reset-email">Email</Label>
          <Input
            id="reset-email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="your@email.com"
            type="email"
            disabled={isSubmitting}
            required
            className="placeholder:text-white/60"
          />
          <p className="text-sm text-muted-foreground">
            We'll send a password reset link to this email address.
          </p>
        </div>

        {/* Status message display */}
        {statusType && (
          <div
            className={cn(
              'p-3 rounded-md text-sm border',
              statusType === 'success'
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-red-50 text-red-700 border-red-200'
            )}
          >
            {statusMessage}
          </div>
        )}

        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending...
            </>
          ) : (
            'Send Reset Link'
          )}
        </Button>
      </div>
    </form>
  )
}

interface SetNewPasswordFormProps {
  token: string | null
  onSubmit: (password: string) => Promise<void>
  isSubmitting: boolean
  statusType: 'success' | 'error' | null
  statusMessage: string
  className?: string
}

export function SetNewPasswordForm({
  token,
  onSubmit,
  isSubmitting,
  statusType,
  statusMessage,
  className,
}: SetNewPasswordFormProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [validationMessage, setValidationMessage] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Simple validation
    if (password.length < 8) {
      setValidationMessage('Password must be at least 8 characters long')
      return
    }

    if (password !== confirmPassword) {
      setValidationMessage('Passwords do not match')
      return
    }

    setValidationMessage('')
    onSubmit(password)
  }

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="password">New Password</Label>
          <Input
            id="password"
            type="password"
            autoCapitalize="none"
            autoComplete="new-password"
            autoCorrect="off"
            disabled={isSubmitting || !token}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="Enter new password"
            className="placeholder:text-white/60"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoCapitalize="none"
            autoComplete="new-password"
            autoCorrect="off"
            disabled={isSubmitting || !token}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            placeholder="Confirm new password"
            className="placeholder:text-white/60"
          />
        </div>

        {validationMessage && (
          <div className="p-3 rounded-md text-sm border bg-red-50 text-red-700 border-red-200">
            {validationMessage}
          </div>
        )}

        {statusType && (
          <div
            className={cn(
              'p-3 rounded-md text-sm border',
              statusType === 'success'
                ? 'bg-green-50 text-green-700 border-green-200'
                : 'bg-red-50 text-red-700 border-red-200'
            )}
          >
            {statusMessage}
          </div>
        )}

        <Button disabled={isSubmitting || !token} type="submit" className="w-full">
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Resetting...
            </>
          ) : (
            'Reset Password'
          )}
        </Button>
      </div>
    </form>
  )
}
