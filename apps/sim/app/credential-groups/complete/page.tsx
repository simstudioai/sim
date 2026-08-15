import type { Metadata } from 'next'
import { AuthHeader, AuthShell } from '@/app/(auth)/components'

export const metadata: Metadata = {
  title: 'Accounts connected',
  robots: { index: false, follow: false },
}

export default function CredentialGroupCompletePage() {
  return (
    <AuthShell>
      <AuthHeader
        title='Accounts connected'
        description='Your accounts are ready to use — you can close this tab.'
      />
    </AuthShell>
  )
}
