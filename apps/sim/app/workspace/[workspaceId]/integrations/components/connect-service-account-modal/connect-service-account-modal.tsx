'use client'

import { type ComponentType, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalDescription,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipTextarea,
  cn,
  SecretInput,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isApiClientError } from '@/lib/api/client/errors'
import { type AtlassianProduct, serviceAccountJsonSchema } from '@/lib/api/contracts/credentials'
import {
  resourceScopeFields,
  resourceScopeFromOwner,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import {
  type ClientCredentialAccountProviderId,
  getClientCredentialAccountDescriptor,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  GOOGLE_KEYLESS_SERVICES,
  googleKeylessOffer,
} from '@/lib/credentials/google-workload-identity'
import type { ServiceAccountSecretFields } from '@/lib/credentials/service-account-secret'
import {
  CLIENT_CREDENTIALS_AUTH_METHOD,
  getTokenServiceAccountDescriptor,
  SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID,
  type TokenServiceAccountProviderId,
} from '@/lib/credentials/token-service-accounts/descriptors'
import { getServiceAccountCoverageSentence } from '@/lib/integrations/credential-display'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  AWS_SERVICE_ACCOUNT_PROVIDER_ID,
  DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID,
  OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
  ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
} from '@/lib/oauth/types'
import { AwsAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/aws-account-modal'
import { ClientCredentialAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/client-credential-account-modal'
import { ClientCredentialsFields } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/client-credentials-fields'
import { DatabricksAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/databricks-account-modal'
import {
  buildGoogleKeylessConfig,
  EMPTY_GOOGLE_KEYLESS_INPUT,
  GoogleKeylessFields,
  type GoogleKeylessInput,
  isGoogleKeylessInputComplete,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/google-keyless-fields'
import {
  useKeylessSetup,
  useSavedConnectionSubmit,
} from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/keyless-connection'
import { MicrosoftAppAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/microsoft-app-account-modal'
import { OracleDatabaseAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/oracle-database-account-modal'
import { SnowflakeAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/snowflake-account-modal'
import { TokenServiceAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/token-service-account-modal'
import { ConnectSlackBotModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-slack-bot-modal/connect-slack-bot-modal'
import { withBrandIcon } from '@/blocks/brand-icon'
import {
  useCreateScopedCredential,
  useUpdateScopedCredential,
} from '@/hooks/queries/scoped-credentials'

const logger = createLogger('ConnectServiceAccountModal')

export type ServiceAccountProviderId =
  | typeof GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SLACK_CUSTOM_BOT_PROVIDER_ID
  | typeof OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof AWS_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID
  | TokenServiceAccountProviderId
  | ClientCredentialAccountProviderId

/** Sim setup guides for each provider, docked bottom-left of each modal. */
const GOOGLE_SERVICE_ACCOUNT_DOCS_URL = 'https://docs.sim.ai/integrations/google-service-account'
const ATLASSIAN_SERVICE_ACCOUNT_DOCS_URL =
  'https://docs.sim.ai/integrations/atlassian-service-account'
const OCI_API_KEY_DOCS_URL =
  'https://docs.oracle.com/en-us/iaas/Content/API/Concepts/apisigningkey.htm'

function openDocs(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * Atlassian site domain hint — surfaced inline when the user types something
 * that doesn't look like `<tenant>.atlassian.net`.
 */
const ATLASSIAN_DOMAIN_HINT_REGEX = /^[a-z0-9-]+\.atlassian\.net$/i

/**
 * States the token's reach up front — the ambiguity this modal exists to remove.
 * Sits on the API token field, not Site domain: it describes the token, and
 * `ChipModalField` hides a `hint` whenever that field shows an `error`, which
 * would drop it exactly while the user is correcting a domain typo. Derived
 * from the catalog so it cannot drift as Atlassian integrations are added.
 */
const ATLASSIAN_COVERAGE_HINT = getServiceAccountCoverageSentence(
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID
)

/**
 * Maps server `error.code` values returned by the Atlassian service-account
 * route to user-facing messages. Falls back to {@link FALLBACK_ERROR_MESSAGE}
 * when the error is unrecognized.
 */
const ATLASSIAN_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials:
    "We couldn't authenticate with that API token. Double-check the token and that the service account has access to this site.",
  site_not_found:
    "We couldn't find an Atlassian site at that domain. Check the spelling — it should look like your-team.atlassian.net.",
  duplicate_display_name: 'A credential with that name already exists in this workspace.',
  atlassian_unavailable:
    "We couldn't reach Atlassian to verify these credentials. Try again in a moment.",
  provider_unavailable:
    "We couldn't reach Atlassian to verify these credentials. Try again in a moment.",
}

/** Copy that differs when the service account signs in with an OAuth 2.0 credential. */
const ATLASSIAN_CLIENT_CREDENTIAL_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials:
    "We couldn't authenticate with that client ID and secret. Check that they belong to an OAuth 2.0 credential of a service account with access to this site and product.",
}

type AtlassianAuthMethod = 'api_token' | typeof CLIENT_CREDENTIALS_AUTH_METHOD

const FALLBACK_ERROR_MESSAGE = "We couldn't add this service account. Try again in a moment."

function normalizeAtlassianDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
}

function messageForAtlassianError(err: unknown, authMethod: AtlassianAuthMethod | null): string {
  if (!isApiClientError(err) || !err.code) return FALLBACK_ERROR_MESSAGE
  const clientMessage =
    authMethod === CLIENT_CREDENTIALS_AUTH_METHOD
      ? ATLASSIAN_CLIENT_CREDENTIAL_ERROR_MESSAGES[err.code]
      : undefined
  return clientMessage ?? ATLASSIAN_ERROR_MESSAGES[err.code] ?? FALLBACK_ERROR_MESSAGE
}

interface ConnectServiceAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  organizationId?: string
  serviceAccountProviderId: ServiceAccountProviderId
  atlassianProduct?: AtlassianProduct
  atlassianSetupGuideUrl?: string
  serviceName: string
  serviceIcon: ComponentType<{ className?: string }>
  /**
   * When set, the modal reconnects (rotates secrets on) this existing credential
   * in place instead of creating a new one. The id is preserved, so shares and
   * (for Slack) the ingest URL stay valid.
   */
  credentialId?: string
  /** Existing display name, used to seed reconnect-capable modals. */
  credentialDisplayName?: string
  /** Existing description, used to seed reconnect-capable modals. */
  credentialDescription?: string
  /**
   * The OAuth service the dialog was opened for (`google-bigquery`). A Google service account
   * offers keyless setup only for a Google Cloud service.
   */
  oauthServiceId?: string
  /** Called with the new credential id after a successful create (token-paste providers). */
  onCreated?: (credentialId: string) => void
  onSubmitCredentials?: (
    fields: ServiceAccountSecretFields & { displayName?: string; description?: string }
  ) => Promise<string>
  submitPending?: boolean
}

/**
 * Connect-service-account modal mounted from the per-integration detail page.
 * Self-contained: takes the resolved SA provider + service metadata from the
 * caller and submits via `useCreateScopedCredential`. Branches the body
 * based on `serviceAccountProviderId`:
 *
 * - `google-service-account`: JSON-paste + drag/drop. Validated client-side
 *   against {@link serviceAccountJsonSchema} before submitting.
 * - `atlassian-service-account`: API token + site domain. Validated by the
 *   server against the Atlassian API; user-facing errors are mapped from the
 *   route's `error.code`.
 * - `oci-api-key-service-account`: API signing-key fields. Validated locally
 *   and with a bounded OCI request before encrypted storage.
 */
export function ConnectServiceAccountModal({
  open,
  onOpenChange,
  workspaceId,
  organizationId,
  serviceAccountProviderId,
  atlassianProduct,
  atlassianSetupGuideUrl,
  serviceName,
  serviceIcon,
  credentialId,
  credentialDisplayName,
  credentialDescription,
  oauthServiceId,
  onCreated,
  onSubmitCredentials,
  submitPending,
}: ConnectServiceAccountModalProps) {
  if (serviceAccountProviderId === DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID) {
    return (
      <DatabricksAccountModal
        open={open}
        onOpenChange={onOpenChange}
        workspaceId={workspaceId}
        organizationId={organizationId}
        serviceIcon={serviceIcon}
        credentialId={credentialId}
        initialDisplayName={credentialDisplayName}
        initialDescription={credentialDescription}
        onCreated={onCreated}
      />
    )
  }
  if (serviceAccountProviderId === MICROSOFT_APP_SERVICE_ACCOUNT_PROVIDER_ID) {
    return (
      <MicrosoftAppAccountModal
        open={open}
        onOpenChange={onOpenChange}
        workspaceId={workspaceId}
        organizationId={organizationId}
        serviceIcon={serviceIcon}
        credentialId={credentialId}
        initialDisplayName={credentialDisplayName}
        initialDescription={credentialDescription}
        onCreated={onCreated}
      />
    )
  }
  if (serviceAccountProviderId === AWS_SERVICE_ACCOUNT_PROVIDER_ID) {
    return (
      <AwsAccountModal
        open={open}
        onOpenChange={onOpenChange}
        workspaceId={workspaceId}
        organizationId={organizationId}
        serviceIcon={serviceIcon}
        credentialId={credentialId}
        initialDisplayName={credentialDisplayName}
        initialDescription={credentialDescription}
        onCreated={onCreated}
      />
    )
  }
  if (serviceAccountProviderId === ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID) {
    return (
      <OracleDatabaseAccountModal
        open={open}
        onOpenChange={onOpenChange}
        workspaceId={workspaceId}
        organizationId={organizationId}
        serviceIcon={serviceIcon}
        credentialId={credentialId}
        initialDisplayName={credentialDisplayName}
        initialDescription={credentialDescription}
        onCreated={onCreated}
      />
    )
  }
  const clientCredentialDescriptor = getClientCredentialAccountDescriptor(serviceAccountProviderId)
  if (clientCredentialDescriptor) {
    return (
      <ClientCredentialAccountModal
        onSubmitCredentials={onSubmitCredentials}
        submitPending={submitPending}
        open={open}
        onOpenChange={onOpenChange}
        workspaceId={workspaceId}
        organizationId={organizationId}
        descriptor={clientCredentialDescriptor}
        serviceName={serviceName}
        serviceIcon={serviceIcon}
        credentialId={credentialId}
        initialDisplayName={credentialDisplayName}
        initialDescription={credentialDescription}
        onCreated={onCreated}
      />
    )
  }
  // A caller that saves the fields itself (a connect draft) takes the token only.
  if (serviceAccountProviderId === SNOWFLAKE_SERVICE_ACCOUNT_PROVIDER_ID && !onSubmitCredentials) {
    return (
      <SnowflakeAccountModal
        open={open}
        onOpenChange={onOpenChange}
        workspaceId={workspaceId}
        organizationId={organizationId}
        serviceName={serviceName}
        serviceIcon={serviceIcon}
        credentialId={credentialId}
        initialDisplayName={credentialDisplayName}
        initialDescription={credentialDescription}
        onCreated={onCreated}
      />
    )
  }
  const tokenDescriptor = getTokenServiceAccountDescriptor(serviceAccountProviderId)
  if (tokenDescriptor) {
    return (
      <TokenServiceAccountModal
        onSubmitCredentials={onSubmitCredentials}
        submitPending={submitPending}
        open={open}
        onOpenChange={onOpenChange}
        workspaceId={workspaceId}
        organizationId={organizationId}
        descriptor={tokenDescriptor}
        serviceName={serviceName}
        serviceIcon={serviceIcon}
        credentialId={credentialId}
        initialDisplayName={credentialDisplayName}
        initialDescription={credentialDescription}
        onCreated={onCreated}
      />
    )
  }
  if (serviceAccountProviderId === SLACK_CUSTOM_BOT_PROVIDER_ID) {
    return (
      <ConnectSlackBotModal
        open={open}
        onOpenChange={onOpenChange}
        workspaceId={workspaceId}
        organizationId={organizationId}
        credentialId={credentialId}
        initialDisplayName={credentialDisplayName}
        initialDescription={credentialDescription}
        onCreated={onCreated}
      />
    )
  }
  if (serviceAccountProviderId === ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID) {
    return (
      <AtlassianServiceAccountModal
        atlassianProduct={atlassianProduct}
        setupGuideUrl={atlassianSetupGuideUrl}
        open={open}
        onOpenChange={onOpenChange}
        workspaceId={workspaceId}
        organizationId={organizationId}
        serviceName={serviceName}
        serviceIcon={serviceIcon}
        credentialId={credentialId}
        initialDisplayName={credentialDisplayName}
        initialDescription={credentialDescription}
        onCreated={onCreated}
      />
    )
  }
  if (serviceAccountProviderId === OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID) {
    return (
      <OciApiKeyServiceAccountModal
        key={`${resourceScopeKey(resourceScopeFromOwner({ workspaceId, organizationId }))}:${credentialId ?? 'new'}:${open ? 'open' : 'closed'}`}
        open={open}
        onOpenChange={onOpenChange}
        workspaceId={workspaceId}
        organizationId={organizationId}
        serviceName={serviceName}
        serviceIcon={serviceIcon}
        credentialId={credentialId}
        initialDisplayName={credentialDisplayName}
        initialDescription={credentialDescription}
        onCreated={onCreated}
      />
    )
  }
  return (
    <GoogleServiceAccountModal
      open={open}
      onOpenChange={onOpenChange}
      workspaceId={workspaceId}
      organizationId={organizationId}
      serviceName={serviceName}
      serviceIcon={serviceIcon}
      credentialId={credentialId}
      initialDisplayName={credentialDisplayName}
      initialDescription={credentialDescription}
      oauthServiceId={oauthServiceId}
      onCreated={onCreated}
    />
  )
}

interface ProviderModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  organizationId?: string
  serviceName: string
  serviceIcon: ComponentType<{ className?: string }>
  /** When set, reconnect (rotate secrets on) this credential in place. */
  credentialId?: string
  /** Existing name/description, seeded into the fields on reconnect. */
  initialDisplayName?: string
  initialDescription?: string
  /** Called with the credential id after a successful create or reconnect. */
  onCreated?: (credentialId: string) => void
}

function OciApiKeyServiceAccountModal({
  open,
  onOpenChange,
  workspaceId,
  organizationId,
  serviceName,
  serviceIcon: ServiceIcon,
  credentialId,
  initialDisplayName,
  initialDescription,
  onCreated,
}: ProviderModalProps) {
  const [tenancyOcid, setTenancyOcid] = useState('')
  const [userOcid, setUserOcid] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState('')
  const [region, setRegion] = useState('')
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)
  const createCredential = useCreateScopedCredential()
  const updateCredential = useUpdateScopedCredential()

  const isPending = createCredential.isPending || updateCredential.isPending
  const isDisabled =
    !tenancyOcid.trim() ||
    !userOcid.trim() ||
    !fingerprint.trim() ||
    !privateKey.trim() ||
    !region.trim() ||
    isPending

  const clearError = () => {
    if (error) setError(null)
  }

  const handleSubmit = async () => {
    setError(null)
    if (isDisabled) return
    const fields = {
      tenancyOcid: tenancyOcid.trim(),
      userOcid: userOcid.trim(),
      fingerprint: fingerprint.trim(),
      privateKey,
      ...(privateKeyPassphrase.length > 0 ? { privateKeyPassphrase } : {}),
      region: region.trim(),
      displayName: displayName.trim() || undefined,
      description: description.trim() || undefined,
    }
    try {
      let connectedCredentialId = credentialId
      if (credentialId) {
        await updateCredential.mutateAsync({
          ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
          credentialId,
          ...fields,
        })
      } else {
        const created = await createCredential.mutateAsync({
          ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
          type: 'service_account',
          providerId: OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
          ...fields,
        })
        connectedCredentialId = created.credential.id
      }
      if (connectedCredentialId) onCreated?.(connectedCredentialId)
      onOpenChange(false)
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to add OCI API-key credential'))
      logger.error('Failed to add OCI API-key credential', err)
    }
  }

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={`${credentialId ? 'Reconnect' : 'Add'} ${serviceName} API key`}
      dismissDisabled={isPending}
    >
      <ChipModalHeader icon={withBrandIcon(ServiceIcon)} onClose={() => onOpenChange(false)}>
        {credentialId ? 'Reconnect' : 'Add'} {serviceName} API key
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Tenancy OCID'
          value={tenancyOcid}
          onChange={(value) => {
            setTenancyOcid(value)
            clearError()
          }}
          placeholder='ocid1.tenancy.oc1..'
          autoComplete='off'
          mono
          required
        />
        <ChipModalField
          type='input'
          title='User OCID'
          value={userOcid}
          onChange={(value) => {
            setUserOcid(value)
            clearError()
          }}
          placeholder='ocid1.user.oc1..'
          autoComplete='off'
          mono
          required
        />
        <ChipModalField
          type='input'
          title='Fingerprint'
          value={fingerprint}
          onChange={(value) => {
            setFingerprint(value)
            clearError()
          }}
          placeholder='00:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff'
          autoComplete='off'
          mono
          required
        />
        <ChipModalField type='custom' title='Private key' required>
          {(aria) => (
            <ChipTextarea
              {...aria}
              value={privateKey}
              onChange={(event) => {
                setPrivateKey(event.target.value)
                clearError()
              }}
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
        <ChipModalField
          type='input'
          inputType='password'
          title='Private-key passphrase'
          value={privateKeyPassphrase}
          onChange={(value) => {
            setPrivateKeyPassphrase(value)
            clearError()
          }}
          placeholder='Optional'
          autoComplete='new-password'
        />
        <ChipModalField
          type='input'
          title='Region'
          value={region}
          onChange={(value) => {
            setRegion(value)
            clearError()
          }}
          placeholder='us-ashburn-1'
          autoComplete='off'
          mono
          required
        />
        <ChipModalField
          type='input'
          title='Display name'
          value={displayName}
          onChange={setDisplayName}
          placeholder='Defaults to the OCI user OCID'
          autoComplete='off'
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
        secondaryActions={[{ label: 'Setup guide', onClick: () => openDocs(OCI_API_KEY_DOCS_URL) }]}
        primaryAction={{
          label: isPending
            ? credentialId
              ? 'Reconnecting...'
              : 'Adding...'
            : credentialId
              ? 'Reconnect'
              : 'Add API key',
          onClick: handleSubmit,
          disabled: isDisabled,
        }}
      />
    </ChipModal>
  )
}

interface GoogleServiceAccountModalProps extends ProviderModalProps {
  oauthServiceId?: string
}

type GoogleAuthType = 'json_key' | 'workload_identity'

/**
 * Google service-account flow. Accepts the raw JSON key (paste or drag/drop)
 * and validates against the shared `serviceAccountJsonSchema` so the same
 * shape errors render here as in the server route. For a Google Cloud service
 * (or a keyless credential being reconnected) on a deployment that can sign
 * workload-identity tokens, it also offers keyless Workload Identity Federation.
 */
function GoogleServiceAccountModal(props: GoogleServiceAccountModalProps) {
  if (!props.open) return null
  return (
    <GoogleServiceAccountModalForm
      key={`${resourceScopeKey(resourceScopeFromOwner(props))}:${props.credentialId ?? 'new'}`}
      {...props}
    />
  )
}

function GoogleServiceAccountModalForm({
  open,
  onOpenChange,
  workspaceId,
  organizationId,
  serviceName,
  serviceIcon: ServiceIcon,
  credentialId,
  initialDisplayName,
  initialDescription,
  oauthServiceId,
  onCreated,
}: GoogleServiceAccountModalProps) {
  const cloudService = Boolean(oauthServiceId && GOOGLE_KEYLESS_SERVICES.has(oauthServiceId))
  const keyless = useKeylessSetup({
    provider: 'google',
    workspaceId,
    organizationId,
    credentialId,
    enabled: cloudService || Boolean(credentialId),
  })
  const keylessSubmit = useSavedConnectionSubmit({
    providerId: GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
    workspaceId,
    organizationId,
    credentialId,
    onCreated,
    onClose: () => onOpenChange(false),
  })
  const keylessOffer = googleKeylessOffer({
    oauthServiceId,
    available: Boolean(keyless.available),
    reconnectsKeyless: keyless.reconnectAuthType === 'workload_identity',
  })
  const offerKeyless = keylessOffer === 'offer'
  const [selectedAuthType, setSelectedAuthType] = useState<GoogleAuthType | null>(null)
  const authType: GoogleAuthType = offerKeyless
    ? (selectedAuthType ?? keyless.reconnectAuthType ?? 'json_key')
    : 'json_key'
  const [keylessInput, setKeylessInput] = useState<GoogleKeylessInput>(EMPTY_GOOGLE_KEYLESS_INPUT)
  const [jsonInput, setJsonInput] = useState('')
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)

  const createCredential = useCreateScopedCredential()
  const updateCredential = useUpdateScopedCredential()

  /**
   * Try to auto-populate display name from the JSON `client_email`. Silent on
   * parse failure — the explicit submit-time validation surfaces invalid JSON
   * via the inline error state.
   */
  const maybeFillDisplayNameFromJson = (text: string) => {
    if (displayName.trim()) return
    try {
      const parsed = JSON.parse(text) as { client_email?: unknown }
      if (typeof parsed.client_email === 'string') setDisplayName(parsed.client_email)
    } catch {
      // surface validation on submit instead
    }
  }

  const readJsonFile = (file: File) => {
    if (!file.name.endsWith('.json')) {
      setError('Only .json files are supported')
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result
      if (typeof text !== 'string') return
      setJsonInput(text)
      setUploadedFileName(file.name)
      setError(null)
      maybeFillDisplayNameFromJson(text)
    }
    reader.readAsText(file)
  }

  const handleFileUpload = (files: File[]) => {
    const file = files[0]
    if (file) readJsonFile(file)
  }

  const handleSubmit = async () => {
    setError(null)
    const trimmed = jsonInput.trim()
    if (!trimmed) {
      setError('Paste the service account JSON key.')
      return
    }
    const validation = serviceAccountJsonSchema.safeParse(trimmed)
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? 'Invalid JSON')
      return
    }
    try {
      let connectedCredentialId = credentialId
      if (credentialId) {
        await updateCredential.mutateAsync({
          ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
          credentialId,
          serviceAccountJson: trimmed,
          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
        })
      } else {
        const created = await createCredential.mutateAsync({
          ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
          type: 'service_account',
          providerId: GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
          serviceAccountJson: trimmed,
        })
        connectedCredentialId = created.credential.id
      }
      if (connectedCredentialId) onCreated?.(connectedCredentialId)
      onOpenChange(false)
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to add service account')
      setError(message)
      logger.error('Failed to add Google service account credential', err)
    }
  }

  const isPending =
    createCredential.isPending || updateCredential.isPending || keylessSubmit.isPending
  const cloudOnly = keylessOffer === 'cloud_only'
  const isDisabled =
    cloudOnly ||
    (authType === 'workload_identity'
      ? isPending || !keyless.ready || !isGoogleKeylessInputComplete(keylessInput)
      : !jsonInput.trim() || isPending)
  const submitError = authType === 'workload_identity' ? keylessSubmit.error : error

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={`Add ${serviceName} service account`}
    >
      <ChipModalHeader icon={withBrandIcon(ServiceIcon)} onClose={() => onOpenChange(false)}>
        Add {serviceName} service account
      </ChipModalHeader>
      <ChipModalBody>
        {offerKeyless && (
          <ChipModalField
            type='dropdown'
            title='Authentication'
            value={authType}
            onChange={(value) => {
              setSelectedAuthType(value as GoogleAuthType)
              setError(null)
              keylessSubmit.clearError()
            }}
            options={[
              { value: 'json_key', label: 'JSON key' },
              {
                value: 'workload_identity',
                label: 'Workload Identity Federation (keyless, via Sim OIDC)',
              },
            ]}
            required
            hint={
              authType === 'workload_identity'
                ? 'No key is stored. Sim signs a short-lived token your workload identity provider trusts, then impersonates the service account. Google Cloud APIs only, without domain-wide delegation.'
                : undefined
            }
          />
        )}

        {authType === 'workload_identity' && (
          <GoogleKeylessFields
            input={keylessInput}
            onChange={(next) => {
              setKeylessInput(next)
              keylessSubmit.clearError()
            }}
            setup={keyless}
          />
        )}

        {cloudOnly && (
          <ChipModalDescription>
            This keyless credential works only with Google Cloud services (BigQuery, Vertex AI).
            Reconnect it from one of those integrations or from the credential’s own page.
          </ChipModalDescription>
        )}

        {authType === 'json_key' && !cloudOnly && (
          <>
            <ChipModalField
              type='textarea'
              title='JSON key'
              value={jsonInput}
              onChange={(value) => {
                setJsonInput(value)
                if (uploadedFileName) setUploadedFileName(null)
                if (error) setError(null)
                maybeFillDisplayNameFromJson(value)
              }}
              placeholder='Paste your service account JSON key here'
              minHeight={120}
              required
            />

            <ChipModalField
              type='file'
              title='Or upload a file'
              accept='.json'
              label={
                uploadedFileName
                  ? `Uploaded ${uploadedFileName} — click or drop to replace`
                  : 'Drag & drop a .json file, or click to browse'
              }
              onChange={handleFileUpload}
            />
          </>
        )}

        <ChipModalField
          type='input'
          title='Display name'
          value={displayName}
          onChange={setDisplayName}
          placeholder={
            authType === 'workload_identity'
              ? 'Defaults to the service account email'
              : 'Auto-populated from client_email'
          }
          autoComplete='off'
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

        <ChipModalError>{submitError}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        secondaryActions={[
          {
            label: 'Setup guide',
            onClick: () => openDocs(GOOGLE_SERVICE_ACCOUNT_DOCS_URL),
          },
        ]}
        primaryAction={{
          label: isPending
            ? authType === 'workload_identity'
              ? 'Verifying...'
              : 'Adding...'
            : 'Add service account',
          onClick: () => {
            if (authType === 'json_key') {
              void handleSubmit()
              return
            }
            if (!isDisabled) {
              void keylessSubmit.submit({
                config: buildGoogleKeylessConfig(keylessInput, keyless),
                displayName,
                description,
              })
            }
          },
          disabled: isDisabled,
        }}
      />
    </ChipModal>
  )
}

interface AtlassianServiceAccountModalProps extends ProviderModalProps {
  atlassianProduct?: AtlassianProduct
  setupGuideUrl?: string
}

/**
 * Atlassian service-account flow. Accepts an API token + site domain and
 * validates server-side against the Atlassian API. Maps the route's
 * `error.code` to descriptive copy so users know whether the token, domain,
 * or upstream availability is at fault.
 */
function AtlassianServiceAccountModal(props: AtlassianServiceAccountModalProps) {
  if (!props.open) return null
  return (
    <AtlassianServiceAccountModalForm
      key={`${resourceScopeKey(resourceScopeFromOwner(props))}:${props.credentialId ?? 'new'}`}
      {...props}
    />
  )
}

function AtlassianServiceAccountModalForm({
  atlassianProduct,
  setupGuideUrl = ATLASSIAN_SERVICE_ACCOUNT_DOCS_URL,
  open,
  onOpenChange,
  workspaceId,
  organizationId,
  serviceName,
  serviceIcon: ServiceIcon,
  credentialId,
  initialDisplayName,
  initialDescription,
  onCreated,
}: AtlassianServiceAccountModalProps) {
  /**
   * A reconnect cannot pre-select the sign-in: the stored one lives inside the encrypted secret
   * and is never returned to the client, so the admin restates it while retyping the secret.
   */
  const [authMethod, setAuthMethod] = useState<AtlassianAuthMethod | null>(
    credentialId ? null : 'api_token'
  )
  const [apiToken, setApiToken] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [domain, setDomain] = useState('')
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)

  const createCredential = useCreateScopedCredential()
  const updateCredential = useUpdateScopedCredential()

  const usesClientCredentials = authMethod === CLIENT_CREDENTIALS_AUTH_METHOD
  const trimmedToken = apiToken.trim()
  const normalizedDomain = normalizeAtlassianDomain(domain)
  const showDomainHint =
    normalizedDomain.length > 0 && !ATLASSIAN_DOMAIN_HINT_REGEX.test(normalizedDomain)

  const isPending = createCredential.isPending || updateCredential.isPending
  const isDisabled =
    !authMethod ||
    (usesClientCredentials ? !clientId.trim() || !clientSecret.trim() : !trimmedToken) ||
    !normalizedDomain ||
    isPending

  const clearError = () => {
    if (error) setError(null)
  }

  const handleSubmit = async () => {
    setError(null)
    if (isDisabled) return
    const secretFields = usesClientCredentials
      ? {
          authMethod: CLIENT_CREDENTIALS_AUTH_METHOD,
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          domain: normalizedDomain,
        }
      : { apiToken: trimmedToken, domain: normalizedDomain }
    try {
      let connectedCredentialId = credentialId
      if (credentialId) {
        await updateCredential.mutateAsync({
          ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
          credentialId,
          ...secretFields,
          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
        })
      } else {
        const created = await createCredential.mutateAsync({
          ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
          type: 'service_account',
          providerId: ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
          ...secretFields,
          atlassianProduct,
          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
        })
        connectedCredentialId = created.credential.id
      }
      if (connectedCredentialId) onCreated?.(connectedCredentialId)
      onOpenChange(false)
    } catch (err: unknown) {
      setError(messageForAtlassianError(err, authMethod))
      logger.error('Failed to add Atlassian service account credential', err)
    }
  }

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={`Add ${serviceName} service account`}
    >
      <ChipModalHeader icon={withBrandIcon(ServiceIcon)} onClose={() => onOpenChange(false)}>
        Add {serviceName} service account
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='dropdown'
          title='Authentication'
          value={authMethod ?? undefined}
          onChange={(value) => {
            setAuthMethod(value as AtlassianAuthMethod)
            clearError()
          }}
          options={[
            { value: 'api_token', label: 'Scoped API token' },
            {
              value: CLIENT_CREDENTIALS_AUTH_METHOD,
              label: 'OAuth 2.0 credential (client credentials)',
            },
          ]}
          required
          hint={
            usesClientCredentials
              ? 'Atlassian supports these credentials for Jira and Confluence.'
              : undefined
          }
        />

        {usesClientCredentials ? (
          <ClientCredentialsFields
            clientId={clientId}
            clientSecret={clientSecret}
            onClientIdChange={(value) => {
              setClientId(value)
              clearError()
            }}
            onClientSecretChange={(value) => {
              setClientSecret(value)
              clearError()
            }}
            clientIdHint={
              atlassianProduct === 'confluence'
                ? 'Use an OAuth 2.0 credential with Confluence scopes. Required scopes are listed in the setup guide.'
                : 'Use an OAuth 2.0 credential with Jira scopes. Jira Service Management needs a scoped API token.'
            }
            secretInputName='atlassian_service_account_client_secret'
          />
        ) : authMethod === 'api_token' ? (
          <ChipModalField
            type='custom'
            title='API token'
            required
            hint={
              atlassianProduct === 'confluence'
                ? 'Use a service-account token with Confluence access. Required scopes are listed in the setup guide.'
                : ATLASSIAN_COVERAGE_HINT
            }
          >
            {(aria) => (
              <SecretInput
                {...aria}
                value={apiToken}
                onChange={(value) => {
                  setApiToken(value)
                  clearError()
                }}
                placeholder='Paste API token'
                name='atlassian_service_account_api_token'
                autoComplete='new-password'
                autoCorrect='off'
                autoCapitalize='off'
                data-lpignore='true'
                data-form-type='other'
              />
            )}
          </ChipModalField>
        ) : null}

        <ChipModalField
          type='input'
          title='Site domain'
          value={domain}
          onChange={(value) => {
            setDomain(value)
            if (error) setError(null)
          }}
          placeholder='your-team.atlassian.net'
          autoComplete='off'
          required
          error={
            showDomainHint
              ? 'Atlassian sites usually look like your-team.atlassian.net.'
              : undefined
          }
        />

        <ChipModalField
          type='input'
          title='Display name'
          value={displayName}
          onChange={setDisplayName}
          placeholder="Defaults to the account's Atlassian display name"
          autoComplete='off'
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
            onClick: () => openDocs(setupGuideUrl),
          },
        ]}
        primaryAction={{
          label: isPending ? 'Adding...' : 'Add service account',
          onClick: handleSubmit,
          disabled: isDisabled,
        }}
      />
    </ChipModal>
  )
}
