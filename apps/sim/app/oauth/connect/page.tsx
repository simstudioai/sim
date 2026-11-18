import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import { DesktopHandoffShell } from '@/app/desktop/components/desktop-handoff-shell'
import { ConnectConfirmation } from '@/app/oauth/connect/connect-confirmation'

export const metadata: Metadata = {
  title: 'Connect an account',
  robots: { index: false },
}

export const dynamic = 'force-dynamic'

interface ConnectPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readParam(params: Record<string, string | string[] | undefined>, name: string) {
  const value = params[name]
  return typeof value === 'string' && value ? value : undefined
}

/**
 * Where a workspace connect link lands. The link only names a workspace and a
 * provider, so anyone can craft one, and a same-origin hop (a sign-in, a
 * client-side redirect) makes it look like the user's own navigation. Opening
 * it therefore changes nothing: the connection draft is created only when the
 * signed-in user clicks Continue here.
 */
export default async function ConnectPage({ searchParams }: ConnectPageProps) {
  const params = await searchParams
  const workspaceId = readParam(params, 'workspaceId')
  const providerId = readParam(params, 'providerId')
  const service = providerId ? getServiceConfigByProviderId(providerId) : null
  if (!workspaceId || !providerId || !service) {
    return (
      <DesktopHandoffShell
        title='Connection link incomplete'
        description='Return to Sim and start the connection again.'
      />
    )
  }

  const session = await getSession()
  if (!session?.user) {
    const query = new URLSearchParams()
    for (const [name, value] of Object.entries(params)) {
      if (typeof value === 'string') query.set(name, value)
    }
    redirect(`/login?callbackUrl=${encodeURIComponent(`/oauth/connect?${query.toString()}`)}`)
  }

  return (
    <ConnectConfirmation
      email={session.user.email}
      serviceName={service.name}
      workspaceId={workspaceId}
      providerId={providerId}
      credentialId={readParam(params, 'credentialId')}
      callbackURL={readParam(params, 'callbackURL')}
    />
  )
}
