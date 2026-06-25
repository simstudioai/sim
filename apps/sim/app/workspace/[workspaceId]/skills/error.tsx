'use client'

import { type ErrorBoundaryProps, ErrorState } from '@/app/workspace/[workspaceId]/components'

export default function SkillsError({ error, reset }: ErrorBoundaryProps) {
  return (
    <ErrorState
      error={error}
      reset={reset}
      title='Failed to load skills'
      description='Something went wrong while loading your skills. Please try again.'
      loggerName='SkillsError'
    />
  )
}
