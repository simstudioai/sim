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
  getTokenServiceAccountDescriptor,
  type TokenServiceAccountProviderId,
} from '@/lib/credentials/token-service-accounts/descriptors'
import { getServiceAccountCoverageSentence } from '@/lib/integrations/credential-display'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
} from '@/lib/oauth/types'
import { ClientCredentialAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/client-credential-account-modal'
import { TokenServiceAccountModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/token-service-account-modal'
import { ConnectSlackBotModal } from '@/app/workspace/[workspaceId]/integrations/components/connect-slack-bot-modal/connect-slack-bot-modal'
import { withBrandIcon } from '@/blocks/brand-icon'
import {
  useCreateScopedCredential,
  useUpdateScopedCredential,
} from '@/hooks/queries/scoped-credentials'

const logger = createLogger('ConnectServiceAccountModal')

const GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID = 'google-service-account' as const

export type ServiceAccountProviderId =
  | typeof GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof SLACK_CUSTOM_BOT_PROVIDER_ID
  | TokenServiceAccountProviderId
  | ClientCredentialAccountProviderId

/** Sim setup guides for each provider, docked bottom-left of each modal. */
const GOOGLE_SERVICE_ACCOUNT_DOCS_URL = 'https://docs.sim.ai/integrations/google-service-account'
const ATLASSIAN_SERVICE_ACCOUNT_DOCS_URL =
  'https://docs.sim.ai/integrations/atlassian-service-account'

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
}

const FALLBACK_ERROR_MESSAGE = "We couldn't add this service account. Try again in a moment."

function normalizeAtlassianDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
}

function messageForAtlassianError(err: unknown): string {
  if (isApiClientError(err) && err.code && ATLASSIAN_ERROR_MESSAGES[err.code]) {
    return ATLASSIAN_ERROR_MESSAGES[err.code]
  }
  return FALLBACK_ERROR_MESSAGE
}

interface ConnectServiceAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId?: string
  organizationId?: string
  serviceAccountProviderId: ServiceAccountProviderId
  atlassianProduct?: AtlassianProduct
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
  /** Called with the new credential id after a successful create (token-paste providers). */
  onCreated?: (credentialId: string) => void
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
 */
export function ConnectServiceAccountModal({
  open,
  onOpenChange,
  workspaceId,
  organizationId,
  serviceAccountProviderId,
  atlassianProduct,
  serviceName,
  serviceIcon,
  credentialId,
  credentialDisplayName,
  credentialDescription,
  onCreated,
}: ConnectServiceAccountModalProps) {
  const clientCredentialDescriptor = getClientCredentialAccountDescriptor(serviceAccountProviderId)
  if (clientCredentialDescriptor) {
    return (
      <ClientCredentialAccountModal
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
  const tokenDescriptor = getTokenServiceAccountDescriptor(serviceAccountProviderId)
  if (tokenDescriptor) {
    return (
      <TokenServiceAccountModal
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

/**
 * Google service-account flow. Accepts the raw JSON key (paste or drag/drop)
 * and validates against the shared `serviceAccountJsonSchema` so the same
 * shape errors render here as in the server route.
 */
function GoogleServiceAccountModal(props: ProviderModalProps) {
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
  onCreated,
}: ProviderModalProps) {
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

  const isPending = createCredential.isPending || updateCredential.isPending
  const isDisabled = !jsonInput.trim() || isPending

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

        <ChipModalField
          type='input'
          title='Display name'
          value={displayName}
          onChange={setDisplayName}
          placeholder='Auto-populated from client_email'
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
            onClick: () => openDocs(GOOGLE_SERVICE_ACCOUNT_DOCS_URL),
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

/**
 * Atlassian service-account flow. Accepts an API token + site domain and
 * validates server-side against the Atlassian API. Maps the route's
 * `error.code` to descriptive copy so users know whether the token, domain,
 * or upstream availability is at fault.
 */
function AtlassianServiceAccountModal(
  props: ProviderModalProps & { atlassianProduct?: AtlassianProduct }
) {
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
}: ProviderModalProps & { atlassianProduct?: AtlassianProduct }) {
  const [apiToken, setApiToken] = useState('')
  const [domain, setDomain] = useState('')
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)

  const createCredential = useCreateScopedCredential()
  const updateCredential = useUpdateScopedCredential()

  const trimmedToken = apiToken.trim()
  const normalizedDomain = normalizeAtlassianDomain(domain)
  const showDomainHint =
    normalizedDomain.length > 0 && !ATLASSIAN_DOMAIN_HINT_REGEX.test(normalizedDomain)

  const isPending = createCredential.isPending || updateCredential.isPending
  const isDisabled = !trimmedToken || !normalizedDomain || isPending

  const handleSubmit = async () => {
    setError(null)
    if (isDisabled) return
    try {
      let connectedCredentialId = credentialId
      if (credentialId) {
        await updateCredential.mutateAsync({
          ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
          credentialId,
          apiToken: trimmedToken,
          domain: normalizedDomain,

          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
        })
      } else {
        const created = await createCredential.mutateAsync({
          ...resourceScopeFields(resourceScopeFromOwner({ workspaceId, organizationId })),
          type: 'service_account',
          providerId: ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
          apiToken: trimmedToken,
          domain: normalizedDomain,
          atlassianProduct,
          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
        })
        connectedCredentialId = created.credential.id
      }
      if (connectedCredentialId) onCreated?.(connectedCredentialId)
      onOpenChange(false)
    } catch (err: unknown) {
      setError(messageForAtlassianError(err))
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
        <ChipModalField type='custom' title='API token' required hint={ATLASSIAN_COVERAGE_HINT}>
          {(aria) => (
            <SecretInput
              {...aria}
              value={apiToken}
              onChange={(value) => {
                setApiToken(value)
                if (error) setError(null)
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
            onClick: () => openDocs(ATLASSIAN_SERVICE_ACCOUNT_DOCS_URL),
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
