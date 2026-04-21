'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { Check, Copy } from 'lucide-react'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Input as EmcnInput,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { type ApiKey, useCreateApiKey } from '@/hooks/queries/api-keys'

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
  onKeyCreated?: (key: ApiKey) => void
}

/**
 * Reusable modal for creating API keys.
 * Used in both the API keys settings page and the deploy modal.
 */
export function CreateApiKeyModal({
  open,
  onOpenChange,
  workspaceId,
  existingKeyNames = [],
  allowPersonalApiKeys = true,
  canManageWorkspaceKeys = false,
  defaultKeyType = 'personal',
  source = 'settings',
  onKeyCreated,
}: CreateApiKeyModalProps) {
  const [keyName, setKeyName] = useState('')
  const [keyType, setKeyType] = useState<'personal' | 'workspace'>(defaultKeyType)
  const [createError, setCreateError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<ApiKey | null>(null)
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)

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
          ? `A workspace Sim key named "${trimmedName}" already exists. Please choose a different name.`
          : `A personal Sim key named "${trimmedName}" already exists. Please choose a different name.`
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
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to create Sim key. Please try again.'
      if (errorMessage.toLowerCase().includes('already exists')) {
        setCreateError(errorMessage)
      } else {
        setCreateError('Failed to create Sim key. Please check your connection and try again.')
      }
    }
  }

  const handleClose = () => {
    onOpenChange(false)
    setKeyName('')
    setKeyType(defaultKeyType)
    setCreateError(null)
  }

  const copyToClipboard = (key: string) => {
    navigator.clipboard.writeText(key)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

  return (
    <>
      {/* Create API Key Dialog */}
      <Modal open={open} onOpenChange={onOpenChange}>
        <ModalContent size='md'>
          <ModalHeader>Create new Sim key</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              {keyType === 'workspace'
                ? "This key will have access to all workflows in this workspace. Make sure to copy it after creation as you won't be able to see it again."
                : "This key will have access to your personal workflows. Make sure to copy it after creation as you won't be able to see it again."}
            </p>

            <div className='mt-4 flex flex-col gap-4.5'>
              {canManageWorkspaceKeys && (
                <div className='flex flex-col gap-2'>
                  <p className='font-medium text-[var(--text-secondary)] text-sm'>Sim Key Type</p>
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
                </div>
              )}
              <div className='flex flex-col gap-2'>
                <p className='font-medium text-[var(--text-secondary)] text-sm'>
                  Enter a name for your Sim key to help you identify it later.
                </p>
                {/* Hidden decoy fields to prevent browser autofill */}
                <input
                  type='text'
                  name='fakeusernameremembered'
                  autoComplete='username'
                  style={{
                    position: 'absolute',
                    left: '-9999px',
                    opacity: 0,
                    pointerEvents: 'none',
                  }}
                  tabIndex={-1}
                  readOnly
                />
                <EmcnInput
                  value={keyName}
                  onChange={(e) => {
                    setKeyName(e.target.value)
                    if (createError) setCreateError(null)
                  }}
                  placeholder='e.g., Development, Production'
                  className='h-9'
                  name='api_key_label'
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  data-lpignore='true'
                  data-form-type='other'
                />
                {createError && (
                  <p className='text-[var(--text-error)] text-small leading-tight'>{createError}</p>
                )}
              </div>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button variant='default' onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type='button'
              variant='primary'
              onClick={handleCreateKey}
              disabled={
                !keyName.trim() ||
                createApiKeyMutation.isPending ||
                (keyType === 'workspace' && !canManageWorkspaceKeys)
              }
            >
              {createApiKeyMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* New API Key Dialog - shows the created key */}
      <Modal
        open={showNewKeyDialog}
        onOpenChange={(dialogOpen: boolean) => {
          setShowNewKeyDialog(dialogOpen)
          if (!dialogOpen) {
            setNewKey(null)
            setCopySuccess(false)
          }
        }}
      >
        <ModalContent size='sm'>
          <ModalHeader>Your Sim key has been created</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              This is the only time you will see your Sim key.{' '}
              <span className='font-semibold text-[var(--text-primary)]'>
                Copy it now and store it securely.
              </span>
            </p>

            {newKey && (
              <div className='relative mt-2.5'>
                <div className='flex h-9 items-center rounded-md border bg-[var(--surface-1)] px-2.5 pr-10'>
                  <code className='flex-1 truncate font-mono text-[var(--text-primary)] text-sm'>
                    {newKey.key}
                  </code>
                </div>
                <Button
                  variant='ghost'
                  className='-translate-y-1/2 absolute top-1/2 right-[4px] h-[28px] w-[28px] rounded-sm text-[var(--text-muted)] hover-hover:text-[var(--text-primary)]'
                  onClick={() => copyToClipboard(newKey.key)}
                >
                  {copySuccess ? (
                    <Check className='h-[14px] w-[14px]' />
                  ) : (
                    <Copy className='h-[14px] w-[14px]' />
                  )}
                  <span className='sr-only'>Copy to clipboard</span>
                </Button>
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  )
}
