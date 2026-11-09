import { redirect } from 'next/navigation'
import { StandaloneSettingsShell } from '@/components/settings/standalone-settings-shell'
import { getSession } from '@/lib/auth'
import { resolveDeploymentShape } from '@/lib/core/config/deployment-shape'

export default async function SelfHostSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session?.user) redirect('/login')

  return (
    <StandaloneSettingsShell plane='selfhost' deployment={resolveDeploymentShape()}>
      {children}
    </StandaloneSettingsShell>
  )
}
