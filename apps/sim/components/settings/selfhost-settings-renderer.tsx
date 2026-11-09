'use client'

import dynamic from 'next/dynamic'
import type { SelfHostSettingsSection } from '@/components/settings/navigation'
import { General } from '@/components/settings/sections/general/general'
import { useCaptureWhenReady } from '@/hooks/use-capture-when-ready'

const Billing = dynamic(() =>
  import('@/components/settings/sections/billing/billing').then((module) => module.Billing)
)
const ChatKeys = dynamic(() =>
  import('@/components/settings/sections/copilot/copilot').then((module) => module.Copilot)
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
