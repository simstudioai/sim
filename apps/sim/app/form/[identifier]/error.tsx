'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { Button } from '@/components/emcn'

const logger = createLogger('FormError')

interface FormErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function FormError({ error, reset }: FormErrorProps) {
  useEffect(() => {
    logger.error('Form page error:', { error: error.message, digest: error.digest })
  }, [error])

  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-white p-4'>
      <div className='w-full max-w-md text-center'>
        <div className='mb-6'>
          <div className='mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100'>
            <svg
              className='h-8 w-8 text-red-600'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
              aria-hidden='true'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
              />
            </svg>
          </div>
          <h1 className='mb-2 font-semibold text-gray-900 text-xl'>Something went wrong</h1>
          <p className='text-gray-600 text-sm'>
            We encountered an error loading this form. Please try again.
          </p>
        </div>
        <Button onClick={reset} className='w-full' aria-label='Try loading the form again'>
          Try again
        </Button>
      </div>
    </div>
  )
}
