'use client'

import { useState } from 'react'
import { FieldFrame, SelectField, TextField } from '@sim/emcn/field'
import { AutofillDecoys } from '@sim/emcn/field/autofill-decoys'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { getErrorMessage } from '@sim/utils/errors'
import {
  type ApiKeyAccessLevel,
  type CreatedApiKey,
  createLogger,
  DAY_MS,
  useCreateApiKey,
  useReadOnlyApiKeysEnabled,
} from '@/platform/lib/data/api-keys'

const logger = createLogger('CreateApiKeyModal')

type KeyType = 'personal' | 'workspace'

const EXPIRY_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: 'never', label: 'Never' },
] as const

type ExpiryOption = (typeof EXPIRY_OPTIONS)[number]['value']

function expiresAtFor(expiry: ExpiryOption): string | null {
  return expiry === 'never' ? null : new Date(Date.now() + Number(expiry) * DAY_MS).toISOString()
}

interface CreateApiKeyModalProps {
  workspaceId: string
  existingKeyNames: readonly string[]
  allowPersonalApiKeys: boolean
  canManageWorkspaceKeys: boolean
  defaultKeyType: KeyType
  /** Where the key was created, for the audit record: the deploy dialog unless a Settings page says so. */
  source?: 'settings' | 'deploy_modal'
  /** For a key created to run workflows: hides the access choice and always issues full access. */
  fullAccessOnly?: boolean
  onClose: () => void
}

/**
 * A new personal or workspace API key. The key is shown once, masked until
 * revealed, with a copy action; it cannot be read again after the dialog closes.
 */
export function CreateApiKeyModal({
  workspaceId,
  existingKeyNames,
  allowPersonalApiKeys,
  canManageWorkspaceKeys,
  defaultKeyType,
  source = 'deploy_modal',
  fullAccessOnly = false,
  onClose,
}: CreateApiKeyModalProps) {
  const createApiKey = useCreateApiKey()
  const [name, setName] = useState('')
  const [keyType, setKeyType] = useState<KeyType>(defaultKeyType)
  const [access, setAccess] = useState<ApiKeyAccessLevel>('write')
  const [expiry, setExpiry] = useState<ExpiryOption>('never')
  const canChooseAccess = useReadOnlyApiKeysEnabled() && !fullAccessOnly
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const canCreate =
    keyType === 'personal' ? allowPersonalApiKeys : canManageWorkspaceKeys && Boolean(workspaceId)

  const create = async () => {
    const trimmed = name.trim()
    if (!trimmed || !canCreate) return false
    if (existingKeyNames.some((existing) => existing.toLowerCase() === trimmed.toLowerCase()))
      throw new Error(
        `A ${keyType} API key named "${trimmed}" already exists. Please choose a different name.`
      )
    try {
      const settings = {
        name: trimmed,
        source,
        access: canChooseAccess ? access : 'write',
        expiresAt: expiresAtFor(expiry),
      } as const
      const data = await createApiKey.mutateAsync(
        keyType === 'workspace'
          ? { ...settings, workspaceId, keyType }
          : { ...settings, keyType: 'personal' }
      )
      setCreated(data.key)
      return false
    } catch (error) {
      logger.error('API key creation failed', { error })
      const message = getErrorMessage(error, 'Failed to create API key. Please try again.')
      throw new Error(
        message.toLowerCase().includes('already exists')
          ? message
          : 'Failed to create API key. Please check your connection and try again.'
      )
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={created ? 'Your API key has been created' : 'Create new API key'}
      confirmLabel={created ? 'Done' : createApiKey.isPending ? 'Creating…' : 'Create API key'}
      confirmDisabled={!created && (!name.trim() || !canCreate)}
      cancelLabel={created ? 'Close' : undefined}
      onConfirm={created ? undefined : create}
    >
      {created ? (
        <SecretField
          label='API key'
          placeholder='API key'
          value={created.key}
          hint="Copy it now. It won't be shown again."
          readOnly
          copyable
        />
      ) : (
        <>
          {canManageWorkspaceKeys && (
            <FieldFrame label='Key type'>
              <SegmentedControl
                label='Key type'
                options={[
                  { value: 'personal', label: 'Personal', disabled: !allowPersonalApiKeys },
                  { value: 'workspace', label: 'Workspace' },
                ]}
                value={keyType}
                onSelect={setKeyType}
              />
            </FieldFrame>
          )}
          <TextField
            label='Name'
            placeholder='e.g., Development, Production'
            value={name}
            onChange={setName}
            autoComplete='off'
            required
          />
          {canChooseAccess && (
            <FieldFrame label='Access'>
              <SegmentedControl
                label='Access'
                options={[
                  { value: 'write', label: 'Full access' },
                  { value: 'read', label: 'Read only' },
                ]}
                value={access}
                onSelect={setAccess}
              />
            </FieldFrame>
          )}
          <SelectField
            label='Expires'
            options={EXPIRY_OPTIONS}
            value={expiry}
            onValueChange={setExpiry}
          />
          <AutofillDecoys />
        </>
      )}
    </Modal>
  )
}
