'use client'

import { useEffect } from 'react'
import { createLogger } from '@sim/logger'
import type { ErrorBoundaryProps } from '@/app/workspace/[workspaceId]/components/error/error'
import { RouteStatus } from '@/platform/app/(shell)/_components/route-status/route-status'
import { Button } from '@/platform/design-system/components/button/button'

const logger = createLogger('OrganizationError')

export default function OrganizationError({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    logger.error('OrganizationError error:', { error: error.message, digest: error.digest })
  }, [error.message, error.digest])

  return (
    <RouteStatus
      title='Something went wrong'
      description='An unexpected error occurred. Please try again or refresh the page.'
      actions={
        <Button variant='primary' onClick={reset}>
          Try again
        </Button>
      }
    />
  )
}
