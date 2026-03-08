'use client'

import { ArrowLeft } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { ErrorState } from '@/app/workspace/[workspaceId]/components'

interface TableErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function TableError({ error, reset }: TableErrorProps) {
  const router = useRouter()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load table'
      description='Something went wrong while loading this table. The table may have been deleted or you may not have permission to view it.'
      loggerName='TableError'
      secondaryAction={{
        label: 'Go back',
        icon: <ArrowLeft className='mr-[6px] h-[14px] w-[14px]' />,
        onClick: () => router.push(`/workspace/${workspaceId}/tables`),
      }}
    />
  )
}
