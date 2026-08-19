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
import { PLAID_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  useCreateWorkspaceCredential,
  useUpdateWorkspaceCredential,
} from '@/hooks/queries/credentials'

const logger = createLogger('PlaidServiceAccountModal')
const PLAID_DOCS_URL = 'https://docs.sim.ai/integrations/plaid'

type PlaidEnvironment = 'production' | 'sandbox'

const PLAID_ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials:
    "We couldn't authenticate this Plaid Item. Check that the client ID, environment secret, and Item access token all belong to the selected environment.",
  provider_unavailable: "We couldn't reach Plaid to verify this credential. Try again in a moment.",
  duplicate_display_name: 'A credential with that name already exists in this workspace.',
}

const FALLBACK_ERROR_MESSAGE = "We couldn't add this Plaid Item credential. Try again in a moment."

function messageForPlaidError(error: unknown): string {
  if (isApiClientError(error) && error.code && PLAID_ERROR_MESSAGES[error.code]) {
    return PLAID_ERROR_MESSAGES[error.code]
  }
  return FALLBACK_ERROR_MESSAGE
}

interface PlaidServiceAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  serviceName: string
  serviceIcon: ComponentType<{ className?: string }>
  /** When set, reconnect (rotate all secret material on) this credential in place. */
  credentialId?: string
  initialDisplayName?: string
  initialDescription?: string
  onCreated?: (credentialId: string) => void
}

/** Connects one reusable Plaid Item after verifying it with Plaid `/item/get`. */
export function PlaidServiceAccountModal({
  open,
  onOpenChange,
  workspaceId,
  serviceName,
  serviceIcon: ServiceIcon,
  credentialId,
  initialDisplayName,
  initialDescription,
  onCreated,
}: PlaidServiceAccountModalProps) {
  const [environment, setEnvironment] = useState<PlaidEnvironment | ''>('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)

  const createCredential = useCreateWorkspaceCredential()
  const updateCredential = useUpdateWorkspaceCredential()

  useEffect(() => {
    if (open) return
    // Reconnect deliberately restates every secret; stored values are never
    // returned to or prefilled in the browser.
    setEnvironment('')
    setClientId('')
    setClientSecret('')
    setAccessToken('')
    setDisplayName(initialDisplayName ?? '')
    setDescription(initialDescription ?? '')
    setError(null)
  }, [open, initialDisplayName, initialDescription])

  const trimmedClientId = clientId.trim()
  const trimmedClientSecret = clientSecret.trim()
  const trimmedAccessToken = accessToken.trim()
  const isPending = createCredential.isPending || updateCredential.isPending
  const isDisabled =
    !environment || !trimmedClientId || !trimmedClientSecret || !trimmedAccessToken || isPending

  const clearError = () => {
    if (error) setError(null)
  }

  const handleSubmit = async () => {
    setError(null)
    if (isDisabled || !environment) return

    const secretFields = {
      environment,
      clientId: trimmedClientId,
      clientSecret: trimmedClientSecret,
      accessToken: trimmedAccessToken,
    }
    const trimmedDisplayName = displayName.trim()
    // On reconnect, omit an untouched name so the server can update a
    // provider-derived label if the replacement token belongs to another Item.
    // A deliberately edited name remains authoritative.
    const submittedDisplayName =
      !credentialId || trimmedDisplayName !== (initialDisplayName ?? '').trim()
        ? trimmedDisplayName || undefined
        : undefined
    try {
      if (credentialId) {
        await updateCredential.mutateAsync({
          credentialId,
          ...secretFields,
          displayName: submittedDisplayName,
          description: description.trim() || undefined,
        })
        onCreated?.(credentialId)
      } else {
        const created = await createCredential.mutateAsync({
          workspaceId,
          type: 'service_account',
          providerId: PLAID_SERVICE_ACCOUNT_PROVIDER_ID,
          ...secretFields,
          displayName: submittedDisplayName,
          description: description.trim() || undefined,
        })
        onCreated?.(created.credential.id)
      }
      onOpenChange(false)
    } catch (caught: unknown) {
      setError(messageForPlaidError(caught))
      logger.error('Failed to add Plaid Item credential', caught)
    }
  }

  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      srTitle={`${credentialId ? 'Reconnect' : 'Add'} ${serviceName} Item credential`}
    >
      <ChipModalHeader icon={ServiceIcon} onClose={() => onOpenChange(false)}>
        {credentialId ? 'Reconnect' : 'Add'} {serviceName} Item credential
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='dropdown'
          title='Environment'
          value={environment || undefined}
          onChange={(value) => {
            setEnvironment(value as PlaidEnvironment)
            clearError()
          }}
          options={[
            { value: 'production', label: 'Production' },
            { value: 'sandbox', label: 'Sandbox' },
          ]}
          placeholder='Select the Plaid environment'
          align='start'
          required
          hint='Use the environment that issued both the secret and Item access token.'
        />

        <ChipModalField
          type='input'
          title='Client ID'
          value={clientId}
          onChange={(value) => {
            setClientId(value)
            clearError()
          }}
          placeholder='Paste your Plaid client ID'
          autoComplete='off'
          required
        />

        <ChipModalField
          type='custom'
          title='Secret'
          required
          hint='Paste the secret for the selected environment.'
        >
          {(aria) => (
            <SecretInput
              {...aria}
              value={clientSecret}
              onChange={(value) => {
                setClientSecret(value)
                clearError()
              }}
              placeholder='Paste your Plaid secret'
              name='plaid_client_secret'
              autoComplete='new-password'
              autoCorrect='off'
              autoCapitalize='off'
              data-lpignore='true'
              data-form-type='other'
            />
          )}
        </ChipModalField>

        <ChipModalField
          type='custom'
          title='Item access token'
          required
          hint='This long-lived token is specific to one linked Plaid Item.'
        >
          {(aria) => (
            <SecretInput
              {...aria}
              value={accessToken}
              onChange={(value) => {
                setAccessToken(value)
                clearError()
              }}
              placeholder='access-production-… or access-sandbox-…'
              name='plaid_item_access_token'
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
          title='Display name'
          value={displayName}
          onChange={setDisplayName}
          placeholder='Defaults to the verified Plaid Item ID'
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
            onClick: () => window.open(PLAID_DOCS_URL, '_blank', 'noopener,noreferrer'),
          },
        ]}
        primaryAction={{
          label: isPending
            ? credentialId
              ? 'Reconnecting…'
              : 'Adding…'
            : credentialId
              ? 'Reconnect Item credential'
              : 'Add Item credential',
          onClick: handleSubmit,
          disabled: isDisabled,
        }}
      />
    </ChipModal>
  )
}
