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
import {
  isPlaidServiceAccountEnvironment,
  PLAID_SERVICE_ACCOUNT_FORM,
  PLAID_SERVICE_ACCOUNT_REQUIRED_FIELDS,
  type PlaidServiceAccountEnvironment,
  type PlaidServiceAccountFormFieldId,
} from '@/lib/credentials/plaid-service-account-form'
import {
  useCreateWorkspaceCredential,
  useUpdateWorkspaceCredential,
} from '@/hooks/queries/credentials'

const logger = createLogger('PlaidServiceAccountModal')

interface PlaidFormValues {
  environment: PlaidServiceAccountEnvironment | ''
  clientId: string
  clientSecret: string
  accessToken: string
}

const EMPTY_PLAID_FORM_VALUES: PlaidFormValues = {
  environment: '',
  clientId: '',
  clientSecret: '',
  accessToken: '',
}

const PLAID_SECRET_INPUT_NAMES: Partial<Record<PlaidServiceAccountFormFieldId, string>> = {
  clientSecret: 'plaid_client_secret',
  accessToken: 'plaid_item_access_token',
}

function messageForPlaidError(error: unknown): string {
  if (isApiClientError(error) && error.code) {
    const messages = PLAID_SERVICE_ACCOUNT_FORM.errorMessages
    if (Object.hasOwn(messages, error.code)) {
      return messages[error.code as keyof typeof messages]
    }
  }
  return PLAID_SERVICE_ACCOUNT_FORM.fallbackErrorMessage
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
  const [values, setValues] = useState<PlaidFormValues>(EMPTY_PLAID_FORM_VALUES)
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [error, setError] = useState<string | null>(null)

  const createCredential = useCreateWorkspaceCredential()
  const updateCredential = useUpdateWorkspaceCredential()

  useEffect(() => {
    if (open) return
    // Reconnect deliberately restates every secret; stored values are never
    // returned to or prefilled in the browser.
    setValues(EMPTY_PLAID_FORM_VALUES)
    setDisplayName(initialDisplayName ?? '')
    setDescription(initialDescription ?? '')
    setError(null)
  }, [open, initialDisplayName, initialDescription])

  const isPending = createCredential.isPending || updateCredential.isPending
  const isDisabled =
    PLAID_SERVICE_ACCOUNT_REQUIRED_FIELDS.some((field) => !values[field].trim()) || isPending

  const setField = (id: PlaidServiceAccountFormFieldId, value: string) => {
    if (id === 'environment') {
      setValues((current) => ({
        ...current,
        environment: isPlaidServiceAccountEnvironment(value) ? value : '',
      }))
    } else {
      setValues((current) => ({ ...current, [id]: value }))
    }
    if (error) setError(null)
  }

  const handleSubmit = async () => {
    setError(null)
    if (isDisabled || !values.environment) return

    const secretFields = {
      environment: values.environment,
      clientId: values.clientId.trim(),
      clientSecret: values.clientSecret.trim(),
      accessToken: values.accessToken.trim(),
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
          description: description.trim() || null,
        })
        onCreated?.(credentialId)
      } else {
        const created = await createCredential.mutateAsync({
          workspaceId,
          type: 'service_account',
          providerId: PLAID_SERVICE_ACCOUNT_FORM.providerId,
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
      srTitle={`${credentialId ? 'Reconnect' : 'Add'} ${serviceName} ${PLAID_SERVICE_ACCOUNT_FORM.connectNoun}`}
    >
      <ChipModalHeader icon={ServiceIcon} onClose={() => onOpenChange(false)}>
        {credentialId ? 'Reconnect' : 'Add'} {serviceName} {PLAID_SERVICE_ACCOUNT_FORM.connectNoun}
      </ChipModalHeader>
      <ChipModalBody>
        {PLAID_SERVICE_ACCOUNT_FORM.fields.map((field) => {
          const value = values[field.id]

          if (field.options) {
            return (
              <ChipModalField
                key={field.id}
                type='dropdown'
                title={field.label}
                value={value || undefined}
                onChange={(next) => setField(field.id, next)}
                options={[...field.options]}
                placeholder={field.placeholder}
                align='start'
                required
                hint={field.hint}
              />
            )
          }

          if (field.secret) {
            return (
              <ChipModalField
                key={field.id}
                type='custom'
                title={field.label}
                required
                hint={field.hint}
              >
                {(aria) => (
                  <SecretInput
                    {...aria}
                    value={value}
                    onChange={(next) => setField(field.id, next)}
                    placeholder={field.placeholder}
                    name={PLAID_SECRET_INPUT_NAMES[field.id]}
                    autoComplete='new-password'
                    autoCorrect='off'
                    autoCapitalize='off'
                    data-lpignore='true'
                    data-form-type='other'
                  />
                )}
              </ChipModalField>
            )
          }

          return (
            <ChipModalField
              key={field.id}
              type='input'
              title={field.label}
              value={value}
              onChange={(next) => setField(field.id, next)}
              placeholder={field.placeholder}
              autoComplete='off'
              required
              hint={field.hint}
            />
          )
        })}

        <ChipModalField
          type='input'
          title='Display name'
          value={displayName}
          onChange={setDisplayName}
          placeholder={PLAID_SERVICE_ACCOUNT_FORM.displayNamePlaceholder}
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
            onClick: () =>
              window.open(PLAID_SERVICE_ACCOUNT_FORM.docsUrl, '_blank', 'noopener,noreferrer'),
          },
        ]}
        primaryAction={{
          label: isPending
            ? credentialId
              ? 'Reconnecting…'
              : 'Adding…'
            : credentialId
              ? `Reconnect ${PLAID_SERVICE_ACCOUNT_FORM.connectNoun}`
              : `Add ${PLAID_SERVICE_ACCOUNT_FORM.connectNoun}`,
          onClick: handleSubmit,
          disabled: isDisabled,
        }}
      />
    </ChipModal>
  )
}
