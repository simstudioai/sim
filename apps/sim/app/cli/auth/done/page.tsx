import type { Metadata } from 'next'
import { AuthShell } from '@/app/(auth)/components'
import { CliAuthDoneView } from '@/app/cli/auth/done/cli-auth-done-view'

export const metadata: Metadata = {
  title: 'Terminal connected',
  robots: { index: false, follow: false },
}

/**
 * The CLI's loopback listener redirects here, so the flow ends on Sim's own
 * chrome instead of a page served by the wizard. Public and sessionless on
 * purpose — it renders a static confirmation and never touches the API.
 */
export default function CliAuthDonePage() {
  return (
    <AuthShell>
      <CliAuthDoneView />
    </AuthShell>
  )
}
