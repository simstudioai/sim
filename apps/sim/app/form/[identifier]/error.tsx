'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import { BrandedButton } from '@/app/(auth)/components/branded-button'
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
      hideNav
    >
      <BrandedButton onClick={reset}>Try again</BrandedButton>
    </StatusPageLayout>
  )
}
