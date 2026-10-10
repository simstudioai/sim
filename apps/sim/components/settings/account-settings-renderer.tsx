'use client'

import dynamic from 'next/dynamic'
import type { AccountSettingsSection } from '@/components/settings/navigation'
import { General } from '@/app/workspace/[workspaceId]/settings/components/general/general'
import { useCaptureWhenReady } from '@/hooks/use-capture-when-ready'

const Billing = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/billing/billing').then(
    (module) => module.Billing
  )
)
const ApiKeys = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/api-keys/api-keys').then(
    (module) => module.ApiKeys
  )
)
const Admin = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/admin/admin').then(
    (module) => module.Admin
  )
)
const Mothership = dynamic(() =>
  import('@/app/workspace/[workspaceId]/settings/components/mothership/mothership').then(
    (module) => module.Mothership
  )
)

interface AccountSettingsRendererProps {
  section: AccountSettingsSection
}

export function AccountSettingsRenderer({ section }: AccountSettingsRendererProps) {
  useCaptureWhenReady('settings_tab_viewed', { plane: 'account', section }, section)

  if (section === 'general') return <General />
  if (section === 'billing') return <Billing scope='account' />
  if (section === 'api-keys') return <ApiKeys scope='personal' />
  if (section === 'admin') return <Admin />
  return <Mothership />
}
