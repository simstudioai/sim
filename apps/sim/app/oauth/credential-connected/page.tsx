import { ChipLink, StatusPageContent } from '@sim/emcn'
import type { Metadata } from 'next'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { LogoShell } from '@/app/(landing)/components/logo-shell'

export const metadata: Metadata = {
  title: 'Credential connected',
  robots: { index: false, follow: false },
}

interface CredentialConnectedPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function CredentialConnectedPage({
  searchParams,
}: CredentialConnectedPageProps) {
  const params = await searchParams
  const result = typeof params.result === 'string' ? params.result : undefined
  const error = Array.isArray(params.error) ? params.error[0] : params.error
  const connected = result === 'connected' && !error

  return (
    <LogoShell center>
      <StatusPageContent
        title={connected ? 'Credential connected' : 'Connection failed'}
        description={
          connected
            ? 'The credential is ready to use. You can close this tab and return to the app that started the connection.'
            : 'The credential could not be connected. Return to the app that started the connection and try again.'
        }
      >
        <ChipLink variant='primary' href={APP_ENTRY_PATH}>
          Open Sim
        </ChipLink>
      </StatusPageContent>
    </LogoShell>
  )
}
