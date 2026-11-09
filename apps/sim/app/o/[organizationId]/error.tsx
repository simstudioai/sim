'use client'

import { useEffect } from 'react'
import { Button } from '@sim/emcn/button'
import { createLogger } from '@sim/logger'
import type { ErrorBoundaryProps } from '@/components/error/error'
import { RouteStatus } from '@/platform/embedded/app/(shell)/_components/route-status/route-status'

const logger = createLogger('OrganizationError')

export default function OrganizationError({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    logger.error('OrganizationError error:', { error: error.message, digest: error.digest })
  }, [error.message, error.digest])

  return (
    <RouteStatus
      title='Something went wrong'
      description='An unexpected error occurred. Try again or refresh the page.'
      actions={
        <Button variant='primary' onClick={reset}>
          Try again
        </Button>
      }
    />
  )
}
