'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { usePostHog } from 'posthog-js/react'
import { SETTINGS_SECTION_LOADING_OPTIONS } from '@/components/settings/lazy-section'
import type { AccountSettingsSection } from '@/components/settings/navigation'
import { captureEvent } from '@/lib/posthog/client'
import { General } from '@/app/workspace/[workspaceId]/settings/components/general/general'

const Billing = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/billing/billing').then(
      (module) => module.Billing
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const ApiKeys = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/api-keys/api-keys').then(
      (module) => module.ApiKeys
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const Admin = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/admin/admin').then(
      (module) => module.Admin
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)
const Mothership = dynamic(
  () =>
    import('@/app/workspace/[workspaceId]/settings/components/mothership/mothership').then(
      (module) => module.Mothership
    ),
  SETTINGS_SECTION_LOADING_OPTIONS
)

interface AccountSettingsRendererProps {
  section: AccountSettingsSection
}

export function AccountSettingsRenderer({ section }: AccountSettingsRendererProps) {
  const posthog = usePostHog()

  useEffect(() => {
    captureEvent(posthog, 'settings_tab_viewed', { plane: 'account', section })
  }, [posthog, section])

  if (section === 'general') return <General />
  if (section === 'billing') return <Billing scope='account' />
  if (section === 'api-keys') return <ApiKeys scope='personal' />
  if (section === 'admin') return <Admin />
  return <Mothership />
}
