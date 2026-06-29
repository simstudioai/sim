'use client'

import { type ComponentType, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useTranslations } from 'next-intl'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  SecretInput,
} from '@/components/emcn'
import { isApiClientError } from '@/lib/api/client/errors'
import { serviceAccountJsonSchema } from '@/lib/api/contracts/credentials'
import { ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import { useCreateWorkspaceCredential } from '@/hooks/queries/credentials'

const logger = createLogger('ConnectServiceAccountModal')

const GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID = 'google-service-account' as const

export type ServiceAccountProviderId =
  | typeof GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID
  | typeof ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID

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
  workspaceId: string
  serviceAccountProviderId: ServiceAccountProviderId
  serviceName: string
  serviceIcon: ComponentType<{ className?: string }>
}

/**
 * Connect-service-account modal mounted from the per-integration detail page.
 * Self-contained: takes the resolved SA provider + service metadata from the
 * caller and submits via `useCreateWorkspaceCredential`. Branches the body
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
  serviceAccountProviderId,
  serviceName,
  serviceIcon,
}: ConnectServiceAccountModalProps) {
  if (serviceAccountProviderId === ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID) {
    return (
      <AtlassianServiceAccountModal
        open={open}
        onOpenChange={onOpenChange}
        workspaceId={workspaceId}
        serviceName={serviceName}
        serviceIcon={serviceIcon}
      />
    )
  }
  return (
    <GoogleServiceAccountModal
      open={open}
      onOpenChange={onOpenChange}
      workspaceId={workspaceId}
      serviceName={serviceName}
      serviceIcon={serviceIcon}
    />
  )
}

interface ProviderModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  serviceName: string
  serviceIcon: ComponentType<{ className?: string }>
}

/**
 * Google service-account flow. Accepts the raw JSON key (paste or drag/drop)
 * and validates against the shared `serviceAccountJsonSchema` so the same
 * shape errors render here as in the server route.
 */
function GoogleServiceAccountModal({
  open,
  onOpenChange,
  workspaceId,
  serviceName,
  serviceIcon: ServiceIcon,
}: ProviderModalProps) {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const [jsonInput, setJsonInput] = useState('')
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const createCredential = useCreateWorkspaceCredential()

  useEffect(() => {
    if (open) return
    setJsonInput('')
    setUploadedFileName(null)
    setDisplayName('')
    setDescription('')
    setError(null)
  }, [open])

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
      await createCredential.mutateAsync({
        workspaceId,
        type: 'service_account',
        displayName: displayName.trim() || undefined,
        description: description.trim() || undefined,
        serviceAccountJson: trimmed,
      })
      onOpenChange(false)
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to add service account')
      setError(message)
      logger.error('Failed to add Google service account credential', err)
    }
  }

  const isPending = createCredential.isPending
  const isDisabled = !jsonInput.trim() || isPending

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={`Add ${serviceName} service account`}
    >
      <ChipModalHeader icon={ServiceIcon} onClose={() => onOpenChange(false)}>
        {t('add')} {serviceName} {t('service_account')}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='textarea'
          title={t('json_key')}
          value={jsonInput}
          onChange={(value) => {
            setJsonInput(value)
            if (uploadedFileName) setUploadedFileName(null)
            if (error) setError(null)
            maybeFillDisplayNameFromJson(value)
          }}
          placeholder={t('paste_your_service_account_json_key')}
          minHeight={120}
          required
        />

        <ChipModalField
          type='file'
          title={t('or_upload_a_file')}
          accept='.json'
          label={
            uploadedFileName
              ? `Uploaded ${uploadedFileName} — click or drop to replace`
              : tI18n('drag_drop_a_json_file_or')
          }
          onChange={handleFileUpload}
        />

        <ChipModalField
          type='input'
          title={t('display_name')}
          value={displayName}
          onChange={setDisplayName}
          placeholder={t('auto_populated_from_client_email')}
          autoComplete='off'
        />

        <ChipModalField
          type='textarea'
          title={t('description')}
          value={description}
          onChange={setDescription}
          placeholder={t('optional_description')}
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
function AtlassianServiceAccountModal({
  open,
  onOpenChange,
  workspaceId,
  serviceName,
  serviceIcon: ServiceIcon,
}: ProviderModalProps) {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const [apiToken, setApiToken] = useState('')
  const [domain, setDomain] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const createCredential = useCreateWorkspaceCredential()

  useEffect(() => {
    if (open) return
    setApiToken('')
    setDomain('')
    setDisplayName('')
    setDescription('')
    setError(null)
  }, [open])

  const trimmedToken = apiToken.trim()
  const normalizedDomain = normalizeAtlassianDomain(domain)
  const showDomainHint =
    normalizedDomain.length > 0 && !ATLASSIAN_DOMAIN_HINT_REGEX.test(normalizedDomain)

  const isPending = createCredential.isPending
  const isDisabled = !trimmedToken || !normalizedDomain || isPending

  const handleSubmit = async () => {
    setError(null)
    if (isDisabled) return
    try {
      await createCredential.mutateAsync({
        workspaceId,
        type: 'service_account',
        providerId: ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
        apiToken: trimmedToken,
        domain: normalizedDomain,
        displayName: displayName.trim() || undefined,
        description: description.trim() || undefined,
      })
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
      <ChipModalHeader icon={ServiceIcon} onClose={() => onOpenChange(false)}>
        {t('add')} {serviceName} {t('service_account')}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='custom' title={t('api_token')} required>
          <SecretInput
            value={apiToken}
            onChange={(value) => {
              setApiToken(value)
              if (error) setError(null)
            }}
            placeholder={t('paste_api_token')}
            name='atlassian_service_account_api_token'
            autoComplete='new-password'
            autoCorrect='off'
            autoCapitalize='off'
            data-lpignore='true'
            data-form-type='other'
          />
        </ChipModalField>

        <ChipModalField
          type='input'
          title={t('site_domain')}
          value={domain}
          onChange={(value) => {
            setDomain(value)
            if (error) setError(null)
          }}
          placeholder={t('your_team_atlassian_net')}
          autoComplete='off'
          required
          error={showDomainHint ? tI18n('atlassian_sites_usually_look_like_your') : undefined}
        />

        <ChipModalField
          type='input'
          title={t('display_name')}
          value={displayName}
          onChange={setDisplayName}
          placeholder={t('defaults_to_the_account_s_atlassian')}
          autoComplete='off'
        />

        <ChipModalField
          type='textarea'
          title={t('description')}
          value={description}
          onChange={setDescription}
          placeholder={t('optional_description')}
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
