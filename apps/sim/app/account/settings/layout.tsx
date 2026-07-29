import { redirect } from 'next/navigation'
import { StandaloneSettingsShell } from '@/components/settings/standalone-settings-shell'
import { getSession } from '@/lib/auth'
import { verifyEffectiveSuperUser } from '@/lib/permissions/super-user'

export default async function AccountSettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session?.user) redirect('/login')
  const { effectiveSuperUser, isSuperUser } = await verifyEffectiveSuperUser(session.user.id)

  return (
    <StandaloneSettingsShell
      plane='account'
      isSuperUser={isSuperUser}
      isEffectiveSuperUser={effectiveSuperUser}
    >
      {children}
    </StandaloneSettingsShell>
  )
}
