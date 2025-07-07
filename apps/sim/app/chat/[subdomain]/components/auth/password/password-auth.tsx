'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { whitelabelConfig } from '@/lib/whitelabel'

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
  primaryColor = whitelabelConfig.primaryColor,
}: PasswordAuthProps) {
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/chat/${subdomain}/auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Invalid password')
      }

      onAuthSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent
        className='flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[450px]'
        hideCloseButton
      >
        <DialogHeader className='border-b px-6 py-4'>
          <div className='flex items-center justify-center'>
            <a
              href={whitelabelConfig.appUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='mb-2'
            >
              <svg
                width='40'
                height='40'
                viewBox='0 0 50 50'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
                className='rounded-[6px]'
              >
                <rect width='50' height='50' fill={primaryColor} />
                <path
                  d='M34.1455 20.0728H16.0364C12.7026 20.0728 10 22.7753 10 26.1091V35.1637C10 38.4975 12.7026 41.2 16.0364 41.2H34.1455C37.4792 41.2 40.1818 38.4975 40.1818 35.1637V26.1091C40.1818 22.7753 37.4792 20.0728 34.1455 20.0728Z'
                  fill={primaryColor}
                  stroke='white'
                  strokeWidth='3.5'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
                <path
                  d='M25.0919 14.0364C26.7588 14.0364 28.1101 12.6851 28.1101 11.0182C28.1101 9.35129 26.7588 8 25.0919 8C23.425 8 22.0737 9.35129 22.0737 11.0182C22.0737 12.6851 23.425 14.0364 25.0919 14.0364Z'
                  fill={primaryColor}
                  stroke='white'
                  strokeWidth='4'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
                <path
                  d='M25.0915 14.856V19.0277V14.856ZM20.5645 32.1398V29.1216V32.1398ZM29.619 29.1216V32.1398V29.1216Z'
                  fill={primaryColor}
                />
                <path
                  d='M25.0915 14.856V19.0277M20.5645 32.1398V29.1216M29.619 29.1216V32.1398'
                  stroke='white'
                  strokeWidth='4'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
                <circle cx='25' cy='11' r='2' fill={primaryColor} />
              </svg>
            </a>
          </div>
          <div className='text-center'>
            <h2 className='text-lg font-semibold'>Access {title}</h2>
            <p className='text-sm text-muted-foreground'>
              This chat is password protected
            </p>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='flex flex-col gap-4 p-6'>
          <div className='space-y-2'>
            <Label htmlFor='password'>Password</Label>
            <Input
              id='password'
              type='password'
              placeholder='Enter the password'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className='text-sm text-red-500'>
              {error}
            </div>
          )}

          <Button
            type='submit'
            disabled={isLoading}
            className='w-full'
            style={{ backgroundColor: primaryColor }}
          >
            {isLoading ? 'Verifying...' : 'Access Chat'}
          </Button>

          <p className='text-xs text-muted-foreground text-center'>
            By continuing, you agree to our{' '}
            <a href={`${whitelabelConfig.appUrl}/terms`} className='underline hover:text-foreground'>
              Terms of Service
            </a>{' '}
            and{' '}
            <a href={`${whitelabelConfig.appUrl}/privacy`} className='underline hover:text-foreground'>
              Privacy Policy
            </a>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  )
}
