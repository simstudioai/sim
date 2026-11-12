'use client'

import { type ComponentType, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipTextarea,
  SecretInput,
} from '@sim/emcn'
import { resourceScopeFromOwner, resourceScopeKey } from '@/lib/core/resource-scope'
import { DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  KeylessTrustFields,
  keylessConfigFields,
  useKeylessSetup,
  useSavedConnectionSubmit,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/keyless-connection'
import { withBrandIcon } from '@/blocks/brand-icon'

interface DatabricksAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  organizationId?: string
  serviceIcon: ComponentType<{ className?: string }>
  credentialId?: string
  initialDisplayName?: string
  initialDescription?: string
  onCreated?: (credentialId: string) => void
}

type DatabricksAuthType = 'oidc_federation' | 'service_principal' | 'personal_access_token'

const AUTH_TYPE_HINTS: Record<DatabricksAuthType, string> = {
  oidc_federation:
    'No secret is stored. Sim signs a short-lived token your service principal trusts.',
  service_principal:
    'Sim exchanges the OAuth secret for a short-lived workspace token on each run.',
  personal_access_token: 'Sim sends this token on every request.',
}

/** The account-level CLI command that makes the service principal trust this credential. */
function buildFederationPolicyCommand(issuer: string, audience: string, subject: string) {
  const policy = JSON.stringify({ oidc_policy: { issuer, audiences: [audience], subject } })
  return `databricks account service-principal-federation-policy create <SERVICE_PRINCIPAL_NUMERIC_ID> --json '${policy}'`
}

/** Saved Databricks connections share the standard credential create/reconnect lifecycle. */
export function DatabricksAccountModal(props: DatabricksAccountModalProps) {
  if (!props.open) return null
  return (
    <DatabricksAccountForm
      key={`${resourceScopeKey(resourceScopeFromOwner(props))}:${props.credentialId ?? 'new'}`}
      {...props}
    />
  )
}

