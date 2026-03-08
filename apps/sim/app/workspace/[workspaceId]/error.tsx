'use client'

import { ErrorState } from '@/app/workspace/[workspaceId]/components'

interface WorkspaceErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function WorkspaceError({ error, reset }: WorkspaceErrorProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Something went wrong'
      description='An unexpected error occurred. Please try again or refresh the page.'
      loggerName='WorkspaceError'
    />
  )
}
