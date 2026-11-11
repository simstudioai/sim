import { useState } from 'react'
import { generateShortId } from '@sim/utils/id'
import { isApiClientError } from '@/lib/api/client/errors'
import type { ResourceScope } from '@/lib/core/resource-scope'
import {
  buildConfigServiceAccountConfig,
  type ConfigServiceAccountDescriptor,
} from '@/lib/credentials/config-service-accounts/descriptors'
import { useWorkloadIdentitySetup } from '@/hooks/queries/scoped-credentials'
import type { ServiceAccountFormField } from '@/platform/lib/data/credentials/use-service-account-form'

/** The form field that chooses how Sim signs in. */
const CONFIG_AUTH_TYPE_FIELD_ID = 'authType'
/** On reconnect, whether a keyless credential keeps the subject its cloud already trusts. */
const TRUST_CHOICE_FIELD_ID = 'trustSubject'

const ORGANIZATION_KEYLESS_REASON =
  'Keyless sign-in trusts one workspace. Add this credential from a workspace to use it.'
const DEPLOYMENT_KEYLESS_REASON = 'Keyless sign-in isn’t configured on this deployment.'
const SETUP_FALLBACK = 'Could not start a keyless connection.'

interface UseConfigServiceAccountFormOptions {
  descriptor: ConfigServiceAccountDescriptor | undefined
  scope: ResourceScope
  /** The credential being reconnected, which keeps its keyless subject unless the viewer issues a new one. */
  reconnectCredentialId?: string
}

/**
 * The fields of a configuration service account (AWS, Databricks, Snowflake, a Microsoft app, a
 * keyless Google service account): an auth type choice, the chosen
 * type's own fields, and for keyless sign-in the issuer, audience, subject and trust snippet the
 * viewer pastes into their cloud, read from the same workload-identity setup the legacy dialogs
 * read. Keyless is offered only in a workspace whose deployment has a signing key; elsewhere the
 * option stays visible, disabled with the reason. `config` is what `serviceAccountJson` submits,
 * or null while a required value or the keyless setup is missing.
 */
export function useConfigServiceAccountForm({
  descriptor,
  scope,
  reconnectCredentialId,
}: UseConfigServiceAccountFormOptions) {
  const [sessionKey] = useState(() => generateShortId())
  const [selectedAuthType, setSelectedAuthType] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [subjectChoice, setSubjectChoice] = useState<'keep' | 'new'>(
    reconnectCredentialId ? 'keep' : 'new'
  )
  const workspaceId = scope.kind === 'workspace' ? scope.workspaceId : undefined
  const setup = useWorkloadIdentitySetup({
    workspaceId,
    provider: descriptor?.workloadIdentityProvider ?? 'aws',
    sessionKey,
    enabled: Boolean(descriptor && workspaceId),
    credentialId: reconnectCredentialId,
  })

  if (!descriptor) return { fields: [], setField: () => {}, config: null, authType: '' }

  const keylessAvailable = workspaceId ? setup.data?.available : false
  const keylessReason = !workspaceId
    ? ORGANIZATION_KEYLESS_REASON
    : setup.data?.available === false
      ? DEPLOYMENT_KEYLESS_REASON
      : undefined
  const keylessType = descriptor.authTypes.find((type) => type.keyless)?.value
  const storedAuthType = descriptor.authTypes.find(
    (type) => type.value === setup.data?.reconnectAuthType && (keylessAvailable || !type.keyless)
  )?.value
  const startingAuthType = reconnectCredentialId
    ? (storedAuthType ?? descriptor.keyedDefault)
    : keylessAvailable && keylessType && !descriptor.keyedFirst
      ? keylessType
      : descriptor.keyedDefault
  const authType = selectedAuthType ?? startingAuthType
  const chosen = descriptor.authTypes.find((type) => type.value === authType)
  const keyless = Boolean(chosen?.keyless)
  const trust = setup.data?.available && subjectChoice === 'new' ? setup.data : undefined

  const setField = (id: string, value: string) => {
    if (id === CONFIG_AUTH_TYPE_FIELD_ID) {
      setSelectedAuthType(value)
      setValues((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([fieldId]) => {
            const field = descriptor.fields.find((entry) => entry.id === fieldId)
            return !field?.secret || field.authTypes.includes(value)
          })
        )
      )
      return
    }
    if (id === TRUST_CHOICE_FIELD_ID) {
      setSubjectChoice(value === 'new' ? 'new' : 'keep')
      return
    }
    setValues((current) => ({ ...current, [id]: value }))
  }

  const setupError =
    keyless && setup.isError
      ? isApiClientError(setup.error) && setup.error.message
        ? setup.error.message
        : SETUP_FALLBACK
      : undefined

  const fields: ServiceAccountFormField[] = [
    {
      id: CONFIG_AUTH_TYPE_FIELD_ID,
      label: 'Authentication',
      placeholder: `Choose how Sim signs in to ${descriptor.serviceLabel}`,
      secret: false,
      multiline: false,
      required: true,
      options: descriptor.authTypes.map((type) =>
        type.keyless && !keylessAvailable
          ? { value: type.value, label: type.label, disabled: true, disabledReason: keylessReason }
          : { value: type.value, label: type.label }
      ),
      value: authType,
      error: setupError,
    },
  ]

  for (const field of descriptor.fields) {
    if (!field.authTypes.includes(authType)) continue
    const value = values[field.id] ?? ''
    const normalized = field.normalize?.(value) ?? value.trim()
    fields.push({
      id: field.id,
      label: field.label,
      placeholder: field.placeholder,
      secret: Boolean(field.secret),
      multiline: Boolean(field.multiline),
      required: !field.optional,
      value,
      error:
        field.format && normalized && !field.format.pattern.test(normalized)
          ? field.format.message
          : undefined,
    })
  }

  if (keyless && reconnectCredentialId) {
    fields.push({
      id: TRUST_CHOICE_FIELD_ID,
      label: 'Trust setup',
      placeholder: 'Choose the subject',
      secret: false,
      multiline: false,
      required: true,
      options: [
        { value: 'keep', label: 'Keep the current subject' },
        { value: 'new', label: 'Issue a new subject (update your trust policy first)' },
      ],
      value: subjectChoice,
    })
  }

  const audience = descriptor.audience ? descriptor.audience(values) : trust?.audience
  const snippet =
    trust && audience !== undefined
      ? descriptor.trustSnippet?.build({ ...trust, audience }, values)
      : undefined
  if (keyless && trust) {
    const copy = (id: string, label: string, value: string, multiline = false) =>
      fields.push({
        id,
        label,
        placeholder: label,
        secret: false,
        multiline,
        required: false,
        copy: true,
        value,
      })
    copy('issuer', 'Issuer', trust.issuer)
    if (audience) copy('audience', 'Audience', audience)
    copy('subject', 'Subject', trust.subject)
    if (descriptor.trustSnippet && snippet)
      copy('trustSnippet', descriptor.trustSnippet.label, snippet, true)
  }

  const missingRequired = fields.some(
    (field) => field.required && !field.copy && !field.options && !field.value.trim()
  )
  const keylessReady = subjectChoice === 'keep' ? Boolean(reconnectCredentialId) : Boolean(trust)
  const ready =
    chosen &&
    !missingRequired &&
    (!keyless || (keylessAvailable && keylessReady && (descriptor.keylessReady?.(values) ?? true)))
  const config = ready
    ? {
        ...buildConfigServiceAccountConfig(descriptor, authType, values),
        ...(keyless && trust ? { subject: trust.subject, subjectProof: trust.subjectProof } : {}),
      }
    : null

  return { fields, setField, config, authType }
}
