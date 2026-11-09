'use client'

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
import { useSettingsFixtureDraft } from '@/platform/lib/data/settings-providers'

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
  editable: boolean
  managementHref: string
}

export function CredentialGroups({ data, editable, managementHref }: CredentialGroupsProps) {
  const [tab, setTab] = useQueryState('tab', tabParser.withOptions({ shallow: editable }))
  const { data: groups, update: setDraft } = useSettingsFixtureDraft('connected-accounts', data)
  if (!groups.canManage)
    return <EmptyState title='An organization admin manages Credential Groups.' />
  const manageLink = (
    <Button size='compact' render={<a href={managementHref}>Manage Credential Groups</a>}>
      Manage Credential Groups
    </Button>
  )
  if (!groups.setup)
    return (
      <SettingsSection title='Setup'>
        <SettingsRow
          label='Shared account pool'
          description='Workspaces have no access until you allow them.'
        >
          {editable ? (
            <Button
              size='compact'
              onClick={() => setDraft((current) => ({ ...current, setup: true }))}
            >
              Set up Credential Groups
            </Button>
          ) : (
            manageLink
          )}
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
      {tab === 'providers' && (
        <GroupProviders
          data={groups}
          editable={editable}
          databricks={groups.databricks}
          onConfigure={(databricks) => setDraft((current) => ({ ...current, databricks }))}
          onChange={(configured) => setDraft((current) => ({ ...current, configured }))}
        />
      )}
      {tab === 'people' && (
        <GroupPeople
          people={groups.people}
          nextCursor={groups.nextCursor}
          editable={editable}
          onChange={(people) => setDraft((current) => ({ ...current, people }))}
        />
      )}
      {tab === 'workspace-access' && (
        <GroupAccess
          data={groups}
          editable={editable}
          onChange={(grants) => setDraft((current) => ({ ...current, grants }))}
        />
      )}
      {!editable && (
        <SettingsSection title='Management'>
          <SettingsRow label='Organization account pool'>{manageLink}</SettingsRow>
        </SettingsSection>
      )}
    </SectionStack>
  )
}
