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
import { useTranslations } from 'next-intl'

const logger = createLogger('CreateApiKeyModal')

interface CreateApiKeyModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  existingKeyNames?: string[]
  allowPersonalApiKeys?: boolean
  canManageWorkspaceKeys?: boolean
  defaultKeyType?: 'personal' | 'workspace'
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
  onKeyCreated,
}: CreateApiKeyModalProps) {
  const t = useTranslations()
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
        <ModalContent size='sm'>
          <ModalHeader>{t('settings.create_api_key.title')}</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              {keyType === 'workspace'
                ? t('settings.create_api_key.description_workspace')
                : t('settings.create_api_key.description_personal')}
            </p>

            <div className='mt-[16px] flex flex-col gap-[16px]'>
              {canManageWorkspaceKeys && (
                <div className='flex flex-col gap-[8px]'>
                  <p className='font-medium text-[13px] text-[var(--text-secondary)]'>
                    {t('settings.create_api_key.key_type')}
                  </p>
                  <ButtonGroup
                    value={keyType}
                    onValueChange={(value) => {
                      setKeyType(value as 'personal' | 'workspace')
                      if (createError) setCreateError(null)
                    }}
                  >
                    <ButtonGroupItem value='personal' disabled={!allowPersonalApiKeys}>
                      {t('settings.create_api_key.personal')}
                    </ButtonGroupItem>
                    <ButtonGroupItem value='workspace'>
                      {t('settings.create_api_key.workspace')}
                    </ButtonGroupItem>
                  </ButtonGroup>
                </div>
              )}
              <div className='flex flex-col gap-[8px]'>
                <p className='font-medium text-[13px] text-[var(--text-secondary)]'>
                  {t('settings.create_api_key.name_label')}
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
                  placeholder={t('settings.create_api_key.placeholders.name')}
                  className='h-9'
                  autoFocus
                  name='api_key_label'
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  data-lpignore='true'
                  data-form-type='other'
                />
                {createError && (
                  <p className='text-[12px] text-[var(--text-error)] leading-tight'>
                    {createError}
                  </p>
                )}
              </div>
            </div>
          </ModalBody>

          <ModalFooter>
            <Button variant='default' onClick={handleClose}>
              {t('settings.create_api_key.cancel')}
            </Button>
            <Button
              type='button'
              variant='tertiary'
              onClick={handleCreateKey}
              disabled={
                !keyName.trim() ||
                createApiKeyMutation.isPending ||
                (keyType === 'workspace' && !canManageWorkspaceKeys)
              }
            >
              {createApiKeyMutation.isPending
                ? t('settings.create_api_key.creating')
                : t('settings.create_api_key.create')}
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
          <ModalHeader>{t('settings.create_api_key.success_title')}</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              {t.rich('settings.create_api_key.success_description', {
                strong: (chunks) => (
                  <span className='font-semibold text-[var(--text-primary)]'>{chunks}</span>
                ),
              })}
            </p>

            {newKey && (
              <div className='relative mt-[10px]'>
                <div className='flex h-9 items-center rounded-[6px] border bg-[var(--surface-1)] px-[10px] pr-[40px]'>
                  <code className='flex-1 truncate font-mono text-[13px] text-[var(--text-primary)]'>
                    {newKey.key}
                  </code>
                </div>
                <Button
                  variant='ghost'
                  className='-translate-y-1/2 absolute top-1/2 right-[4px] h-[28px] w-[28px] rounded-[4px] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  onClick={() => copyToClipboard(newKey.key)}
                >
                  {copySuccess ? (
                    <Check className='h-[14px] w-[14px]' />
                  ) : (
                    <Copy className='h-[14px] w-[14px]' />
                  )}
                  <span className='sr-only'>
                    {t('settings.create_api_key.aria.copy_to_clipboard')}
                  </span>
                </Button>
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  )
}
