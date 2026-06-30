'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function KnowledgeBaseError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load knowledge base'
      description='Something went wrong while loading this knowledge base. Please try again.'
      loggerName='KnowledgeBaseError'
    />
  )
}
