import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isApiClientError } from '@/lib/api/client/errors'
import { type ResourceScope, resourceScopeFields } from '@/lib/core/resource-scope'
import {
  AUTH_METHOD_FIELD_ID,
  type ClientCredentialAccountDescriptor,
  type ClientCredentialAccountField,
  getClientCredentialAccountDescriptor,
  partitionClientCredentialFields,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import { getConfigServiceAccountDescriptor } from '@/lib/credentials/config-service-accounts/descriptors'
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
import {
  useCreateScopedCredential,
  useUpdateScopedCredential,
} from '@/hooks/queries/scoped-credentials'
import { useConfigServiceAccountForm } from '@/platform/lib/data/credentials/config-service-account'

const logger = createLogger('ServiceAccountForm')

const CLIENT_CREDENTIAL_FALLBACK = "We couldn't save this credential. Try again in a moment."
const CONFIG_FALLBACK = 'Could not verify the credential. Check the details and try again.'

/**
 * The dialog that adds a service account of this provider, as the legacy setup modal dispatches:
 * a pasted token, an app's client credentials and a cloud configuration (AWS, Databricks,
 * Snowflake, a Microsoft app) share one form, and each remaining kind has its own.
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
    getClientCredentialAccountDescriptor(providerId) ??
    getConfigServiceAccountDescriptor(providerId)
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

/**
 * Whether the shared dialog can reconnect this provider's service account in place: a cloud
 * configuration (AWS, Databricks, Snowflake, a Microsoft app) is saved onto the same credential.
 */
export function canReconnectServiceAccount(providerId: string | null | undefined): boolean {
  return Boolean(getConfigServiceAccountDescriptor(providerId ?? undefined))
}

/** One field of the setup form, with the hint or format warning it currently shows. */
export interface ServiceAccountFormField {
  id: string
  label: string
  placeholder: string
  secret: boolean
  multiline: boolean
  required: boolean
  options?: readonly {
    value: string
    label: string
    disabled?: boolean
    disabledReason?: string
  }[]
  /** A value Sim issues for the viewer to copy into their provider, never entered. */
  copy?: boolean
  value: string
  /** A soft format warning, shown only while the value misses the provider's usual shape. */
  formatWarning?: string
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
  /** The workspace or organization that owns the new credential. */
  scope: ResourceScope
  serviceAccountProviderId: string
  onCreated: (credentialId: string) => void
  /**
   * Saves the entered fields through another operation instead of creating a scoped credential, as
   * a member's saved Search account does, and resolves to the saved credential's id.
   */
  submitCredentials?: (fields: Record<string, string>) => Promise<string>
  /** Whether that operation is still saving. */
  submitPending?: boolean
  /** The name an account being replaced already has, which the form starts with. */
  initialDisplayName?: string
  /** The description an account being replaced already has, which the form starts with. */
  initialDescription?: string
  /**
   * The credential a cloud configuration (AWS, Databricks) replaces in place, keeping its id and
   * members. Its stored secrets are never prefilled.
   */
  reconnectCredentialId?: string
}

/**
 * Adds a token-paste or client-credential service account from the credential picker, through the
 * same create mutation and server verification as the Integrations page. A grant choice shows only
 * that grant's fields and submits only those. `submit` resolves with the new credential selected,
 * or rejects with the provider's verification failure in readable terms.
 */
export function useServiceAccountForm({
  scope,
  serviceAccountProviderId,
  onCreated,
  submitCredentials,
  submitPending = false,
  initialDisplayName = '',
  initialDescription = '',
  reconnectCredentialId,
}: UseServiceAccountFormOptions) {
  const pastedToken = getTokenServiceAccountDescriptor(serviceAccountProviderId)
  // A cloud configuration (Snowflake's keyless service user beside its token) wins, unless another
  // operation saves the fields: that one takes the token only.
  const configDescriptor =
    submitCredentials && pastedToken
      ? undefined
      : getConfigServiceAccountDescriptor(serviceAccountProviderId)
  const tokenDescriptor = configDescriptor ? undefined : pastedToken
  const clientDescriptor =
    configDescriptor || tokenDescriptor
      ? undefined
      : getClientCredentialAccountDescriptor(serviceAccountProviderId)
  const descriptor = configDescriptor ?? tokenDescriptor ?? clientDescriptor
  const [values, setValues] = useState<Record<string, string>>({})
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [description, setDescription] = useState(initialDescription)
  const createCredential = useCreateScopedCredential()
  const updateCredential = useUpdateScopedCredential()
  const configForm = useConfigServiceAccountForm({
    descriptor: configDescriptor,
    scope,
    reconnectCredentialId,
  })

  const setField = configDescriptor
    ? configForm.setField
    : (id: string, value: string) => setValues((current) => ({ ...current, [id]: value }))

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
        formatWarning: field.id === 'apiToken' ? warning : undefined,
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
        formatWarning: formatHint(field, raw.trim()),
      }
    })
  } else if (configDescriptor) {
    fields = configForm.fields
  }

  const missingRequired = configDescriptor
    ? !configForm.config
    : fields.some(
        (field) => field.required && !field.value.trim() && field.id !== AUTH_METHOD_FIELD_ID
      )
  const isPending = createCredential.isPending || updateCredential.isPending || submitPending

  const submitConfig = async (config: Record<string, string>) => {
    const owner = resourceScopeFields(scope)
    const bodyFields = configDescriptor?.bodyFields?.[configForm.authType]
    const secret = bodyFields
      ? Object.fromEntries(
          Object.entries(bodyFields).flatMap(([fieldId, bodyField]) =>
            config[fieldId] ? [[bodyField, config[fieldId].trim()]] : []
          )
        )
      : { serviceAccountJson: JSON.stringify(config) }
    const shared = { ...secret, displayName: displayName.trim() || undefined }
    try {
      if (reconnectCredentialId) {
        await updateCredential.mutateAsync({
          ...owner,
          ...shared,
          credentialId: reconnectCredentialId,
          description: description.trim() || null,
        })
        onCreated(reconnectCredentialId)
        return undefined
      }
      const created = await createCredential.mutateAsync({
        ...owner,
        ...shared,
        description: description.trim() || undefined,
        type: 'service_account',
        providerId: serviceAccountProviderId,
      })
      onCreated(created.credential.id)
      return undefined
    } catch (error) {
      logger.error('Failed to save credential', { service: configDescriptor?.serviceLabel, error })
      if (isApiClientError(error) && error.code === 'duplicate_display_name')
        throw new Error(
          'A credential with that name already exists. Choose a different display name.'
        )
      const codeMessage =
        isApiClientError(error) && error.code
          ? configDescriptor?.errorMessage?.(error.code, configForm.authType)
          : undefined
      throw new Error(
        codeMessage ?? (isApiClientError(error) && error.message ? error.message : CONFIG_FALLBACK)
      )
    }
  }

  const submit = async () => {
    if (!descriptor || missingRequired) return false
    if (configDescriptor) return configForm.config ? submitConfig(configForm.config) : false
    if (submitCredentials) {
      const fields: Record<string, string> = { ...secretFields }
      if (displayName.trim()) fields.displayName = displayName.trim()
      if (description.trim()) fields.description = description.trim()
      try {
        onCreated(await submitCredentials(fields))
        return undefined
      } catch (error) {
        logger.error('Failed to save credential', { service: descriptor.serviceLabel, error })
        throw new Error(getErrorMessage(error, CLIENT_CREDENTIAL_FALLBACK))
      }
    }
    try {
      const created = await createCredential.mutateAsync({
        ...resourceScopeFields(scope),
        type: 'service_account',
        providerId: descriptor.providerId,
        ...secretFields,
        displayName: displayName.trim() || undefined,
        description: description.trim() || undefined,
      })
      onCreated(created.credential.id)
      return undefined
    } catch (error) {
      logger.error('Failed to add service account credential', {
        service: descriptor.serviceLabel,
        error,
      })
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
    /** The vendor a cloud configuration is titled with ("AWS" on the S3 page), over the app's name. */
    vendorName: configDescriptor?.serviceLabel,
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
