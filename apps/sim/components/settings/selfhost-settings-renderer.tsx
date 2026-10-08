'use client'

import dynamic from 'next/dynamic'
import type { SelfHostSettingsSection } from '@/components/settings/navigation'
import { General } from '@/app/workspace/[workspaceId]/settings/components/general/general'
import { useCaptureWhenReady } from '@/hooks/use-capture-when-ready'

const Billing = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/billing/billing').then(
    (module) => module.Billing
  )
)
const ChatKeys = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/copilot/copilot').then(
    (module) => module.Copilot
  )
)

interface SelfHostSettingsRendererProps {
  section: SelfHostSettingsSection
}

export function SelfHostSettingsRenderer({ section }: SelfHostSettingsRendererProps) {
  useCaptureWhenReady('settings_tab_viewed', { plane: 'selfhost', section }, section)

  if (section === 'general') return <General />
  if (section === 'billing') return <Billing scope='account' />
  return <ChatKeys />
}
