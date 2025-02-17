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

export default function LoginPage() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    try {
      await client.signIn.email({ email, password })
      router.push('/w/1')
    } catch (err) {
      setError('Invalid email or password')
    } finally {
      setIsLoading(false)
    }
  }

  async function signInWithGithub() {
    try {
      await client.signIn.social({ provider: 'github' })
    } catch (err) {
      setError('Failed to sign in with GitHub')
    }
  }

  async function signInWithGoogle() {
    try {
      await client.signIn.social({ provider: 'google' })
    } catch (err) {
      setError('Failed to sign in with Google')
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h1 className="text-2xl font-bold text-center mb-8">Sim Studio</h1>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Enter your credentials to access your account</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6">
              <div className="grid gap-2">
                <Button variant="outline" onClick={signInWithGithub} className="w-full">
                  <GithubIcon className="mr-2 h-4 w-4" />
                  Continue with GitHub
                </Button>
                <Button variant="outline" onClick={signInWithGoogle} className="w-full">
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
                  {error && <p className="text-sm text-red-500">{error}</p>}
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? 'Signing in...' : 'Sign in'}
                  </Button>
                </div>
              </form>
            </div>
          </CardContent>
          <CardFooter>
            <p className="text-sm text-gray-500 text-center w-full">
              Don't have an account?{' '}
              <Link href="/signup" className="text-primary hover:underline">
                Sign up
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </main>
  )
}
