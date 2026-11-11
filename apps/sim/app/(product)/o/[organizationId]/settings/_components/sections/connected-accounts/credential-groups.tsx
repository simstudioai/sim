'use client'

import { type ReactNode, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { useQueryState } from 'nuqs'
import { SectionStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import { GroupAccess } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/group-access'
import { GroupPeople } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/group-people'
import { GroupProviders } from '@/app/(product)/o/[organizationId]/settings/_components/sections/connected-accounts/group-providers'
import type { CredentialGroupActions } from '@/platform/lib/data/credential-group-actions'
import { credentialGroupTabParser } from '@/platform/lib/data/credential-group-people'
import type {
  CredentialGroupPeople,
  CredentialGroupsData,
  CredentialProvider,
} from '@/platform/lib/data/models/connected-accounts'

const VIEWS = [
  { value: 'providers', label: 'Integrations' },
  { value: 'people', label: 'People' },
  { value: 'workspace-access', label: 'Access' },
] as const

interface CredentialGroupsProps {
  data: CredentialGroupsData
  people: CredentialGroupPeople
  actions: CredentialGroupActions
  /** URL changes stay on the client, where the data is already whole; otherwise the server reads them. */
  shallow: boolean
  renderSlackSetup: (provider: CredentialProvider, onClose: () => void) => ReactNode
}

export function CredentialGroups({
  data,
  people,
  actions,
  shallow,
  renderSlackSetup,
}: CredentialGroupsProps) {
  const [tab, setTab] = useQueryState('tab', credentialGroupTabParser.withOptions({ shallow }))
  const [settingUp, setSettingUp] = useState(false)
  if (!data.canManage) return <EmptyState title='An organization admin manages credential groups' />
  if (!data.setup)
    return (
      <SettingsSection title='Setup'>
        <SettingsRow
          label='Shared account pool'
          description='Workspaces have no access until you allow them'
        >
          <Button
            size='compact'
            disabled={settingUp}
            onClick={() => {
              setSettingUp(true)
              void actions.setUp().finally(() => setSettingUp(false))
            }}
          >
            Set up credential groups
          </Button>
        </SettingsRow>
      </SettingsSection>
    )
  return (
    <SectionStack>
      <SegmentedControl
        label='Credential groups views'
        options={VIEWS}
        value={tab}
        onSelect={(value) => void setTab(value)}
      />
      {tab === 'providers' && (
        <GroupProviders data={data} actions={actions} renderSlackSetup={renderSlackSetup} />
      )}
      {tab === 'people' && <GroupPeople people={people} actions={actions} />}
      {tab === 'workspace-access' && <GroupAccess data={data} actions={actions} />}
    </SectionStack>
  )
}
