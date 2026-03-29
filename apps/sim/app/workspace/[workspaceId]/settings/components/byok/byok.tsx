'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Eye, EyeOff, Search } from 'lucide-react'
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
import {
  AnthropicIcon,
  BrandfetchIcon,
  ExaAIIcon,
  FirecrawlIcon,
  GeminiIcon,
  GoogleIcon,
  JinaAIIcon,
  LinkupIcon,
  MistralIcon,
  OpenAIIcon,
  ParallelIcon,
  PerplexityIcon,
  SerperIcon,
} from '@/components/icons'
import { Input } from '@/components/ui'
import { BYOKKeySkeleton } from '@/app/workspace/[workspaceId]/settings/components/byok/byok-skeleton'
import {
  type BYOKKey,
  useBYOKKeys,
  useDeleteBYOKKey,
  useUpsertBYOKKey,
} from '@/hooks/queries/byok-keys'
import type { BYOKProviderId } from '@/tools/types'

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
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    icon: FirecrawlIcon,
    description: 'Web scraping, crawling, search, and extraction',
    placeholder: 'Enter your Firecrawl API key',
  },
  {
    id: 'exa',
    name: 'Exa',
    icon: ExaAIIcon,
    description: 'AI-powered search and research',
    placeholder: 'Enter your Exa API key',
  },
  {
    id: 'serper',
    name: 'Serper',
    icon: SerperIcon,
    description: 'Google search API',
    placeholder: 'Enter your Serper API key',
  },
  {
    id: 'linkup',
    name: 'Linkup',
    icon: LinkupIcon,
    description: 'Web search and content retrieval',
    placeholder: 'Enter your Linkup API key',
  },
  {
    id: 'parallel_ai',
    name: 'Parallel AI',
    icon: ParallelIcon,
    description: 'Web search, extraction, and deep research',
    placeholder: 'Enter your Parallel AI API key',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    icon: PerplexityIcon,
    description: 'AI-powered chat and web search',
    placeholder: 'pplx-...',
  },
  {
    id: 'jina',
    name: 'Jina AI',
    icon: JinaAIIcon,
    description: 'Web reading and search',
    placeholder: 'jina_...',
  },
  {
    id: 'google_cloud',
    name: 'Google Cloud',
    icon: GoogleIcon,
    description: 'Translate, Maps, PageSpeed, and Books APIs',
    placeholder: 'Enter your Google Cloud API key',
  },
  {
    id: 'brandfetch',
    name: 'Brandfetch',
    icon: BrandfetchIcon,
    description: 'Brand assets, logos, colors, and company info',
    placeholder: 'Enter your Brandfetch API key',
  },
]

export function BYOK() {
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''

  const { data, isLoading } = useBYOKKeys(workspaceId)
  const keys = data?.keys ?? []
  const upsertKey = useUpsertBYOKKey()
  const deleteKey = useDeleteBYOKKey()

  const [searchTerm, setSearchTerm] = useState('')
  const [editingProvider, setEditingProvider] = useState<BYOKProviderId | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [deleteConfirmProvider, setDeleteConfirmProvider] = useState<BYOKProviderId | null>(null)

  const filteredProviders = useMemo(() => {
    if (!searchTerm.trim()) return PROVIDERS
    const searchLower = searchTerm.toLowerCase()
    return PROVIDERS.filter(
      (p) =>
        p.name.toLowerCase().includes(searchLower) ||
        p.description.toLowerCase().includes(searchLower)
    )
  }, [searchTerm])

  const showNoResults = searchTerm.trim() && filteredProviders.length === 0

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
      <div className='flex h-full flex-col gap-4.5'>
        <div className='flex items-center gap-2'>
          <div className='flex flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]'>
            <Search
              className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
              strokeWidth={2}
            />
            <Input
              placeholder='Search providers...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={isLoading}
              className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
        </div>

        <p className='text-[var(--text-secondary)] text-sm'>
          Use your own API keys for hosted model providers.
        </p>

        <div className='min-h-0 flex-1 overflow-y-auto'>
          {isLoading ? (
            <div className='flex flex-col gap-2'>
              {PROVIDERS.map((p) => (
                <BYOKKeySkeleton key={p.id} />
              ))}
            </div>
          ) : (
            <div className='flex flex-col gap-2'>
              {filteredProviders.map((provider) => {
                const existingKey = getKeyForProvider(provider.id)
                const Icon = provider.icon

                return (
                  <div key={provider.id} className='flex items-center justify-between gap-3'>
                    <div className='flex items-center gap-3'>
                      <div className='flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--surface-6)]'>
                        <Icon className='h-4 w-4' />
                      </div>
                      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                        <span className='font-medium text-base'>{provider.name}</span>
                        <p className='truncate text-[var(--text-muted)] text-sm'>
                          {provider.description}
                        </p>
                      </div>
                    </div>

                    {existingKey ? (
                      <div className='flex flex-shrink-0 items-center gap-2'>
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
                      <Button variant='primary' onClick={() => openEditModal(provider.id)}>
                        Add Key
                      </Button>
                    )}
                  </div>
                )
              })}
              {showNoResults && (
                <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
                  No providers found matching "{searchTerm}"
                </div>
              )}
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
        <ModalContent size='md'>
          <ModalHeader>
            {editingProvider && (
              <>
                {getKeyForProvider(editingProvider) ? 'Update' : 'Add'}{' '}
                {PROVIDERS.find((p) => p.id === editingProvider)?.name} API Key
              </>
            )}
          </ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              This key will be used for all {PROVIDERS.find((p) => p.id === editingProvider)?.name}{' '}
              requests in this workspace. Your key is encrypted and stored securely.
            </p>

            <div className='mt-4 flex flex-col gap-2'>
              <p className='font-medium text-[var(--text-secondary)] text-sm'>Enter your API key</p>
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
                  className='h-9 pr-9'
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
                <p className='text-[var(--text-error)] text-small leading-tight'>{error}</p>
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
              variant='primary'
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
            <p className='text-[var(--text-secondary)]'>
              Are you sure you want to delete the{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {PROVIDERS.find((p) => p.id === deleteConfirmProvider)?.name}
              </span>{' '}
              API key?{' '}
              <span className='text-[var(--text-error)]'>
                This workspace will revert to using platform hosted keys.
              </span>
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
