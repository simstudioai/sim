'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { ActionRow, SectionStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import { GroupAccess } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/group-access'
import { GroupPeople } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/group-people'
import { GroupProviders } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/group-providers'
import type { CredentialGroupsData } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/model'
import type { CredentialGroupActions } from '@/platform/lib/data/credential-group-actions'

const VIEWS = [
  { value: 'providers', label: 'Integrations' },
  { value: 'people', label: 'People' },
  { value: 'workspace-access', label: 'Access' },
] as const
const tabParser = parseAsStringLiteral([
  'providers',
  'people',
  'workspace-access',
] as const).withDefault('providers')

interface CredentialGroupsProps {
  data: CredentialGroupsData
  actions: CredentialGroupActions
  /** URL changes stay on the client, where the data is already whole; otherwise the server reads them. */
  shallow: boolean
}

export function CredentialGroups({ data, actions, shallow }: CredentialGroupsProps) {
  const [tab, setTab] = useQueryState('tab', tabParser.withOptions({ shallow }))
  const [settingUp, setSettingUp] = useState(false)
  if (!data.canManage)
    return <EmptyState title='An organization admin manages Credential Groups.' />
  if (!data.setup)
    return (
      <SettingsSection title='Setup'>
        <SettingsRow
          label='Shared account pool'
          description='Workspaces have no access until you allow them.'
        >
          <Button
            size='compact'
            disabled={settingUp}
            onClick={() => {
              setSettingUp(true)
              void actions.setUp().finally(() => setSettingUp(false))
            }}
          >
            Set up Credential Groups
          </Button>
        </SettingsRow>
      </SettingsSection>
    )
  return (
    <SectionStack>
      <ActionRow>
        <SegmentedControl
          label='Credential Groups views'
          options={VIEWS}
          value={tab}
          onSelect={(value) => void setTab(value)}
        />
      </ActionRow>
      {tab === 'providers' && <GroupProviders data={data} actions={actions} />}
      {tab === 'people' && (
        <GroupPeople
          people={data.people}
          nextCursor={data.nextCursor}
          shallow={shallow}
          actions={actions}
        />
      )}
      {tab === 'workspace-access' && <GroupAccess data={data} actions={actions} />}
    </SectionStack>
  )
}
