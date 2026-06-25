'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function ChatError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load chat'
      description='Something went wrong while loading this chat. Please try again.'
      loggerName='ChatError'
    />
  )
}
