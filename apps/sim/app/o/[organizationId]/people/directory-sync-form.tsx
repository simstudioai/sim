import { useState } from 'react'
import {
  Chip,
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalDescription,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { isOrganizationSettingsSectionAvailable } from '@/components/settings/navigation'
import {
  type PeopleSyncConfig,
  type PeopleSyncStatus,
  peopleSyncConfigSchema,
} from '@/lib/api/contracts/people-sync'
import { flattenFieldErrors } from '@/lib/api/contracts/primitives'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { useScimConnection } from '@/ee/scim/hooks/scim'
import { serializeSsoSettings } from '@/ee/sso/search-params'
import type { usePeopleSyncActions } from '@/hooks/queries/people-sync'

interface DirectorySyncFormProps {
  organizationId: string
  source: PeopleSyncConfig['source']
  name: string
  current: PeopleSyncStatus | null
  actions: ReturnType<typeof usePeopleSyncActions>
  onBack: () => void
  onClose: () => void
}

export function DirectorySyncForm({
  organizationId,
  source,
  name,
  current,
  actions,
  onBack,
  onClose,
}: DirectorySyncFormProps) {
  const [domain, setDomain] = useState(current?.domain ?? '')
  const [tenantId, setTenantId] = useState(current?.tenantId ?? '')
  const [clientId, setClientId] = useState(current?.clientId ?? '')
  const [secret, setSecret] = useState('')
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<'domain' | 'token' | 'tenantId' | 'clientId' | 'clientSecret', string>>
  >({})
  const { settingsFeatures } = useOrganizationContext()
  const provisioning = useScimConnection(organizationId, source === 'scim')
  const scimReady = provisioning.isSuccess && provisioning.data.connection?.status === 'active'
  const title = current ? `Update ${name} credentials` : `Connect ${name}`
  const disabled = actions.pending
  const canSubmit =
    source === 'scim'
      ? scimReady
      : secret.trim() && (source === 'okta' ? domain.trim() : tenantId.trim() && clientId.trim())

  function connect() {
    if (disabled) return
    const config = peopleSyncConfigSchema.safeParse(
      source === 'okta'
        ? { source, domain, token: secret }
        : source === 'entra'
          ? { source, tenantId: tenantId.trim(), clientId: clientId.trim(), clientSecret: secret }
          : { source }
    )
    if (!config.success) {
      setFieldErrors(flattenFieldErrors(config.error))
      return
    }
    setFieldErrors({})
    actions.configure(config.data, onBack)
  }

  return (
    <ChipModal open onOpenChange={(open) => !open && onClose()} srTitle={title}>
      <ChipModalHeader onClose={onClose}>{title}</ChipModalHeader>
      <ChipModalBody>
        <ChipModalDescription>
          {source === 'okta'
            ? 'Use an Okta API token with permission to list users in your organization.'
            : source === 'entra'
              ? 'Register an app in your Microsoft Entra tenant and grant administrator consent for the Microsoft Graph User.Read.All application permission. Use the client secret value.'
              : 'Use profiles from your organization’s existing SCIM provisioning connection.'}
        </ChipModalDescription>
        {source === 'okta' && (
          <>
            <ChipModalField
              type='input'
              title='Okta domain'
              error={fieldErrors.domain}
              placeholder='company.okta.com'
              value={domain}
              onChange={setDomain}
              disabled={disabled || Boolean(current?.domain)}
              autoComplete='off'
            />
            <ChipModalField
              type='input'
              title='API token'
              error={fieldErrors.token}
              inputType='password'
              value={secret}
              onChange={setSecret}
              disabled={disabled}
              autoComplete='off'
            />
            <div className='px-2'>
              <ChipLink
                href='https://developer.okta.com/docs/guides/create-an-api-token/main/'
                target='_blank'
                rel='noreferrer'
              >
                Create an Okta API token
              </ChipLink>
            </div>
          </>
        )}
        {source === 'entra' && (
          <>
            <ChipModalField
              type='input'
              title='Tenant ID'
              error={fieldErrors.tenantId}
              placeholder='Directory (tenant) ID'
              value={tenantId}
              onChange={setTenantId}
              disabled={disabled || Boolean(current?.tenantId)}
              autoComplete='off'
            />
            <ChipModalField
              type='input'
              title='Client ID'
              error={fieldErrors.clientId}
              placeholder='Application (client) ID'
              value={clientId}
              onChange={setClientId}
              disabled={disabled}
              autoComplete='off'
            />
            <ChipModalField
              type='input'
              title='Client secret'
              error={fieldErrors.clientSecret}
              inputType='password'
              placeholder='Client secret value'
              value={secret}
              onChange={setSecret}
              disabled={disabled}
              autoComplete='off'
            />
            <div className='px-2'>
              <ChipLink
                href='https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app'
                target='_blank'
                rel='noreferrer'
              >
                Register an application
              </ChipLink>
            </div>
          </>
        )}
        {source === 'scim' && (
          <>
            <ChipModalField type='custom' title='Provisioning connection'>
              {() => (
                <div aria-live='polite'>
                  <p className='text-[var(--text-body)] text-small'>
                    {provisioning.isPending
                      ? 'Checking provisioning…'
                      : provisioning.isError
                        ? 'Could not read the provisioning connection.'
                        : scimReady
                          ? 'Active'
                          : 'Enable provisioning before connecting this source.'}
                  </p>
                  {isOrganizationSettingsSectionAvailable('sso', settingsFeatures) && (
                    <ChipLink
                      href={serializeSsoSettings(
                        organizationRoutes(organizationId).settingsSection('sso'),
                        { tab: 'provisioning' }
                      )}
                    >
                      Manage provisioning
                    </ChipLink>
                  )}
                  {!provisioning.isFetching && !scimReady && (
                    <Chip onClick={() => void provisioning.refetch()}>Check again</Chip>
                  )}
                </div>
              )}
            </ChipModalField>
          </>
        )}
        {source !== 'scim' && (
          <ChipModalDescription>
            Sim stores these credentials encrypted for scheduled syncs.
          </ChipModalDescription>
        )}
        {disabled && (
          <ChipModalDescription>
            Sync is running. You can close this window and return for the result.
          </ChipModalDescription>
        )}
        <ChipModalError>{actions.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onBack}
        cancelLabel='Back'
        cancelDisabled={disabled}
        primaryAction={{
          label: disabled ? 'Syncing…' : current ? 'Save and sync' : 'Connect and sync',
          disabled: Boolean(disabled || !canSubmit),
          onClick: connect,
        }}
      />
    </ChipModal>
  )
}
