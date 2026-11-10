'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  SecretReveal,
} from '@sim/emcn-legacy'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type CreatedApiKey, useCreateApiKey } from '@/hooks/queries/api-keys'

const logger = createLogger('CreateApiKeyModal')

interface CreateApiKeyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingKeyNames: string[]
}

/** Creates a personal Sim API key from the account settings plane. */
export function CreateApiKeyModal({
  open,
  onOpenChange,
  existingKeyNames,
}: CreateApiKeyModalProps) {
  const [keyName, setKeyName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<CreatedApiKey | null>(null)
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const createApiKeyMutation = useCreateApiKey()

  /**
   * The form is reset when the modal OPENS, not when this component mounts: it
   * mounts with its host page and stays mounted across opens. Adjusting during
   * render off the previous `open` rather than in an effect: there is no
   * external system to synchronize with, only a prop transition.
   */
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setKeyName('')
      setCreateError(null)
    }
  }

  const handleCreateKey = async () => {
    const trimmedName = keyName.trim()
    if (!trimmedName || createApiKeyMutation.isPending) return

    const isDuplicate = existingKeyNames.some(
      (name) => name.toLowerCase() === trimmedName.toLowerCase()
    )
    if (isDuplicate) {
      setCreateError(
        `A personal API key named "${trimmedName}" already exists. Please choose a different name.`
      )
      return
    }

    setCreateError(null)
    try {
      const data = await createApiKeyMutation.mutateAsync({
        keyType: 'personal',
        name: trimmedName,
      })

      setNewKey(data.key)
      setShowNewKeyDialog(true)
      onOpenChange(false)
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
            disabled: !keyName.trim() || createApiKeyMutation.isPending,
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
