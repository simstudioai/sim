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
  workspaceId?: string
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

  /**
   * The form is seeded when the modal OPENS, not when this component mounts.
   *
   * It mounts with its host page, and on the settings page `defaultKeyType` is
   * computed from a permission-group policy that is still loading at that
   * moment — so it starts as the fail-closed `'workspace'` and only becomes
   * `'personal'` once the query answers. Seeding once at mount left a non-admin
   * holding `'workspace'`, which they may not create, with no type selector
   * rendered to change it and Create permanently disabled.
   *
   * Adjusting during render off the previous `open` rather than in an effect:
   * there is no external system to synchronize with, only a prop transition.
   */
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setKeyName('')
      setKeyType(defaultKeyType)
      setCreateError(null)
    }
  }

  const canCreateKeyType =
    keyType === 'personal' ? allowPersonalApiKeys : canManageWorkspaceKeys && Boolean(workspaceId)

  const handleCreateKey = async () => {
    const trimmedName = keyName.trim()
    if (!trimmedName || !canCreateKeyType || createApiKeyMutation.isPending) return

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
      if (keyType === 'workspace' && !workspaceId) return
      const data = await createApiKeyMutation.mutateAsync(
        keyType === 'workspace' && workspaceId
          ? {
              workspaceId,
              name: trimmedName,
              keyType,
              source,
            }
          : { keyType: 'personal', name: trimmedName, source }
      )

      setNewKey(data.key)
      setShowNewKeyDialog(true)
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
    if (!createApiKeyMutation.isPending) onOpenChange(false)
  }

  return (
    <>
      <ChipModal
        open={open}
        onOpenChange={(nextOpen) => {
          if (!createApiKeyMutation.isPending) onOpenChange(nextOpen)
        }}
        dismissDisabled={createApiKeyMutation.isPending}
        srTitle='Create new API key'
      >
        <ChipModalHeader onClose={handleClose}>Create new API key</ChipModalHeader>
        <ChipModalBody>
          {canManageWorkspaceKeys && (
            <ChipModalField type='custom' title='Key type'>
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
            title='Name'
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
            className='-left-[9999px] pointer-events-none absolute opacity-0'
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
            disabled: !keyName.trim() || createApiKeyMutation.isPending || !canCreateKeyType,
          }}
        />
      </ChipModal>

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
