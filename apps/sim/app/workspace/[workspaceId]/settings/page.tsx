import { redirect } from 'next/navigation'
import { getWorkspaceSettingsHref } from '@/components/settings/navigation'

interface SettingsPageProps {
  params: Promise<{
    workspaceId: string
  }>
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { workspaceId } = await params
  redirect(getWorkspaceSettingsHref(workspaceId, 'teammates'))
}
