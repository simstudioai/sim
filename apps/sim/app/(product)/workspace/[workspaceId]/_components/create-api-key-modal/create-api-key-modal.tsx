'use client'

import { useState } from 'react'
import { FieldFrame, TextField } from '@sim/emcn/field'
import { AutofillDecoys } from '@sim/emcn/field/autofill-decoys'
import { SecretField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { getErrorMessage } from '@sim/utils/errors'
import { type CreatedApiKey, createLogger, useCreateApiKey } from '@/platform/lib/data/api-keys'

const logger = createLogger('CreateApiKeyModal')

type KeyType = 'personal' | 'workspace'

interface CreateApiKeyModalProps {
  workspaceId: string
  existingKeyNames: readonly string[]
  allowPersonalApiKeys: boolean
  canManageWorkspaceKeys: boolean
  defaultKeyType: KeyType
  /** Where the key was created, for the audit record: the deploy dialog unless a Settings page says so. */
  source?: 'settings' | 'deploy_modal'
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
  onClose,
}: CreateApiKeyModalProps) {
  const createApiKey = useCreateApiKey()
  const [name, setName] = useState('')
  const [keyType, setKeyType] = useState<KeyType>(defaultKeyType)
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
      const data = await createApiKey.mutateAsync(
        keyType === 'workspace'
          ? { workspaceId, name: trimmed, keyType, source }
          : { keyType: 'personal', name: trimmed, source }
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
          <AutofillDecoys />
        </>
      )}
    </Modal>
  )
}
