import { redirect } from 'next/navigation'

interface SettingsPageProps {
  params: Promise<{
    workspaceId: string
  }>
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { workspaceId } = await params
  redirect(`/workspace/${workspaceId}/settings/general`)
}
