import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { isApiClientError } from '@/lib/api/client/errors'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import {
  AUTH_METHOD_FIELD_ID,
  type ClientCredentialAccountDescriptor,
  type ClientCredentialAccountField,
  getClientCredentialAccountDescriptor,
  partitionClientCredentialFields,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  getTokenServiceAccountDescriptor,
  getTokenServiceAccountErrorMessage,
  type TokenServiceAccountField,
} from '@/lib/credentials/token-service-accounts/descriptors'
import {
  ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID,
  GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID,
  OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID,
  ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID,
  SLACK_CUSTOM_BOT_PROVIDER_ID,
} from '@/lib/oauth/types'
import { useCreateScopedCredential } from '@/hooks/queries/scoped-credentials'

const logger = createLogger('ServiceAccountForm')

const CLIENT_CREDENTIAL_FALLBACK = "We couldn't save this credential. Try again in a moment."

/**
 * The dialog that adds a service account of this provider, as the legacy setup modal dispatches:
 * a pasted token or an app's client credentials share one form, and each remaining kind has its own.
 */
export type ServiceAccountSetupKind =
  | 'form'
  | 'google'
  | 'atlassian'
  | 'oci-api-key'
  | 'oracle-database'
  | 'slack-bot'

/** Which setup dialog adds this provider's service account, or null when none can. */
export function serviceAccountSetupKind(
  providerId: string | undefined
): ServiceAccountSetupKind | null {
  if (
    getTokenServiceAccountDescriptor(providerId) ??
    getClientCredentialAccountDescriptor(providerId)
  )
    return 'form'
  switch (providerId) {
    case GOOGLE_SERVICE_ACCOUNT_PROVIDER_ID:
      return 'google'
    case ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID:
      return 'atlassian'
    case OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID:
      return 'oci-api-key'
    case ORACLE_DATABASE_SERVICE_ACCOUNT_PROVIDER_ID:
      return 'oracle-database'
    case SLACK_CUSTOM_BOT_PROVIDER_ID:
      return 'slack-bot'
    default:
      return null
  }
}

/** Whether the shared service-account dialog can add this provider's account in place. */
export function hasServiceAccountForm(providerId: string | undefined): boolean {
  return serviceAccountSetupKind(providerId) !== null
}

/** One field of the setup form, with the hint or format warning it currently shows. */
interface ServiceAccountFormField {
  id: string
  label: string
  placeholder: string
  secret: boolean
  multiline: boolean
  required: boolean
  options?: readonly { value: string; label: string }[]
  value: string
  hint?: string
  /** A format warning that holds the field as invalid. */
  error?: string
}

function stripDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
}

function formatHint(
  field: TokenServiceAccountField | ClientCredentialAccountField,
  value: string
): string | undefined {
  if (!field.hintPattern || !field.hintMessage || value.length === 0) return undefined
  const normalized =
    'hintNormalize' in field && field.hintNormalize ? field.hintNormalize(value) : value
  return field.hintPattern.test(normalized) ? undefined : field.hintMessage
}

/** The verification failure in the terms of the fields the chosen grant needed. */
function clientCredentialMessage(
  error: unknown,
  descriptor: ClientCredentialAccountDescriptor,
  required: readonly ClientCredentialAccountField[]
): string {
  if (!isApiClientError(error) || !error.code) return CLIENT_CREDENTIAL_FALLBACK
  const fieldLabels = required.map((field) => field.label).join(', ')
  switch (error.code) {
    case 'invalid_credentials':
      return `We couldn't authenticate with those credentials. Check that the ${fieldLabels} all belong to the same ${descriptor.serviceLabel} app and that the app is authorized.`
    case 'permission_conflict':
      return 'Use the same permissions for connections to this application, or create a separate application for different permissions.'
    case 'site_not_found': {
      const hostLabel = descriptor.fields.find((field) => field.id === 'orgId')?.label ?? 'host'
      return `We couldn't find a ${descriptor.serviceLabel} account at that host. Check the ${hostLabel} field and try again.`
    }
    case 'provider_unavailable':
      return `We couldn't reach ${descriptor.serviceLabel} to verify these credentials. Try again in a moment.`
    case 'duplicate_display_name':
      return 'A credential with that name already exists in this workspace.'
    default:
      return CLIENT_CREDENTIAL_FALLBACK
  }
}

interface UseServiceAccountFormOptions {
  workspaceId: string
  serviceAccountProviderId: string
  onCreated: (credentialId: string) => void
}

