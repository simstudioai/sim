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
  cn,
  SecretInput,
} from '@sim/emcn'
import { isApiClientError } from '@/lib/api/client/errors'
import {
  resourceScopeFields,
  resourceScopeFromOwner,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import {
  getTokenServiceAccountDescriptor,
  getTokenServiceAccountErrorMessage,
  SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/token-service-accounts/descriptors'
import {
  type KeylessSetup,
  KeylessTrustFields,
  keylessConfigFields,
  useKeylessSetup,
  useSavedConnectionSubmit,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/keyless-connection'
import { withBrandIcon } from '@/blocks/brand-icon'
import {
  useCreateScopedCredential,
  useUpdateScopedCredential,
} from '@/hooks/queries/scoped-credentials'

interface SnowflakeAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  organizationId?: string
  serviceName: string
  serviceIcon: ComponentType<{ className?: string }>
  credentialId?: string
  initialDisplayName?: string
  initialDescription?: string
  onCreated?: (credentialId: string) => void
}

type SnowflakeAuthType = 'workload_identity' | 'key_pair' | 'programmatic_access_token'

const SNOWFLAKE_DESCRIPTOR = getTokenServiceAccountDescriptor(SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID)
const SNOWFLAKE_DOCS_URL = 'https://docs.sim.ai/integrations/snowflake-service-account'
const HOST_PATTERN = /^[a-z0-9][a-z0-9_.-]*\.snowflakecomputing\.(com|cn)$/i

const AUTH_TYPE_HINTS: Record<SnowflakeAuthType, string> = {
  workload_identity:
    'No secret is stored. Sim signs a short-lived token your Snowflake service user trusts.',
  key_pair:
    'Sim stores the private key and signs a short-lived token with it for each run. Assign the public key to the user in Snowflake first.',
  programmatic_access_token: 'Sim sends this token on every request.',
}

/** Copy for the shared verification codes a key-pair save reports. */
function keyPairErrorMessage(code: string): string | undefined {
  switch (code) {
    case 'invalid_credentials':
      return 'Snowflake did not accept a token signed with this key. Check the user name, that its RSA_PUBLIC_KEY (or key pair) is this private key’s public key, and that a network policy allows Sim to reach the account.'
    default:
      return keylessErrorMessage(code)
  }
}

/** Copy for the shared verification codes a keyless save reports. */
function keylessErrorMessage(code: string): string | undefined {
  switch (code) {
    case 'invalid_credentials':
      return 'Snowflake did not accept Sim’s token. Check that a service user on this account was created with exactly the issuer and subject shown, that a network policy allows Sim to reach the account, and that no authentication policy blocks workload identity.'
    case 'site_not_found':
      return "We couldn't find a Snowflake account at that host. It should look like myorg-myaccount.snowflakecomputing.com."
    case 'provider_unavailable':
      return "We couldn't reach Snowflake to verify this connection. Try again in a moment."
    default:
      return undefined
  }
}

/**
 * The statement that creates a service user trusting only this credential's
 * subject. Snowflake accepts the default `snowflakecomputing.com` audience with
 * no `OIDC_AUDIENCE_LIST`; a custom audience must be listed there.
 */
function buildCreateUserStatement(issuer: string, subject: string, customAudience?: string) {
  return [
    'CREATE USER SIM_WORKFLOWS',
    '  WORKLOAD_IDENTITY = (',
    '    TYPE = OIDC',
    `    ISSUER = '${issuer}'`,
    `    SUBJECT = '${subject}'`,
    ...(customAudience ? [`    OIDC_AUDIENCE_LIST = ('${customAudience}')`] : []),
    '  )',
    '  TYPE = SERVICE;',
  ].join('\n')
}

function normalizeHostInput(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
}

/**
 * Snowflake connections: a programmatic access token, a key pair, or keyless
 * workload identity where this deployment can sign tokens. Where it cannot (or
 * for an organization credential, which keyless never binds to), keyless is
 * simply not offered.
 */
export function SnowflakeAccountModal(props: SnowflakeAccountModalProps) {
  if (!props.open) return null
  return (
    <SnowflakeAccountGate
      key={`${resourceScopeKey(resourceScopeFromOwner(props))}:${props.credentialId ?? 'new'}`}
      {...props}
    />
  )
}

function SnowflakeAccountGate(props: SnowflakeAccountModalProps) {
  const keyless = useKeylessSetup({
    provider: 'snowflake',
    workspaceId: props.workspaceId,
    organizationId: props.organizationId,
    credentialId: props.credentialId,
  })
  return <SnowflakeAccountForm {...props} keyless={keyless} />
}

function SnowflakeAccountForm({
  open,
  onOpenChange,
  workspaceId,
  organizationId,
  serviceIcon: ServiceIcon,
  credentialId,
  initialDisplayName,
  initialDescription,
  onCreated,
  keyless,
}: SnowflakeAccountModalProps & { keyless: KeylessSetup<'snowflake'> }) {
  const close = () => onOpenChange(false)
  const createCredential = useCreateScopedCredential()
  const updateCredential = useUpdateScopedCredential()
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [selectedAuthType, setSelectedAuthType] = useState<SnowflakeAuthType | null>(null)
  const [host, setHost] = useState('')
  const [token, setToken] = useState('')
  const [user, setUser] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')

  // A reconnect opens on the credential's stored mode, so it never switches auth by default. An
  // organization credential's mode is not reported, so its reconnect starts with no mode chosen
  // rather than a guess. A new connection defaults to keyless wherever this deployment supports it.
  const defaultAuthType: SnowflakeAuthType | null = credentialId
    ? (keyless.reconnectAuthType ?? null)
    : keyless.available
      ? 'workload_identity'
      : 'programmatic_access_token'
  const authType = selectedAuthType ?? defaultAuthType
  const connectionSubmit = useSavedConnectionSubmit({
    providerId: SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
    workspaceId,
    organizationId,
    credentialId,
    onCreated,
    onClose: close,
    messageForCode: authType === 'key_pair' ? keyPairErrorMessage : keylessErrorMessage,
  })
  const normalizedHost = normalizeHostInput(host)
  const isPending =
    connectionSubmit.isPending || createCredential.isPending || updateCredential.isPending
  const disabled =
    isPending ||
    !authType ||
    !normalizedHost ||
    (authType === 'programmatic_access_token' && !token.trim()) ||
    (authType === 'key_pair' && (!user.trim() || !privateKey.trim())) ||
    (authType === 'workload_identity' && !keyless.ready)
  const error = authType === 'programmatic_access_token' ? tokenError : connectionSubmit.error

  const clearErrors = () => {
    connectionSubmit.clearError()
    setTokenError(null)
  }
  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    clearErrors()
  }

  const submitToken = async () => {
    const fields = {
      ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
      apiToken: token.trim(),
      domain: normalizedHost,
      displayName: displayName.trim() || undefined,
      description: description.trim() || undefined,
    }
    try {
      if (credentialId) {
        await updateCredential.mutateAsync({ ...fields, credentialId })
        onCreated?.(credentialId)
      } else {
        const created = await createCredential.mutateAsync({
          ...fields,
          type: 'service_account',
          providerId: SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
        })
        onCreated?.(created.credential.id)
      }
      close()
    } catch (submitError) {
      const code = isApiClientError(submitError) ? submitError.code : undefined
      setTokenError(
        SNOWFLAKE_DESCRIPTOR
          ? getTokenServiceAccountErrorMessage(SNOWFLAKE_DESCRIPTOR, code)
          : 'Could not verify the credential. Check the details and try again.'
      )
    }
  }

  const handleSubmit = () => {
    if (disabled) return
    clearErrors()
    if (authType === 'programmatic_access_token') {
      void submitToken()
      return
    }
    if (authType === 'key_pair') {
      void connectionSubmit.submit({
        config: {
          authType: 'key_pair',
          host: normalizedHost,
          user: user.trim(),
          privateKey: privateKey.trim(),
        },
        displayName,
        description,
      })
      return
    }
    void connectionSubmit.submit({
      config: {
        authType: 'workload_identity',
        host: normalizedHost,
        ...keylessConfigFields(keyless),
      },
      displayName,
      description,
    })
  }

  const createUserStatement =
    authType === 'workload_identity' && keyless.trust && !keyless.audienceError
      ? buildCreateUserStatement(
          keyless.trust.issuer,
          keyless.trust.subject,
          keyless.customAudience
        )
      : null
  const action = credentialId ? 'Reconnect' : 'Add'
  const authOptions = [
    ...(keyless.available
      ? [{ value: 'workload_identity', label: 'Service user (keyless, via Sim OIDC)' }]
      : []),
    { value: 'key_pair', label: 'Key pair (RSA private key)' },
    { value: 'programmatic_access_token', label: 'Programmatic access token' },
  ]

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={`${action} Snowflake connection`}>
      <ChipModalHeader icon={withBrandIcon(ServiceIcon)} onClose={close}>
        {action} Snowflake connection
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='dropdown'
          title='Authentication'
          value={authType ?? undefined}
          onChange={(value) => {
            setSelectedAuthType(value as SnowflakeAuthType)
            clearErrors()
          }}
          options={authOptions}
          placeholder='Choose how Sim signs in to Snowflake'
          required
          hint={authType ? AUTH_TYPE_HINTS[authType] : undefined}
        />
        <ChipModalField
          type='input'
          title='Account host'
          value={host}
          onChange={edit(setHost)}
          placeholder='myorg-myaccount.snowflakecomputing.com'
          required
          autoComplete='off'
          error={
            normalizedHost && !HOST_PATTERN.test(normalizedHost)
              ? 'Snowflake account hosts end in .snowflakecomputing.com, or .snowflakecomputing.cn in China.'
              : undefined
          }
        />

        {authType === 'programmatic_access_token' && (
          <ChipModalField type='custom' title='Programmatic access token' required>
            {(aria) => (
              <SecretInput
                {...aria}
                value={token}
                onChange={edit(setToken)}
                placeholder='Paste a programmatic access token'
                autoComplete='new-password'
                data-lpignore='true'
              />
            )}
          </ChipModalField>
        )}

        {authType === 'key_pair' && (
          <>
            <ChipModalField
              type='input'
              title='User'
              value={user}
              onChange={edit(setUser)}
              placeholder='SIM_WORKFLOWS'
              required
              autoComplete='off'
            />
            <ChipModalField
              type='custom'
              title='Private key'
              required
              hint='An unencrypted PKCS#8 PEM RSA key of 2048 to 4096 bits, such as one created with openssl pkcs8 -topk8 -nocrypt.'
            >
              {(aria) => (
                <ChipTextarea
                  {...aria}
                  value={privateKey}
                  onChange={(event) => edit(setPrivateKey)(event.target.value)}
                  placeholder='-----BEGIN PRIVATE KEY-----'
                  className={cn(
                    'min-h-[120px] font-mono',
                    privateKey && '[&:not(:focus)]:[-webkit-text-security:disc]'
                  )}
                  spellCheck={false}
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  data-lpignore='true'
                  data-form-type='other'
                />
              )}
            </ChipModalField>
          </>
        )}

        {authType === 'workload_identity' && (
          <KeylessTrustFields
            setup={keyless}
            audienceHint='The statement below lists it in OIDC_AUDIENCE_LIST.'
          />
        )}

        {createUserStatement && (
          <ChipModalField
            type='custom'
            title='Service user'
            hint='An admin runs this once in the account, then grants the user a role and sets it as its default role, before you save. If SIM_WORKFLOWS already exists, change the name in the statement you run and in any follow-up GRANT or ALTER commands.'
          >
            {(aria) => (
              <ChipTextarea
                {...aria}
                readOnly
                value={createUserStatement}
                className='min-h-[140px] font-mono text-xs'
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
          placeholder='Defaults to the Snowflake user and account'
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
        onCancel={close}
        secondaryActions={[
          {
            label: 'Setup guide',
            onClick: () => window.open(SNOWFLAKE_DOCS_URL, '_blank', 'noopener,noreferrer'),
          },
        ]}
        primaryAction={{
          label: isPending ? 'Verifying...' : `${action} connection`,
          onClick: handleSubmit,
          disabled,
        }}
      />
    </ChipModal>
  )
}
