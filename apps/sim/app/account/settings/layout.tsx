import { redirect } from 'next/navigation'
import { StandaloneSettingsShell } from '@/components/settings/standalone-settings-shell'
import { getSession } from '@/lib/auth'
import { resolveDeploymentShape } from '@/lib/core/config/deployment-shape'
import { isPlatformAdmin } from '@/lib/permissions/super-user'
import { FeatureFlagsProvider } from '@/app/workspace/[workspaceId]/providers/feature-flags-provider'

export default async function AccountSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session?.user) redirect('/login')
  const isSuperUser = await isPlatformAdmin(session.user.id)

  /** Account settings host no workspace surface, so only the flags its sections read are on. */
  return (
    <FeatureFlagsProvider
      flags={{
        dashboards: false,
        'workflow-tests': false,
        changelog: false,
        'mothership-model-selector': false,
        'mothership-plan-mode': false,
      }}
    >
      <StandaloneSettingsShell
        plane='account'
        isSuperUser={isSuperUser}
        deployment={resolveDeploymentShape()}
      >
        {children}
      </StandaloneSettingsShell>
    </FeatureFlagsProvider>
  )
}
