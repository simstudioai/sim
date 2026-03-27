'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { StatusPageLayout } from '@/app/(auth)/components/status-page-layout'

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
    <StatusPageLayout
      title='Something went wrong'
      description='We encountered an error loading this form. Please try again.'
    >
      <button
        onClick={reset}
        className='inline-flex h-[32px] w-full items-center justify-center gap-2 rounded-[5px] border border-white bg-white px-2.5 font-[430] font-season text-black text-sm transition-colors hover:border-[var(--border-1)] hover:bg-[var(--border-1)] disabled:cursor-not-allowed disabled:opacity-50'
      >
        Try again
      </button>
    </StatusPageLayout>
  )
}
