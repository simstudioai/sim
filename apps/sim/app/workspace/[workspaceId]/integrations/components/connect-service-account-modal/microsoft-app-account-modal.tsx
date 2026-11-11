'use client'

import { type ComponentType, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  SecretInput,
} from '@sim/emcn'
import { resourceScopeFromOwner, resourceScopeKey } from '@/lib/core/resource-scope'
import { MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  KeylessTrustFields,
  keylessSubjectFields,
  useKeylessSetup,
  useSavedConnectionSubmit,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/keyless-connection'
import { withBrandIcon } from '@/blocks/brand-icon'

interface MicrosoftAppAccountModalProps {
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

type MicrosoftAuthType = 'federated' | 'client_secret' | 'certificate'

const AUTH_TYPE_HINTS: Record<MicrosoftAuthType, string> = {
  federated:
    'No secret is stored. Sim signs a short-lived token a federated credential on your app trusts.',
  client_secret: 'Sim exchanges the client secret for a short-lived token on each run.',
  certificate: 'Sim signs each token request with the certificate’s private key.',
}

const DOCS_URL = 'https://docs.sim.ai/integrations/microsoft-app-credentials'

/** Saved Microsoft app credentials share the standard credential create/reconnect lifecycle. */
export function MicrosoftAppAccountModal(props: MicrosoftAppAccountModalProps) {
  if (!props.open) return null
  return (
    <MicrosoftAppAccountForm
      key={`${resourceScopeKey(resourceScopeFromOwner(props))}:${props.credentialId ?? 'new'}`}
      {...props}
    />
  )
}

function MicrosoftAppAccountForm({
  open,
  onOpenChange,
  workspaceId,
  organizationId,
  serviceIcon: ServiceIcon,
  credentialId,
  initialDisplayName,
  initialDescription,
  onCreated,
}: MicrosoftAppAccountModalProps) {
  const keyless = useKeylessSetup({
    provider: 'microsoft',
    workspaceId,
    organizationId,
    credentialId,
  })
  const { submit, error, clearError, isPending } = useSavedConnectionSubmit({
    providerId: MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID,
    workspaceId,
    organizationId,
    credentialId,
    onCreated,
    onClose: () => onOpenChange(false),
  })
  const [selectedAuthType, setSelectedAuthType] = useState<MicrosoftAuthType | null>(null)
  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [environmentUrl, setEnvironmentUrl] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [certificate, setCertificate] = useState('')
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')

  // A reconnect opens on the credential's stored mode, so it never switches auth by default;
  // a new connection defaults to keyless wherever this deployment supports it.
  const defaultAuthType: MicrosoftAuthType = credentialId
    ? (keyless.reconnectAuthType ?? 'client_secret')
    : keyless.available
      ? 'federated'
      : 'client_secret'
  const authType: MicrosoftAuthType = selectedAuthType ?? defaultAuthType
  const disabled =
    isPending ||
    !tenantId.trim() ||
    !clientId.trim() ||
    (authType === 'client_secret' && !clientSecret.trim()) ||
    (authType === 'certificate' && (!privateKey.trim() || !certificate.trim())) ||
    (authType === 'federated' && !keyless.ready)

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    clearError()
  }

  const buildConfig = (): Record<string, unknown> => {
    const base = {
      authType,
      tenantId: tenantId.trim(),
      clientId: clientId.trim(),
      ...(environmentUrl.trim() ? { environmentUrl: environmentUrl.trim() } : {}),
    }
    if (authType === 'federated') return { ...base, ...keylessSubjectFields(keyless) }
    if (authType === 'certificate') return { ...base, privateKey, certificate }
    return { ...base, clientSecret }
  }

  const action = credentialId ? 'Reconnect' : 'Add'
  const authOptions = [
    ...(keyless.available
      ? [{ value: 'federated', label: 'Federated credential (keyless, via Sim OIDC)' }]
      : []),
    { value: 'client_secret', label: 'Client secret' },
    { value: 'certificate', label: 'Certificate' },
  ]

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={`${action} Microsoft app credential`}
    >
      <ChipModalHeader icon={withBrandIcon(ServiceIcon)} onClose={() => onOpenChange(false)}>
        {action} Microsoft app credential
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='dropdown'
          title='Authentication'
          value={authType}
          onChange={(value) => {
            setSelectedAuthType(value as MicrosoftAuthType)
            clearError()
          }}
          options={authOptions}
          placeholder='Choose how the app signs in'
          required
          hint={AUTH_TYPE_HINTS[authType]}
        />
        <ChipModalField
          type='input'
          title='Directory (tenant) ID'
          value={tenantId}
          onChange={edit(setTenantId)}
          placeholder='00000000-0000-0000-0000-000000000000'
          required
          autoComplete='off'
        />
        <ChipModalField
          type='input'
          title='Application (client) ID'
          value={clientId}
          onChange={edit(setClientId)}
          placeholder='00000000-0000-0000-0000-000000000000'
          required
          autoComplete='off'
        />
        <ChipModalField
          type='input'
          title='Dataverse environment URL'
          value={environmentUrl}
          onChange={edit(setEnvironmentUrl)}
          placeholder='https://contoso.crm.dynamics.com'
          autoComplete='off'
          hint='Needed for Dataverse and Dynamics 365. The app must be an application user there.'
        />

        {authType === 'client_secret' && (
          <ChipModalField type='custom' title='Client secret' required>
            {(aria) => (
              <SecretInput
                {...aria}
                value={clientSecret}
                onChange={edit(setClientSecret)}
                placeholder='The secret’s Value from Certificates & secrets'
                autoComplete='new-password'
                data-lpignore='true'
              />
            )}
          </ChipModalField>
        )}

        {authType === 'certificate' && (
          <>
            <ChipModalField
              type='textarea'
              title='Certificate'
              value={certificate}
              onChange={edit(setCertificate)}
              placeholder='-----BEGIN CERTIFICATE-----'
              required
              minHeight={100}
              hint='The certificate uploaded to the app registration.'
            />
            <ChipModalField
              type='textarea'
              title='Private key'
              value={privateKey}
              onChange={edit(setPrivateKey)}
              placeholder='-----BEGIN PRIVATE KEY-----'
              required
              minHeight={100}
              hint='Unencrypted PEM RSA key for that certificate. Stored encrypted.'
            />
          </>
        )}

        {authType === 'federated' && (
          <KeylessTrustFields
            setup={keyless}
            pasteHint='In the app registration, open Certificates & secrets → Federated credentials → Add credential → Other issuer, and paste these values.'
          />
        )}

        <ChipModalField
          type='input'
          title='Display name'
          value={displayName}
          onChange={setDisplayName}
          placeholder='Defaults to the app’s name'
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
            onClick: () => window.open(DOCS_URL, '_blank', 'noopener,noreferrer'),
          },
        ]}
        primaryAction={{
          label: isPending ? 'Verifying...' : `${action} credential`,
          onClick: () => {
            if (!disabled) void submit({ config: buildConfig(), displayName, description })
          },
          disabled,
        }}
      />
    </ChipModal>
  )
}
