'use client'

import { ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function SettingsSectionError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Something went wrong'
      description='An unexpected error occurred. Please try again or refresh the page.'
      loggerName='SettingsSectionError'
    />
  )
}
