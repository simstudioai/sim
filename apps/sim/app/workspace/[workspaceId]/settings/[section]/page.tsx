import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { verifyWorkspaceMembership } from '@/app/api/workflows/utils'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'
import { SettingsPage } from './settings-page'

interface SettingsSectionPageProps {
  params: Promise<{
    workspaceId: string
    section: string
  }>
}

export default async function SettingsSectionPage({ params }: SettingsSectionPageProps) {
  const { workspaceId, section } = await params
  const session = await getSession()

  if (!session?.user?.id) {
    redirect('/')
  }

  const hasPermission = await verifyWorkspaceMembership(session.user.id, workspaceId)
  if (!hasPermission) {
    redirect('/')
  }

  return <SettingsPage section={section as SettingsSection} />
}
