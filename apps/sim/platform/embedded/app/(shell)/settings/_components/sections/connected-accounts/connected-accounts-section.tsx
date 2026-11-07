'use client'

import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { LoadingRows } from '@sim/emcn/status/query-boundary'
import { useQueryStates } from 'nuqs'
import { credentialGroupsParsers } from '@/ee/credential-groups/search-params'
import {
  ActionRow,
  SectionStack,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/embedded/app/(shell)/settings/_components/section-registry'
import { GroupAccess } from '@/platform/embedded/app/(shell)/settings/_components/sections/connected-accounts/group-access'
import { GroupPeople } from '@/platform/embedded/app/(shell)/settings/_components/sections/connected-accounts/group-people'
import { GroupProviders } from '@/platform/embedded/app/(shell)/settings/_components/sections/connected-accounts/group-providers'
import { useCredentialGroupSettings } from '@/platform/embedded/lib/data/credential-groups'

const VIEWS = [
  { value: 'providers', label: 'Providers' },
  { value: 'people', label: 'People' },
  { value: 'workspace-access', label: 'Access' },
] as const

export default function ConnectedAccountsSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const { settings, failure, setUpPending, setUp } = useCredentialGroupSettings(organizationId)
  const [{ tab }, setView] = useQueryStates(credentialGroupsParsers)
  if (failure)
    return (
      <FailureNotice
        message={failure.message}
        retrying={failure.retrying}
        onRetry={failure.retry}
      />
    )
  if (!settings) return <LoadingRows label='Loading credential groups…' />
  if (!settings.canManage)
    return <EmptyState title='An organization admin manages credential groups.' />
  const group = settings.credentialGroup
  if (!group)
    return (
      <SettingsSection title='Setup'>
        <SettingsRow
          label='Shared account pool'
          description='Set up one shared account pool for your organization. Workspaces have no access until you allow them.'
        >
          <Button variant='primary' size='compact' disabled={setUpPending} onClick={setUp}>
            Set up credential groups
          </Button>
        </SettingsRow>
      </SettingsSection>
    )
  return (
    <SectionStack>
      <ActionRow>
        <SegmentedControl
          label='Credential groups views'
          options={VIEWS}
          value={tab}
          onSelect={(value) => void setView({ tab: value })}
        />
      </ActionRow>
      {tab === 'providers' && (
        <GroupProviders
          organizationId={organizationId}
          group={group}
          availableProviders={settings.availableProviders}
          availableMcpConnectors={settings.availableMcpConnectors}
        />
      )}
      {tab === 'people' && <GroupPeople organizationId={organizationId} />}
      {tab === 'workspace-access' && <GroupAccess organizationId={organizationId} />}
    </SectionStack>
  )
}
