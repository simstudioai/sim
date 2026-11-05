'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useQueryStates } from 'nuqs'
import {
  ActionRow,
  LoadingState,
  SectionStack,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import { GroupAccess } from '@/platform/app/(shell)/settings/_components/sections/connected-accounts/group-access'
import { GroupPeople } from '@/platform/app/(shell)/settings/_components/sections/connected-accounts/group-people'
import { GroupProviders } from '@/platform/app/(shell)/settings/_components/sections/connected-accounts/group-providers'
import {
  Button,
  EmptyState,
  FailureNotice,
  SegmentedControl,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  credentialGroupsParsers,
  useEnsureOrganizationAccounts,
  useOrganizationAccounts,
} from '@/platform/lib/data/credential-groups'

const VIEWS = [
  { value: 'providers', label: 'Integrations' },
  { value: 'people', label: 'People' },
  { value: 'workspace-access', label: 'Access' },
] as const

export default function ConnectedAccountsSection({ organization }: SettingsSectionProps) {
  const organizationId = organization.organization.id
  const accounts = useOrganizationAccounts(organizationId)
  const ensure = useEnsureOrganizationAccounts()
  const [{ tab }, setView] = useQueryStates(credentialGroupsParsers)
  const error = accounts.error ?? ensure.error
  if (error)
    return (
      <FailureNotice
        message={getErrorMessage(error, 'Could not load Credential Groups')}
        retrying={accounts.isFetching || ensure.isPending}
        onRetry={() => {
          ensure.reset()
          void accounts.refetch()
        }}
      />
    )
  if (!accounts.data) return <LoadingState label='Loading Credential Groups…' />
  if (!accounts.data.canManage)
    return <EmptyState title='An organization admin manages Credential Groups.' />
  const group = accounts.data.credentialGroup
  if (!group)
    return (
      <SettingsSection title='Setup'>
        <SettingsRow
          label='Shared account pool'
          description='Set up one shared account pool for your organization. Workspaces have no access until you allow them.'
        >
          <Button
            variant='primary'
            size='compact'
            disabled={ensure.isPending}
            onClick={() => ensure.mutate({ organizationId })}
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
          onSelect={(value) => void setView({ tab: value })}
        />
      </ActionRow>
      {tab === 'providers' && (
        <GroupProviders
          organizationId={organizationId}
          group={group}
          availableProviders={accounts.data.availableProviders}
          availableMcpConnectors={accounts.data.availableMcpConnectors}
        />
      )}
      {tab === 'people' && <GroupPeople organizationId={organizationId} />}
      {tab === 'workspace-access' && <GroupAccess organizationId={organizationId} />}
    </SectionStack>
  )
}
