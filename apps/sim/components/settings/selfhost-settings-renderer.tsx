'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { usePostHog } from 'posthog-js/react'
import type { SelfHostSettingsSection } from '@/components/settings/navigation'
import { captureEvent } from '@/lib/posthog/client'
import { General } from '@/app/workspace/[workspaceId]/settings/components/general/general'

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
  const posthog = usePostHog()

  useEffect(() => {
    captureEvent(posthog, 'settings_tab_viewed', { plane: 'selfhost', section })
  }, [posthog, section])

  if (section === 'general') return <General />
  if (section === 'billing') return <Billing scope='account' />
  return <ChatKeys />
}