/**
 * Adds a token-paste or client-credential service account from the credential picker, through the
 * same create mutation and server verification as the Integrations page. A grant choice shows only
 * that grant's fields and submits only those. `submit` resolves with the new credential selected,
 * or rejects with the provider's verification failure in readable terms.
 */
export function useServiceAccountForm({
  workspaceId,
  serviceAccountProviderId,
  onCreated,
}: UseServiceAccountFormOptions) {
  const tokenDescriptor = getTokenServiceAccountDescriptor(serviceAccountProviderId)
  const clientDescriptor = tokenDescriptor
    ? undefined
    : getClientCredentialAccountDescriptor(serviceAccountProviderId)
  const descriptor = tokenDescriptor ?? clientDescriptor
  const [values, setValues] = useState<Record<string, string>>({})
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const createCredential = useCreateScopedCredential()

  const setField = (id: string, value: string) =>
    setValues((current) => ({ ...current, [id]: value }))

  let fields: ServiceAccountFormField[] = []
  const secretFields: Record<string, string> = {}
  let requiredClientFields: ClientCredentialAccountField[] = []

  if (tokenDescriptor) {
    fields = tokenDescriptor.fields.map((field) => {
      const raw = values[field.id] ?? ''
      const normalized = field.id === 'domain' ? stripDomain(raw) : raw.trim()
      if (normalized) secretFields[field.id] = normalized
      const warning = formatHint(field, normalized)
      return {
        id: field.id,
        label: field.label,
        placeholder: field.placeholder,
        secret: field.secret,
        multiline: false,
        required: true,
        value: raw,
        hint: field.id === 'apiToken' ? (warning ?? tokenDescriptor.helpText) : undefined,
        error: field.id === 'domain' ? warning : undefined,
      }
    })
  } else if (clientDescriptor) {
    const { visible, required } = partitionClientCredentialFields(
      clientDescriptor,
      values[AUTH_METHOD_FIELD_ID]
    )
    requiredClientFields = required
    const requiredIds = new Set(required.map((field) => field.id))
    fields = visible.map((field) => {
      const raw =
        field.id === AUTH_METHOD_FIELD_ID
          ? (values[field.id] ?? clientDescriptor.defaultAuthMethod ?? '')
          : (values[field.id] ?? '')
      const submitted = field.preserveWhitespace ? raw : raw.trim()
      if (submitted && field.id !== AUTH_METHOD_FIELD_ID) secretFields[field.id] = submitted
      if (field.id === AUTH_METHOD_FIELD_ID && values[field.id])
        secretFields[field.id] = values[field.id]
      return {
        id: field.id,
        label: field.label,
        placeholder: field.placeholder,
        secret: field.secret,
        multiline: Boolean(field.multiline),
        required: requiredIds.has(field.id),
        options: field.options,
        value: raw,
        hint:
          formatHint(field, raw.trim()) ??
          field.hint ??
          (field.id === 'orgId' ? clientDescriptor.helpText : undefined),
      }
    })
  }

  const missingRequired = fields.some(
    (field) => field.required && !field.value.trim() && field.id !== AUTH_METHOD_FIELD_ID
  )
  const isPending = createCredential.isPending

  const submit = async () => {
    if (!descriptor || missingRequired) return false
    try {
      const created = await createCredential.mutateAsync({
        ...resourceScopeFields(resourceScopeFromOwner({ workspaceId })),
        type: 'service_account',
        providerId: descriptor.providerId,
        ...secretFields,
        displayName: displayName.trim() || undefined,
        description: description.trim() || undefined,
      })
      onCreated(created.credential.id)
      return undefined
    } catch (error) {
      logger.error(`Failed to add ${descriptor.serviceLabel} service account credential`, error)
      throw new Error(
        tokenDescriptor
          ? getTokenServiceAccountErrorMessage(
              tokenDescriptor,
              isApiClientError(error) ? error.code : undefined
            )
          : clientDescriptor
            ? clientCredentialMessage(error, clientDescriptor, requiredClientFields)
            : CLIENT_CREDENTIAL_FALLBACK
      )
    }
  }

  return {
    available: Boolean(descriptor),
    serviceLabel: descriptor?.serviceLabel ?? '',
    connectNoun: descriptor?.connectNoun ?? '',
    docsUrl: descriptor?.docsUrl,
    fields,
    setField,
    displayName,
    setDisplayName,
    description,
    setDescription,
    isPending,
    confirmDisabled: !descriptor || missingRequired || isPending,
    submit,
  }
}
