'use client'

import { useState } from 'react'
import {
  ButtonGroup,
  ButtonGroupItem,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  SecretReveal,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type CreatedApiKey, useCreateApiKey } from '@/hooks/queries/api-keys'

const logger = createLogger('CreateApiKeyModal')

interface CreateApiKeyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  existingKeyNames?: string[]
  allowPersonalApiKeys?: boolean
  canManageWorkspaceKeys?: boolean
  defaultKeyType?: 'personal' | 'workspace'
  source?: 'settings' | 'deploy_modal'
  onKeyCreated?: (key: CreatedApiKey) => void
}

const EMPTY_KEY_NAMES: string[] = []

/**
 * Reusable modal for creating API keys.
 * Used in both the API keys settings page and the deploy modal.
 */
export function CreateApiKeyModal({
  open,
  onOpenChange,
  workspaceId,
  existingKeyNames = EMPTY_KEY_NAMES,
  allowPersonalApiKeys = true,
  canManageWorkspaceKeys = false,
  defaultKeyType = 'personal',
  source = 'settings',
  onKeyCreated,
}: CreateApiKeyModalProps) {
  const [keyName, setKeyName] = useState('')
  const [keyType, setKeyType] = useState<'personal' | 'workspace'>(defaultKeyType)
  const [createError, setCreateError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<CreatedApiKey | null>(null)
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const createApiKeyMutation = useCreateApiKey()

  const handleCreateKey = async () => {
    const trimmedName = keyName.trim()
    if (!trimmedName) return

    const isDuplicate = existingKeyNames.some(
      (name) => name.toLowerCase() === trimmedName.toLowerCase()
    )
    if (isDuplicate) {
      setCreateError(
        keyType === 'workspace'
          ? `A workspace API key named "${trimmedName}" already exists. Please choose a different name.`
          : `A personal API key named "${trimmedName}" already exists. Please choose a different name.`
      )
      return
    }

    setCreateError(null)
    try {
      const data = await createApiKeyMutation.mutateAsync({
        workspaceId,
        name: trimmedName,
        keyType,
        source,
      })

      setNewKey(data.key)
      setShowNewKeyDialog(true)
      setKeyName('')
      setKeyType(defaultKeyType)
      setCreateError(null)
      onOpenChange(false)
      onKeyCreated?.(data.key)
    } catch (error: unknown) {
      logger.error('API key creation failed:', { error })
      const errorMessage = getErrorMessage(error, 'Failed to create API key. Please try again.')
      if (errorMessage.toLowerCase().includes('already exists')) {
        setCreateError(errorMessage)
      } else {
        setCreateError('Failed to create API key. Please check your connection and try again.')
      }
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    setKeyName('')
    setKeyType(defaultKeyType)
    setCreateError(null)
  }

  return (
    <>
      {/* Create API Key Dialog */}
      <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Create new API key'>
        <ChipModalHeader onClose={handleClose}>Create new API key</ChipModalHeader>
        <ChipModalBody>
          {canManageWorkspaceKeys && (
            <ChipModalField type='custom' title='API Key Type'>
              <ButtonGroup
                value={keyType}
                onValueChange={(value) => {
                  setKeyType(value as 'personal' | 'workspace')
                  if (createError) setCreateError(null)
                }}
              >
                <ButtonGroupItem value='personal' disabled={!allowPersonalApiKeys}>
                  Personal
                </ButtonGroupItem>
                <ButtonGroupItem value='workspace'>Workspace</ButtonGroupItem>
              </ButtonGroup>
            </ChipModalField>
          )}
          <ChipModalField
            type='input'
            title='Enter a name for your API key to help you identify it later.'
            value={keyName}
            onChange={(value) => {
              setKeyName(value)
              if (createError) setCreateError(null)
            }}
            placeholder='e.g., Development, Production'
            autoComplete='off'
            required
          />
          {/* Hidden decoy fields to prevent browser autofill */}
          <input
            type='text'
            name='fakeusernameremembered'
            autoComplete='username'
            aria-hidden='true'
            style={{
              position: 'absolute',
              left: '-9999px',
              opacity: 0,
              pointerEvents: 'none',
            }}
            tabIndex={-1}
            readOnly
          />
          <ChipModalError>{createError}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={handleClose}
          primaryAction={{
            label: createApiKeyMutation.isPending ? 'Creating...' : 'Create',
            onClick: handleCreateKey,
            disabled:
              !keyName.trim() ||
              createApiKeyMutation.isPending ||
              (keyType === 'workspace' && !canManageWorkspaceKeys),
          }}
        />
      </ChipModal>

      {/* New API Key Dialog - shows the created key */}
      <ChipModal
        open={showNewKeyDialog}
        onOpenChange={(dialogOpen: boolean) => {
          setShowNewKeyDialog(dialogOpen)
          if (!dialogOpen) {
            setNewKey(null)
          }
        }}
        srTitle='Your API key has been created'
      >
        <ChipModalHeader onClose={() => setShowNewKeyDialog(false)}>
          Your API key has been created
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalField type='custom' title="Copy it now — it won't be shown again">
            {newKey && <SecretReveal value={newKey.key} />}
          </ChipModalField>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setShowNewKeyDialog(false)}
          primaryAction={{ label: 'Done', onClick: () => setShowNewKeyDialog(false) }}
        />
      </ChipModal>
    </>
  )
}
