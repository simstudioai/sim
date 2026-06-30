'use client'

import { Button } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { useParams, useRouter } from 'next/navigation'
import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function TableError({ error, reset }: ErrorBoundaryProps) {
  const router = useRouter()
  const { workspaceId } = useParams<{ workspaceId: string }>()

  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load table'
      description='Something went wrong while loading this table. The table may have been deleted or you may not have permission to view it.'
      loggerName='TableError'
    >
      <Button
        variant='default'
        size='md'
        onClick={() => router.push(`/workspace/${workspaceId}/tables`)}
      >
        <ArrowLeft className='mr-1.5 size-[14px]' />
        Go back
      </Button>
    </ErrorState>
  )
}
