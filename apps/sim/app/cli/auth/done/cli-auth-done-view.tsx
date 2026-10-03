import { AuthHeader } from '@/app/(auth)/components'
import type { CliAuthDoneStatus } from '@/app/cli/auth/done/search-params'

interface CliAuthDoneViewProps {
  status: CliAuthDoneStatus
}

export function CliAuthDoneView({ status }: CliAuthDoneViewProps) {
  return (
    <AuthHeader
      title={status === 'cancelled' ? 'Sign-in cancelled' : 'Approved'}
      description={
        status === 'cancelled'
          ? 'You can close this tab and return to your terminal.'
          : 'Your terminal is finishing up — you can close this tab.'
      }
    />
  )
}
