'use client'

import { type ComponentType, useState } from 'react'
import {
  ChipCopyInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipTextarea,
  SecretInput,
} from '@sim/emcn'
import { generateShortId } from '@sim/utils/id'
import { isApiClientError } from '@/lib/api/client/errors'
import {
  resourceScopeFields,
  resourceScopeFromOwner,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import { DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { withBrandIcon } from '@/blocks/brand-icon'
import {
  useCreateScopedCredential,
  useUpdateScopedCredential,
  useWorkloadIdentitySetup,
} from '@/hooks/queries/scoped-credentials'

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
  // Keyless principals bind their subject to a workspace; organization connections use secrets.
  const supportsOidc = Boolean(workspaceId) && !organizationId
  const [authType, setAuthType] = useState<DatabricksAuthType>(
    supportsOidc ? 'oidc_federation' : 'service_principal'
  )
  const [host, setHost] = useState('')
  const [token, setToken] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)
  const [sessionKey] = useState(() => generateShortId())

  const setup = useWorkloadIdentitySetup({
    workspaceId,
    provider: 'databricks',
    sessionKey,
    enabled: authType === 'oidc_federation',
  })
  const trust = setup.data
  const createCredential = useCreateScopedCredential()
  const updateCredential = useUpdateScopedCredential()
  const isPending = createCredential.isPending || updateCredential.isPending
  const action = credentialId ? 'Reconnect' : 'Add'

  const disabled =
    isPending ||
    !host.trim() ||
    (authType === 'personal_access_token' && !token.trim()) ||
    (authType === 'service_principal' && (!clientId.trim() || !clientSecret)) ||
    (authType === 'oidc_federation' && (!clientId.trim() || !trust))

  const clearError = () => setError(null)

  const buildConfig = () => {
    const base = { host: host.trim() }
    if (authType === 'oidc_federation' && trust) {
      return {
        authType,
        ...base,
        clientId: clientId.trim(),
        subject: trust.subject,
        subjectProof: trust.subjectProof,
      }
    }
    if (authType === 'service_principal') {
      return { authType, ...base, clientId: clientId.trim(), clientSecret }
    }
    return { authType: 'personal_access_token' as const, ...base, token: token.trim() }
  }

  const submit = async () => {
    if (disabled) return
    setError(null)
    const input = {
      ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
      serviceAccountJson: JSON.stringify(buildConfig()),
      displayName: displayName.trim() || undefined,
      description: description.trim() || undefined,
    }
    try {
      let connectedId = credentialId
      if (credentialId)
        await updateCredential.mutateAsync({
          ...input,
          credentialId,
          description: description.trim() || null,
        })
      else {
        const created = await createCredential.mutateAsync({
          ...input,
          type: 'service_account',
          providerId: DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
        })
        connectedId = created.credential.id
      }
      if (connectedId) onCreated?.(connectedId)
      onOpenChange(false)
    } catch (error) {
      if (isApiClientError(error) && error.code === 'duplicate_display_name') {
        setError('A credential with that name already exists. Choose a different display name.')
        return
      }
      setError(
        isApiClientError(error) && error.message
          ? error.message
          : 'Could not verify the Databricks connection. Check the details and try again.'
      )
    }
  }

  const authOptions = [
    ...(supportsOidc
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
            setAuthType(value as DatabricksAuthType)
            clearError()
          }}
          options={authOptions}
          placeholder='Choose how Sim signs in to Databricks'
          required
          hint={
            authType === 'oidc_federation'
              ? 'No secret is stored. Sim signs a short-lived token your service principal trusts.'
              : authType === 'service_principal'
                ? 'Sim exchanges the OAuth secret for a short-lived workspace token on each run.'
                : 'Sim sends this token on every request.'
          }
        />
        <ChipModalField
          type='input'
          title='Workspace host'
          value={host}
          onChange={(value) => {
            setHost(value)
            clearError()
          }}
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
                onChange={(value) => {
                  setToken(value)
                  clearError()
                }}
                placeholder='dapi...'
                autoComplete='new-password'
                data-lpignore='true'
              />
            )}
          </ChipModalField>
        )}

        {(authType === 'service_principal' || authType === 'oidc_federation') && (
          <ChipModalField
            type='input'
            title='Service principal application ID'
            value={clientId}
            onChange={(value) => {
              setClientId(value)
              clearError()
            }}
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
                onChange={(value) => {
                  setClientSecret(value)
                  clearError()
                }}
                placeholder='Enter the service principal OAuth secret'
                autoComplete='new-password'
                data-lpignore='true'
              />
            )}
          </ChipModalField>
        )}

        {authType === 'oidc_federation' && (
          <>
            {setup.isError && (
              <ChipModalError>
                {isApiClientError(setup.error) && setup.error.message
                  ? setup.error.message
                  : 'Could not start a keyless connection. Use a service principal secret instead.'}
              </ChipModalError>
            )}
            {trust && (
              <>
                <ChipModalField type='custom' title='Issuer'>
                  {(aria) => (
                    <ChipCopyInput {...aria} value={trust.issuer} copyLabel='Copy issuer' />
                  )}
                </ChipModalField>
                <ChipModalField type='custom' title='Audience'>
                  {(aria) => (
                    <ChipCopyInput {...aria} value={trust.audience} copyLabel='Copy audience' />
                  )}
                </ChipModalField>
                <ChipModalField
                  type='custom'
                  title='Subject'
                  hint='Unique to this connection. Your service principal trusts only this subject.'
                >
                  {(aria) => (
                    <ChipCopyInput {...aria} value={trust.subject} copyLabel='Copy subject' />
                  )}
                </ChipModalField>
                <ChipModalField
                  type='custom'
                  title='Federation policy'
                  hint='An account admin runs this once, with the service principal’s numeric ID, before you save.'
                >
                  {(aria) => (
                    <ChipTextarea
                      {...aria}
                      readOnly
                      value={buildFederationPolicyCommand(
                        trust.issuer,
                        trust.audience,
                        trust.subject
                      )}
                      className='min-h-[120px] font-mono text-xs'
                      spellCheck={false}
                    />
                  )}
                </ChipModalField>
              </>
            )}
          </>
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
          onClick: submit,
          disabled,
        }}
      />
    </ChipModal>
  )
}
