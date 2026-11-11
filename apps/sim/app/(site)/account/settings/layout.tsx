import { redirect } from 'next/navigation'
import { StandaloneSettingsShell } from '@/components/settings/standalone-settings-shell'
import { isReadOnlyApiKeyCreationEnabled } from '@/lib/api-key/feature-flag'
import { getSession } from '@/lib/auth'
import { resolveDeploymentShape } from '@/lib/core/config/deployment-shape'
import { FeatureFlagsProvider } from '@/lib/core/config/feature-flags-context'
import { isPlatformAdmin } from '@/lib/permissions/super-user'

export default async function AccountSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session?.user) redirect('/login')
  const [isSuperUser, readOnlyApiKeysEnabled] = await Promise.all([
    isPlatformAdmin(session.user.id),
    isReadOnlyApiKeyCreationEnabled(),
  ])

  /** Account settings host no workspace surface, so only the flags its sections read are on. */
  return (
    <FeatureFlagsProvider
      flags={{
        dashboards: false,
        'workflow-tests': false,
        'mothership-model-selector': false,
        'mothership-plan-mode': false,
        'api-key-read-only': readOnlyApiKeysEnabled,
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
