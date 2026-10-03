'use client'

import { ArrowLeft } from '@sim/emcn/icons'
import { useParams, useRouter } from 'next/navigation'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'

export default function UsageEventsLoading() {
  const router = useRouter()
  const { workspaceId } = useParams<{ workspaceId: string }>()

  return (
    <SettingsPanel
      back={{
        text: 'Usage',
        icon: ArrowLeft,
        onSelect: () => router.push(`/workspace/${workspaceId}/settings/usage`),
      }}
      title='Usage events'
      description="Every credit-consuming event across your organization's workspaces."
    />
  )
}
