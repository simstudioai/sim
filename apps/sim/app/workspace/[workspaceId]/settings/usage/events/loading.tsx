'use client'

import { ArrowLeft } from '@sim/emcn-legacy/icons'
import { useParams, useRouter } from 'next/navigation'
import { SettingsPanel } from '@/components/settings/primitives/settings-panel'

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
