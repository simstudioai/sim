import type { ReactNode } from 'react'
import { EmptyState } from '@sim/emcn/empty-state'

interface ProfileUnavailableProps {
  action: ReactNode
}

/** The neutral answer for a person this viewer can't reach, whether gone or refused. */
export function ProfileUnavailable({ action }: ProfileUnavailableProps) {
  return (
    <EmptyState
      title='This profile is unavailable'
      description='It may have changed, or you may no longer have access. Return to the directory to find someone else.'
      action={action}
    />
  )
}
