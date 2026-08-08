'use client'

import { type ComponentType, useEffect, useState } from 'react'
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
import { isApiClientError } from '@/lib/api/client/errors'
import type {
  ClientCredentialAccountDescriptor,
  ClientCredentialAccountField,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  useCreateWorkspaceCredential,
  useUpdateWorkspaceCredential,
} from '@/hooks/queries/credentials'

const logger = createLogger('ClientCredentialAccountModal')

const FALLBACK_ERROR_MESSAGE = "We couldn't add this credential. Try again in a moment."

/**
 * Maps server `error.code` values from client-credential verification (a real
 * token mint against the provider) to user-facing messages, personalized with
 * the provider's field labels.
 */
function messageForClientCredentialError(
  err: unknown,
  descriptor: ClientCredentialAccountDescriptor
): string {
  if (isApiClientError(err) && err.code) {
    const fieldLabels = descriptor.fields
      .filter((field) => !field.optional)
      .map((field) => field.label)
      .join(', ')
    switch (err.code) {
      case 'invalid_credentials':
        return `We couldn't authenticate with those credentials. Check that the ${fieldLabels} all belong to the same ${descriptor.serviceLabel} app and that the app is authorized.`
      case 'site_not_found': {
        // "host field" named a label no provider renders — Salesforce calls it
        // My Domain host, and Zoom/Box/Zoho Desk have no host field at all.
        const hostFieldLabel =
          descriptor.fields.find((field) => field.id === 'orgId')?.label ?? 'host'
        return `We couldn't find a ${descriptor.serviceLabel} account at that host. Check the ${hostFieldLabel} field and try again.`
      }
      case 'provider_unavailable':
        return `We couldn't reach ${descriptor.serviceLabel} to verify these credentials. Try again in a moment.`
      case 'duplicate_display_name':
        return 'A credential with that name already exists in this workspace.'
      default:
        return FALLBACK_ERROR_MESSAGE
    }
  }
  return FALLBACK_ERROR_MESSAGE
}

function openDocs(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

interface ClientCredentialAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  descriptor: ClientCredentialAccountDescriptor
  serviceName: string
  serviceIcon: ComponentType<{ className?: string }>
  /** When set, reconnect (rotate the secrets on) this credential in place. */
  credentialId?: string
  initialDisplayName?: string
  initialDescription?: string
  /** Called with the credential id after a successful create or reconnect. */
  onCreated?: (credentialId: string) => void
}

/**
 * Generic connect modal for client-credentials service accounts (Zoom
 * Server-to-Server OAuth, Box CCG). Renders the client id, client secret, and
 * org-identifier fields declared by the provider's
 * {@link ClientCredentialAccountDescriptor} and submits through the same
 * create/update credential mutations as the other service-account modals.
 * The server verifies the triple by minting a real access token; failures are
 * mapped from the route's `error.code`.
 */
