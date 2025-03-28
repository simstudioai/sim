'use client'

import { FormEvent, useEffect, useState } from 'react'
import { LockIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

// The admin password for client components should use NEXT_PUBLIC prefix for accessibility
// In production, setup appropriate env vars and secure access patterns
const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || ''

export default function PasswordAuth({ children }: { children: React.ReactNode }) {
  const [password, setPassword] = useState('')
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Check if already authorized in session storage - client-side only
  useEffect(() => {
    try {
      const auth = sessionStorage.getItem('admin-auth')
      if (auth === 'true') {
        setIsAuthorized(true)
      }
    } catch (error) {
      console.error('Error accessing sessionStorage:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()

    if (password === ADMIN_PASSWORD) {
      setIsAuthorized(true)
      try {
        sessionStorage.setItem('admin-auth', 'true')
        sessionStorage.setItem('admin-auth-token', ADMIN_PASSWORD)
      } catch (error) {
        console.error('Error setting sessionStorage:', error)
      }
      setError(null)
    } else {
      setError('Incorrect password')
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Checking authentication...</p>
      </div>
    )
  }

  if (isAuthorized) {
    return <>{children}</>
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full shadow-lg">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <LockIcon className="h-6 w-6 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl text-center">Admin Access</CardTitle>
          <CardDescription className="text-center">
            Enter your admin password to continue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                autoComplete="off"
                className="w-full"
                autoFocus
              />
              {error && <p className="text-destructive text-sm">{error}</p>}
            </div>
            <Button type="submit" className="w-full">
              Access Admin
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
