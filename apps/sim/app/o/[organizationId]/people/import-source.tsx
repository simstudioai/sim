import { Chip, ChipLink, ChipModalDescription, ChipModalField } from '@sim/emcn'
import { ShieldCheck, Table } from '@sim/emcn/icons'
import { MicrosoftIcon, OktaIcon } from '@/components/icons'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import type { useScimConnection } from '@/ee/scim/hooks/scim'
import { serializeSsoSettings } from '@/ee/sso/search-params'

export const IMPORT_SOURCES = {
  okta: { name: 'Okta', description: 'Read profiles from your Okta directory', icon: OktaIcon },
  entra: {
    name: 'Microsoft Entra ID',
    description: 'Read profiles from Microsoft Graph',
    icon: MicrosoftIcon,
  },
  directory: {
    name: 'SCIM provisioning',
    description: 'Use directory data already provisioned to Sim',
    icon: ShieldCheck,
  },
  file: { name: 'Spreadsheet', description: 'Upload a CSV or Excel file', icon: Table },
} as const

export type ImportSource = keyof typeof IMPORT_SOURCES

interface ImportSourcePickerProps {
  canProvision: boolean
  onChoose: (source: ImportSource) => void
}

export function ImportSourcePicker({ canProvision, onChoose }: ImportSourcePickerProps) {
  return (
    <>
      <ChipModalDescription>
        Choose a source for a one-time update to members’ job titles, departments, and reporting
        lines.
      </ChipModalDescription>
      <ChipModalField type='custom' title='Source'>
        {() => (
          <div className={RESOURCE_LIST_STACK}>
            {(['okta', 'entra', 'directory', 'file'] as const).map((source) => {
              if (source === 'directory' && !canProvision) return null
              const { name, description, icon: Icon } = IMPORT_SOURCES[source]
              return (
                <SettingsResourceRow
                  key={source}
                  icon={<Icon aria-hidden />}
                  title={name}
                  description={description}
                  clickLabel={name}
                  onClick={() => onChoose(source)}
                  navigable
                />
              )
            })}
          </div>
        )}
      </ChipModalField>
    </>
  )
}

interface ProviderFieldsProps {
  source: 'okta' | 'entra'
  domain: string
  onDomainChange: (value: string) => void
  token: string
  onTokenChange: (value: string) => void
  disabled: boolean
}

export function ProviderFields({
  source,
  domain,
  onDomainChange,
  token,
  onTokenChange,
  disabled,
}: ProviderFieldsProps) {
  const okta = source === 'okta'
  return (
    <>
      <ChipModalDescription>
        {okta
          ? 'Use an Okta API token that can read users in your organization.'
          : 'In Graph Explorer, sign in with your work or school account, grant delegated User.Read.All permission, and copy your access token. Microsoft commercial cloud is supported.'}{' '}
        Sim uses the token for this import only.
      </ChipModalDescription>
      {okta && (
        <ChipModalField
          type='input'
          title='Okta domain'
          placeholder='company.okta.com'
          value={domain}
          autoComplete='off'
          disabled={disabled}
          onChange={onDomainChange}
        />
      )}
      <ChipModalField
        type='input'
        title={okta ? 'API token' : 'Access token'}
        inputType='password'
        placeholder={okta ? 'Paste your token without SSWS' : 'Paste your token without Bearer'}
        autoComplete='off'
        value={token}
        onChange={onTokenChange}
        disabled={disabled}
      />
      <div className='px-2'>
        <ChipLink
          href={
            okta
              ? 'https://developer.okta.com/docs/guides/create-an-api-token/main/'
              : 'https://developer.microsoft.com/en-us/graph/graph-explorer'
          }
          target='_blank'
          rel='noreferrer'
        >
          {okta ? 'Create an Okta API token' : 'Open Graph Explorer'}
        </ChipLink>
      </div>
    </>
  )
}

interface ProvisioningSourceProps {
  organizationId: string
  connection: ReturnType<typeof useScimConnection>
  canOpenSettings: boolean
}

export function ProvisioningSource({
  organizationId,
  connection,
  canOpenSettings,
}: ProvisioningSourceProps) {
  const directory = connection.data?.connection
  const active = directory?.status === 'active'
  return (
    <>
      <ChipModalDescription>
        {connection.isLoading
          ? 'Checking your provisioning connection…'
          : connection.isError
            ? 'Could not load your provisioning connection.'
            : !active
              ? 'Enable SCIM provisioning and assign accounts in your provider to import their profiles.'
              : directory.userCount === 0
                ? 'Your connection is active. Assign accounts to Sim in your identity provider, then refresh here.'
                : `Your connection has ${directory.userCount} provisioned ${directory.userCount === 1 ? 'account' : 'accounts'}. Preview the profile fields and reporting lines sent by your provider.`}
      </ChipModalDescription>
      <div className='flex flex-wrap gap-1 px-2'>
        {canOpenSettings && !connection.isLoading && !connection.error && (
          <ChipLink
            href={serializeSsoSettings(organizationRoutes(organizationId).settingsSection('sso'), {
              tab: 'provisioning',
            })}
          >
            {active ? 'Manage provisioning' : 'Set up provisioning'}
          </ChipLink>
        )}
        {!connection.isLoading && !active && (
          <ChipLink
            href='https://docs.sim.ai/platform/enterprise/scim'
            target='_blank'
            rel='noreferrer'
          >
            Provisioning guide
          </ChipLink>
        )}
        {!connection.isLoading && (
          <Chip disabled={connection.isFetching} onClick={() => void connection.refetch()}>
            {connection.isError ? 'Retry connection' : 'Refresh'}
          </Chip>
        )}
      </div>
    </>
  )
}