export function ClientCredentialAccountModal({
  open,
  onOpenChange,
  workspaceId,
  descriptor,
  serviceName,
  serviceIcon: ServiceIcon,
  credentialId,
  initialDisplayName,
  initialDescription,
  onCreated,
}: ClientCredentialAccountModalProps) {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [orgId, setOrgId] = useState('')
  const [dataCenter, setDataCenter] = useState('')
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)

  const createCredential = useCreateWorkspaceCredential()
  const updateCredential = useUpdateWorkspaceCredential()

  useEffect(() => {
    if (open) return
    setClientId('')
    setClientSecret('')
    setOrgId('')
    setDataCenter('')
    setDisplayName(initialDisplayName ?? '')
    setDescription(initialDescription ?? '')
    setError(null)
  }, [open, initialDisplayName, initialDescription])

  const clientIdField = descriptor.fields.find((field) => field.id === 'clientId')
  const clientSecretField = descriptor.fields.find((field) => field.id === 'clientSecret')
  const orgIdField = descriptor.fields.find((field) => field.id === 'orgId')
  const dataCenterField = descriptor.fields.find((field) => field.id === 'dataCenter')

  const trimmedClientId = clientId.trim()
  const trimmedClientSecret = clientSecret.trim()
  const trimmedOrgId = orgId.trim()
  const trimmedDataCenter = dataCenter.trim()
  const isPending = createCredential.isPending || updateCredential.isPending
  const isDisabled = !trimmedClientId || !trimmedClientSecret || !trimmedOrgId || isPending

  const hintFor = (
    field: ClientCredentialAccountField | undefined,
    value: string
  ): string | undefined => {
    if (!field?.hintPattern || !field.hintMessage || value.length === 0) return undefined
    const normalized = field.hintNormalize ? field.hintNormalize(value) : value
    return field.hintPattern.test(normalized) ? undefined : field.hintMessage
  }

  const handleSubmit = async () => {
    setError(null)
    if (isDisabled) return
    try {
      let connectedCredentialId = credentialId
      const secretFields = {
        clientId: trimmedClientId,
        clientSecret: trimmedClientSecret,
        orgId: trimmedOrgId,
        dataCenter: trimmedDataCenter || undefined,
      }
      if (credentialId) {
        await updateCredential.mutateAsync({
          credentialId,
          ...secretFields,
          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
        })
      } else {
        const created = await createCredential.mutateAsync({
          workspaceId,
          type: 'service_account',
          providerId: descriptor.providerId,
          ...secretFields,
          displayName: displayName.trim() || undefined,
          description: description.trim() || undefined,
        })
        connectedCredentialId = created.credential.id
      }
      if (connectedCredentialId) onCreated?.(connectedCredentialId)
      onOpenChange(false)
    } catch (err: unknown) {
      setError(messageForClientCredentialError(err, descriptor))
      logger.error(`Failed to add ${descriptor.serviceLabel} service account credential`, err)
    }
  }

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={`Add ${serviceName} ${descriptor.connectNoun}`}
    >
      <ChipModalHeader icon={ServiceIcon} onClose={() => onOpenChange(false)}>
        Add {serviceName} {descriptor.connectNoun}
      </ChipModalHeader>
      <ChipModalBody>
        {clientIdField && (
          <ChipModalField
            type='input'
            title={clientIdField.label}
            value={clientId}
            onChange={(value) => {
              setClientId(value)
              if (error) setError(null)
            }}
            placeholder={clientIdField.placeholder}
            autoComplete='off'
            required
            hint={hintFor(clientIdField, trimmedClientId) ?? clientIdField.hint}
          />
        )}

        {clientSecretField && (
          <ChipModalField type='custom' title={clientSecretField.label} required>
            <SecretInput
              value={clientSecret}
              onChange={(value) => {
                setClientSecret(value)
                if (error) setError(null)
              }}
              placeholder={clientSecretField.placeholder}
              name={`${descriptor.providerId}_client_secret`}
              autoComplete='new-password'
              autoCorrect='off'
              autoCapitalize='off'
              data-lpignore='true'
              data-form-type='other'
            />
          </ChipModalField>
        )}

        {orgIdField && (
          <ChipModalField
            type='input'
            title={orgIdField.label}
            value={orgId}
            onChange={(value) => {
              setOrgId(value)
              if (error) setError(null)
            }}
            placeholder={orgIdField.placeholder}
            autoComplete='off'
            required
            // helpText lands here, not on the client secret: every provider's
            // caveat qualifies the org identifier or what the credential can
            // reach (Box's Admin Console authorization, Zoom's Account ID,
            // Salesforce's Run As user), never the secret being pasted. A live
            // format hint still wins, matching the token modal's precedence.
            hint={hintFor(orgIdField, trimmedOrgId) ?? orgIdField.hint ?? descriptor.helpText}
          />
        )}

        {dataCenterField?.options && (
          <ChipModalField
            type='dropdown'
            title={dataCenterField.label}
            value={dataCenter || undefined}
            onChange={(value) => {
              setDataCenter(value)
              if (error) setError(null)
            }}
            options={dataCenterField.options}
            placeholder={dataCenterField.placeholder}
            align='start'
            hint={dataCenterField.hint}
          />
        )}

        <ChipModalField
          type='input'
          title='Display name'
          value={displayName}
          onChange={setDisplayName}
          placeholder={`Defaults to the ${descriptor.serviceLabel} account name`}
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
            onClick: () => openDocs(descriptor.docsUrl),
          },
        ]}
        primaryAction={{
          label: isPending ? 'Adding...' : `Add ${descriptor.connectNoun}`,
          onClick: handleSubmit,
          disabled: isDisabled,
        }}
      />
    </ChipModal>
  )
}