function DatabricksAccountForm({
  open,
  onOpenChange,
  workspaceId,
  organizationId,
  serviceIcon: ServiceIcon,
  credentialId,
  initialDisplayName,
  initialDescription,
  onCreated,
}: DatabricksAccountModalProps) {
  const keyless = useKeylessSetup({
    provider: 'databricks',
    workspaceId,
    organizationId,
    credentialId,
  })
  const { submit, error, clearError, isPending } = useSavedConnectionSubmit({
    providerId: DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
    workspaceId,
    organizationId,
    credentialId,
    onCreated,
    onClose: () => onOpenChange(false),
  })
  const [selectedAuthType, setSelectedAuthType] = useState<DatabricksAuthType | null>(null)
  const [host, setHost] = useState('')
  const [token, setToken] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')

  // A reconnect opens on the credential's stored mode, so it never switches auth by default;
  // a new connection defaults to keyless wherever this deployment supports it.
  const defaultAuthType: DatabricksAuthType = credentialId
    ? (keyless.reconnectAuthType ?? 'service_principal')
    : keyless.available
      ? 'oidc_federation'
      : 'service_principal'
  const authType: DatabricksAuthType = selectedAuthType ?? defaultAuthType
  const usesServicePrincipal = authType === 'service_principal' || authType === 'oidc_federation'
  const disabled =
    isPending ||
    !host.trim() ||
    (authType === 'personal_access_token' && !token.trim()) ||
    (usesServicePrincipal && !clientId.trim()) ||
    (authType === 'service_principal' && !clientSecret) ||
    (authType === 'oidc_federation' && !keyless.ready)

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    clearError()
  }

  const buildConfig = (): Record<string, unknown> => {
    const base = { authType, host: host.trim() }
    if (authType === 'oidc_federation') {
      return { ...base, clientId: clientId.trim(), ...keylessConfigFields(keyless) }
    }
    if (authType === 'service_principal') {
      return { ...base, clientId: clientId.trim(), clientSecret }
    }
    return { ...base, token: token.trim() }
  }

  const federationCommand =
    authType === 'oidc_federation' && keyless.trust && keyless.audience
      ? buildFederationPolicyCommand(keyless.trust.issuer, keyless.audience, keyless.trust.subject)
      : null
  const action = credentialId ? 'Reconnect' : 'Add'
  const authOptions = [
    ...(keyless.available
      ? [{ value: 'oidc_federation', label: 'Service principal (keyless, via Sim OIDC)' }]
      : []),
    { value: 'service_principal', label: 'Service principal OAuth secret' },
    { value: 'personal_access_token', label: 'Personal access token' },
  ]

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={`${action} Databricks connection`}>
      <ChipModalHeader icon={withBrandIcon(ServiceIcon)} onClose={() => onOpenChange(false)}>
        {action} Databricks connection
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='dropdown'
          title='Authentication'
          value={authType}
          onChange={(value) => {
            setSelectedAuthType(value as DatabricksAuthType)
            clearError()
          }}
          options={authOptions}
          placeholder='Choose how Sim signs in to Databricks'
          required
          hint={AUTH_TYPE_HINTS[authType]}
        />
        <ChipModalField
          type='input'
          title='Workspace host'
          value={host}
          onChange={edit(setHost)}
          placeholder='dbc-abc123.cloud.databricks.com'
          required
          autoComplete='off'
        />

        {authType === 'personal_access_token' && (
          <ChipModalField type='custom' title='Personal access token' required>
            {(aria) => (
              <SecretInput
                {...aria}
                value={token}
                onChange={edit(setToken)}
                placeholder='dapi...'
                autoComplete='new-password'
                data-lpignore='true'
              />
            )}
          </ChipModalField>
        )}

        {usesServicePrincipal && (
          <ChipModalField
            type='input'
            title='Service principal application ID'
            value={clientId}
            onChange={edit(setClientId)}
            placeholder='7cb2f8a4-49a7-4147-83db-35cb69e5cede'
            required
            autoComplete='off'
          />
        )}

        {authType === 'service_principal' && (
          <ChipModalField type='custom' title='OAuth secret' required>
            {(aria) => (
              <SecretInput
                {...aria}
                value={clientSecret}
                onChange={edit(setClientSecret)}
                placeholder='Enter the service principal OAuth secret'
                autoComplete='new-password'
                data-lpignore='true'
              />
            )}
          </ChipModalField>
        )}

        {authType === 'oidc_federation' && (
          <KeylessTrustFields
            setup={keyless}
            audienceHint='The federation policy must list it as an audience. Your Databricks account ID is a good choice.'
          />
        )}

        {federationCommand && (
          <ChipModalField
            type='custom'
            title='Federation policy'
            hint='An account admin runs this once, with the service principal’s numeric ID, before you save. First sign in to the account with `databricks auth login --host <account console URL> --account-id <account ID>` (not a workspace profile or the workspace web terminal).'
          >
            {(aria) => (
              <ChipTextarea
                {...aria}
                readOnly
                value={federationCommand}
                className='min-h-[120px] font-mono text-xs'
                spellCheck={false}
              />
            )}
          </ChipModalField>
        )}

        <ChipModalField
          type='input'
          title='Display name'
          value={displayName}
          onChange={setDisplayName}
          placeholder='Defaults to the Databricks identity'
        />
        <ChipModalField
          type='textarea'
          title='Description'
          value={description}
          onChange={setDescription}
          placeholder='Optional description'
          maxLength={500}
          minHeight={80}
        />
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        secondaryActions={[
          {
            label: 'Setup guide',
            onClick: () =>
              window.open(
                'https://docs.sim.ai/integrations/databricks-credentials',
                '_blank',
                'noopener,noreferrer'
              ),
          },
        ]}
        primaryAction={{
          label: isPending ? 'Verifying...' : `${action} connection`,
          onClick: () => {
            if (!disabled) void submit({ config: buildConfig(), displayName, description })
          },
          disabled,
        }}
      />
    </ChipModal>
  )
}
