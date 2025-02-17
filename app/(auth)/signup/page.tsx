'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { GithubIcon, GoogleIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { client } from '@/lib/auth-client'
import { useNotificationStore } from '@/stores/notifications/store'
import { NotificationList } from '@/app/w/components/notifications/notifications'

export default function SignupPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const { addNotification } = useNotificationStore()

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const name = formData.get('name') as string

    try {
      await client.signUp.email({ email, password, name })
      router.push('/verify-request')
    } catch (err: any) {
      let errorMessage = 'Failed to create account'

      if (err.message?.includes('Password is too short')) {
        errorMessage = 'Password must be at least 8 characters long'
      } else if (err.message?.includes('existing email')) {
        errorMessage = 'An account with this email already exists. Please sign in instead.'
      } else if (err.message?.includes('invalid email')) {
        errorMessage = 'Please enter a valid email address'
      } else if (err.message?.includes('password too long')) {
        errorMessage = 'Password must be less than 128 characters'
      } else if (err.message?.includes('rate limit')) {
        errorMessage = 'Too many signup attempts. Please try again later.'
      } else if (err.message?.includes('network')) {
        errorMessage = 'Network error. Please check your connection and try again.'
      } else if (err.message?.includes('invalid name')) {
        errorMessage = 'Please enter a valid name'
      }

      addNotification('error', errorMessage, null)
    } finally {
      setIsLoading(false)
    }
  }

  async function signUpWithGithub() {
    try {
      await client.signIn.social({ provider: 'github' })
    } catch (err: any) {
      let errorMessage = 'Failed to sign up with GitHub'

      if (err.message?.includes('account exists')) {
        errorMessage = 'An account with this email already exists. Please sign in instead.'
      } else if (err.message?.includes('cancelled')) {
        errorMessage = 'GitHub sign up was cancelled. Please try again.'
      } else if (err.message?.includes('network')) {
        errorMessage = 'Network error. Please check your connection and try again.'
      } else if (err.message?.includes('rate limit')) {
        errorMessage = 'Too many attempts. Please try again later.'
      }

      addNotification('error', errorMessage, null)
    }
  }

  async function signUpWithGoogle() {
    try {
      await client.signIn.social({ provider: 'google' })
    } catch (err: any) {
      let errorMessage = 'Failed to sign up with Google'

      if (err.message?.includes('account exists')) {
        errorMessage = 'An account with this email already exists. Please sign in instead.'
      } else if (err.message?.includes('cancelled')) {
        errorMessage = 'Google sign up was cancelled. Please try again.'
      } else if (err.message?.includes('network')) {
        errorMessage = 'Network error. Please check your connection and try again.'
      } else if (err.message?.includes('rate limit')) {
        errorMessage = 'Too many attempts. Please try again later.'
      }

      addNotification('error', errorMessage, null)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <NotificationList />
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="text-2xl font-bold text-center mb-8">Sim Studio</h1>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Create an account</CardTitle>
            <CardDescription>Enter your details to get started</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6">
              <div className="grid gap-2">
                <Button variant="outline" onClick={signUpWithGithub} className="w-full">
                  <GithubIcon className="mr-2 h-4 w-4" />
                  Continue with GitHub
                </Button>
                <Button variant="outline" onClick={signUpWithGoogle} className="w-full">
                  <GoogleIcon className="mr-2 h-4 w-4" />
                  Continue with Google
                </Button>
              </div>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
                </div>
              </div>
              <form onSubmit={onSubmit}>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" name="name" type="text" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="name@example.com"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" name="password" type="password" required />
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? 'Creating account...' : 'Create account'}
                  </Button>
                </div>
              </form>
            </div>
          </CardContent>
          <CardFooter>
            <p className="text-sm text-gray-500 text-center w-full">
              Already have an account?{' '}
              <Link href="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </main>
  )
}
