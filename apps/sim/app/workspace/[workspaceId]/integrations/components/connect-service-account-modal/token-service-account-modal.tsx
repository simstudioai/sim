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
  TokenServiceAccountDescriptor,
  TokenServiceAccountField,
} from '@/lib/credentials/token-service-accounts/descriptors'
import {
  useCreateWorkspaceCredential,
  useUpdateWorkspaceCredential,
} from '@/hooks/queries/credentials'

const logger = createLogger('TokenServiceAccountModal')

const FALLBACK_ERROR_MESSAGE = "We couldn't add this credential. Try again in a moment."

/**
 * Maps server `error.code` values from token service-account verification to
 * user-facing messages, personalized with the provider's own token noun.
 */
function messageForTokenAccountError(
  err: unknown,
  descriptor: TokenServiceAccountDescriptor
): string {
  if (isApiClientError(err) && err.code) {
    switch (err.code) {
      case 'invalid_credentials':
        return `We couldn't authenticate with that ${descriptor.tokenNoun}. Double-check it in ${descriptor.serviceLabel} and try again.`
      case 'site_not_found':
        return "We couldn't find an account at that domain. Check the spelling and try again."
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

function normalizeDomainInput(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/?#].*$/, '')
}

function openDocs(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

interface TokenServiceAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  descriptor: TokenServiceAccountDescriptor
  serviceName: string
  serviceIcon: ComponentType<{ className?: string }>
  /** When set, reconnect (rotate the secret on) this credential in place. */
  credentialId?: string
  initialDisplayName?: string
  initialDescription?: string
  /** Called with the new credential id after a successful create (not reconnect). */
  onCreated?: (credentialId: string) => void
}

/**
 * Generic connect modal for token-paste service accounts. Renders the fields
 * declared by the provider's {@link TokenServiceAccountDescriptor} (a secret
 * token, plus a domain for providers that need one) and submits through the
 * same create/update credential mutations as the other service-account modals.
 * Server-side verification failures are mapped from the route's `error.code`.
 */
export function TokenServiceAccountModal({
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
}: TokenServiceAccountModalProps) {
  const [apiToken, setApiToken] = useState('')
  const [domain, setDomain] = useState('')
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)

  const createCredential = useCreateWorkspaceCredential()
  const updateCredential = useUpdateWorkspaceCredential()

  useEffect(() => {
    if (open) return
    setApiToken('')
    setDomain('')
    setDisplayName(initialDisplayName ?? '')
    setDescription(initialDescription ?? '')
    setError(null)
  }, [open, initialDisplayName, initialDescription])

  const tokenField = descriptor.fields.find((field) => field.id === 'apiToken')
  const domainField = descriptor.fields.find((field) => field.id === 'domain')

  const trimmedToken = apiToken.trim()
  const normalizedDomain = normalizeDomainInput(domain)
  const isPending = createCredential.isPending || updateCredential.isPending
  const isDisabled = !trimmedToken || (Boolean(domainField) && !normalizedDomain) || isPending

  const hintFor = (field: TokenServiceAccountField, value: string): string | undefined => {
    if (!field.hintPattern || !field.hintMessage || value.length === 0) return undefined
    return field.hintPattern.test(value) ? undefined : field.hintMessage
  }

  const handleSubmit = async () => {
    setError(null)
    if (isDisabled) return
    try {
      const secretFields = {
        apiToken: trimmedToken,
        ...(domainField ? { domain: normalizedDomain } : {}),
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
        onCreated?.(created.credential.id)
      }
      onOpenChange(false)
    } catch (err: unknown) {
      setError(messageForTokenAccountError(err, descriptor))
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
        {tokenField && (
          <ChipModalField
            type='custom'
            title={tokenField.label}
            required
            hint={hintFor(tokenField, trimmedToken) ?? descriptor.helpText}
          >
            <SecretInput
              value={apiToken}
              onChange={(value) => {
                setApiToken(value)
                if (error) setError(null)
              }}
              placeholder={tokenField.placeholder}
              name={`${descriptor.providerId}_api_token`}
              autoComplete='new-password'
              autoCorrect='off'
              autoCapitalize='off'
              data-lpignore='true'
              data-form-type='other'
            />
          </ChipModalField>
        )}

        {domainField && (
          <ChipModalField
            type='input'
            title={domainField.label}
            value={domain}
            onChange={(value) => {
              setDomain(value)
              if (error) setError(null)
            }}
            placeholder={domainField.placeholder}
            autoComplete='off'
            required
            error={hintFor(domainField, normalizedDomain)}
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
