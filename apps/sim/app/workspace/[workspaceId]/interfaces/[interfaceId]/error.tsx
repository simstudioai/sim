'use client'

import { Button } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { useParams, useRouter } from 'next/navigation'
import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function InterfaceError({ error, reset }: ErrorBoundaryProps) {
  const router = useRouter()
  const { workspaceId } = useParams<{ workspaceId: string }>()

  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load interface'
      description='Something went wrong while loading this interface. It may have been deleted or you may not have permission to view it.'
      loggerName='InterfaceError'
    >
      <Button
        variant='default'
        size='md'
        onClick={() => router.push(`/workspace/${workspaceId}/interfaces`)}
      >
        <ArrowLeft className='mr-1.5 size-[14px]' />
        Go back
      </Button>
    </ErrorState>
  )
}
