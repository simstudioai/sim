'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { Eye, EyeOff } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Input as EmcnInput,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { AnthropicIcon, GeminiIcon, MistralIcon, OpenAIIcon } from '@/components/icons'
import { Skeleton } from '@/components/ui'
import {
  type BYOKKey,
  type BYOKProviderId,
  useBYOKKeys,
  useDeleteBYOKKey,
  useUpsertBYOKKey,
} from '@/hooks/queries/byok-keys'

const logger = createLogger('BYOKSettings')

const PROVIDERS: {
  id: BYOKProviderId
  name: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  placeholder: string
}[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    icon: OpenAIIcon,
    description: 'LLM calls and Knowledge Base embeddings',
    placeholder: 'sk-...',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: AnthropicIcon,
    description: 'LLM calls',
    placeholder: 'sk-ant-...',
  },
  {
    id: 'google',
    name: 'Google',
    icon: GeminiIcon,
    description: 'LLM calls',
    placeholder: 'Enter your API key',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    icon: MistralIcon,
    description: 'LLM calls and Knowledge Base OCR',
    placeholder: 'Enter your API key',
  },
]

function BYOKKeySkeleton() {
  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <div className='flex items-center gap-[12px]'>
        <Skeleton className='h-9 w-9 flex-shrink-0 rounded-[6px]' />
        <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
          <Skeleton className='h-[14px] w-[100px]' />
          <Skeleton className='h-[13px] w-[200px]' />
        </div>
      </div>
      <Skeleton className='h-[32px] w-[72px] rounded-[6px]' />
    </div>
  )
}

export function BYOK() {
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''

  const { data, isLoading } = useBYOKKeys(workspaceId)
  const keys = data?.keys ?? []
  const upsertKey = useUpsertBYOKKey()
  const deleteKey = useDeleteBYOKKey()

  const [editingProvider, setEditingProvider] = useState<BYOKProviderId | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [deleteConfirmProvider, setDeleteConfirmProvider] = useState<BYOKProviderId | null>(null)

  const getKeyForProvider = (providerId: BYOKProviderId): BYOKKey | undefined => {
    return keys.find((k) => k.providerId === providerId)
  }

  const handleSave = async () => {
    if (!editingProvider || !apiKeyInput.trim()) return

    setError(null)
    try {
      await upsertKey.mutateAsync({
        workspaceId,
        providerId: editingProvider,
        apiKey: apiKeyInput.trim(),
      })
      setEditingProvider(null)
      setApiKeyInput('')
      setShowApiKey(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save API key'
      setError(message)
      logger.error('Failed to save BYOK key', { error: err })
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirmProvider) return

    try {
      await deleteKey.mutateAsync({
        workspaceId,
        providerId: deleteConfirmProvider,
      })
      setDeleteConfirmProvider(null)
    } catch (err) {
      logger.error('Failed to delete BYOK key', { error: err })
    }
  }

  const openEditModal = (providerId: BYOKProviderId) => {
    setEditingProvider(providerId)
    setApiKeyInput('')
    setShowApiKey(false)
    setError(null)
  }

  return (
    <>
      <div className='flex h-full flex-col gap-[16px]'>
        <p className='text-[13px] text-[var(--text-secondary)]'>
          Use your own API keys for hosted model providers.
        </p>

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {isLoading ? (
            <div className='flex flex-col gap-[8px]'>
              {PROVIDERS.map((p) => (
                <BYOKKeySkeleton key={p.id} />
              ))}
            </div>
          ) : (
            <div className='flex flex-col gap-[8px]'>
              {PROVIDERS.map((provider) => {
                const existingKey = getKeyForProvider(provider.id)
                const Icon = provider.icon

                return (
                  <div key={provider.id} className='flex items-center justify-between gap-[12px]'>
                    <div className='flex items-center gap-[12px]'>
                      <div className='flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-[var(--surface-6)]'>
                        <Icon className='h-4 w-4' />
                      </div>
                      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                        <span className='font-medium text-[14px]'>{provider.name}</span>
                        <p className='truncate text-[13px] text-[var(--text-muted)]'>
                          {provider.description}
                        </p>
                      </div>
                    </div>

                    {existingKey ? (
                      <div className='flex flex-shrink-0 items-center gap-[8px]'>
                        <Button variant='default' onClick={() => openEditModal(provider.id)}>
                          Update
                        </Button>
                        <Button
                          variant='ghost'
                          onClick={() => setDeleteConfirmProvider(provider.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant='primary'
                        className='!bg-[var(--brand-tertiary-2)] !text-[var(--text-inverse)] hover:!bg-[var(--brand-tertiary-2)]/90'
                        onClick={() => openEditModal(provider.id)}
                      >
                        Add Key
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <Modal
        open={!!editingProvider}
        onOpenChange={(open) => {
          if (!open) {
            setEditingProvider(null)
            setApiKeyInput('')
            setShowApiKey(false)
            setError(null)
          }
        }}
      >
        <ModalContent className='w-[420px]'>
          <ModalHeader>
            {editingProvider && (
              <>
                {getKeyForProvider(editingProvider) ? 'Update' : 'Add'}{' '}
                {PROVIDERS.find((p) => p.id === editingProvider)?.name} API Key
              </>
            )}
          </ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              This key will be used for all {PROVIDERS.find((p) => p.id === editingProvider)?.name}{' '}
              requests in this workspace. Your key is encrypted and stored securely.
            </p>

            <div className='mt-[16px] flex flex-col gap-[8px]'>
              <p className='font-medium text-[13px] text-[var(--text-secondary)]'>
                Enter your API key
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
              <div className='relative'>
                <EmcnInput
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => {
                    setApiKeyInput(e.target.value)
                    if (error) setError(null)
                  }}
                  placeholder={PROVIDERS.find((p) => p.id === editingProvider)?.placeholder}
                  className='h-9 pr-[36px]'
                  autoFocus
                  name='byok_api_key'
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  data-lpignore='true'
                  data-form-type='other'
                />
                <Button
                  variant='ghost'
                  className='-translate-y-1/2 absolute top-1/2 right-[4px] h-[28px] w-[28px] p-0'
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? (
                    <EyeOff className='h-[14px] w-[14px]' />
                  ) : (
                    <Eye className='h-[14px] w-[14px]' />
                  )}
                </Button>
              </div>
              {error && (
                <p className='text-[12px] text-[var(--text-error)] leading-tight'>{error}</p>
              )}
            </div>
          </ModalBody>

          <ModalFooter>
            <Button
              variant='default'
              onClick={() => {
                setEditingProvider(null)
                setApiKeyInput('')
                setShowApiKey(false)
                setError(null)
              }}
            >
              Cancel
            </Button>
            <Button
              variant='tertiary'
              onClick={handleSave}
              disabled={!apiKeyInput.trim() || upsertKey.isPending}
            >
              {upsertKey.isPending ? 'Saving...' : 'Save'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={!!deleteConfirmProvider} onOpenChange={() => setDeleteConfirmProvider(null)}>
        <ModalContent size='sm'>
          <ModalHeader>Delete API Key</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete the{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {PROVIDERS.find((p) => p.id === deleteConfirmProvider)?.name}
              </span>{' '}
              API key? This workspace will revert to using platform hosted keys.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setDeleteConfirmProvider(null)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDelete} disabled={deleteKey.isPending}>
              {deleteKey.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
