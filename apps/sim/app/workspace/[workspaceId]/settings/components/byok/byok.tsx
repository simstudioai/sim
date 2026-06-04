'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { Eye, EyeOff } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  ChevronDown,
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input as EmcnInput,
  SearchInput,
} from '@/components/emcn'
import {
  AnthropicIcon,
  BasetenIcon,
  BrandfetchIcon,
  ExaAIIcon,
  FindymailIcon,
  FirecrawlIcon,
  FireworksIcon,
  GeminiIcon,
  GoogleIcon,
  HunterIOIcon,
  ImageIcon,
  JinaAIIcon,
  LinkupIcon,
  MistralIcon,
  OllamaIcon,
  OpenAIIcon,
  ParallelIcon,
  PeopleDataLabsIcon,
  PerplexityIcon,
  ProspeoIcon,
  SerperIcon,
  TogetherIcon,
  WizaIcon,
} from '@/components/icons'
import {
  type BYOKKey,
  useBYOKKeys,
  useDeleteBYOKKey,
  useUpsertBYOKKey,
} from '@/hooks/queries/byok-keys'
import type { BYOKProviderId } from '@/tools/types'

const logger = createLogger('BYOKSettings')

const ALL_CATEGORY = 'All'

const PROVIDER_CATEGORIES = [
  { id: 'models', label: 'Models' },
  { id: 'search', label: 'Search & Web' },
  { id: 'enrichment', label: 'Data & Enrichment' },
  { id: 'media', label: 'Media' },
] as const

type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number]['id']

const PROVIDERS: {
  id: BYOKProviderId
  name: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  placeholder: string
  category: ProviderCategory
}[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    icon: OpenAIIcon,
    description: 'LLM calls and Knowledge Base embeddings',
    placeholder: 'sk-...',
    category: 'models',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: AnthropicIcon,
    description: 'LLM calls',
    placeholder: 'sk-ant-...',
    category: 'models',
  },
  {
    id: 'google',
    name: 'Google',
    icon: GeminiIcon,
    description: 'LLM calls',
    placeholder: 'Enter your API key',
    category: 'models',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    icon: MistralIcon,
    description: 'LLM calls and Knowledge Base OCR',
    placeholder: 'Enter your API key',
    category: 'models',
  },
  {
    id: 'fireworks',
    name: 'Fireworks',
    icon: FireworksIcon,
    description: 'LLM calls',
    placeholder: 'Enter your Fireworks API key',
    category: 'models',
  },
  {
    id: 'together',
    name: 'Together AI',
    icon: TogetherIcon,
    description: 'LLM calls',
    placeholder: 'Enter your Together AI API key',
    category: 'models',
  },
  {
    id: 'baseten',
    name: 'Baseten',
    icon: BasetenIcon,
    description: 'LLM calls',
    placeholder: 'Enter your Baseten API key',
    category: 'models',
  },
  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    icon: OllamaIcon,
    description: 'LLM calls',
    placeholder: 'Enter your Ollama API key',
    category: 'models',
  },
  {
    id: 'falai',
    name: 'Fal.ai',
    icon: ImageIcon,
    description: 'Image and video generation',
    placeholder: 'Enter your Fal.ai API key',
    category: 'media',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    icon: FirecrawlIcon,
    description: 'Web scraping, crawling, search, and extraction',
    placeholder: 'Enter your Firecrawl API key',
    category: 'search',
  },
  {
    id: 'exa',
    name: 'Exa',
    icon: ExaAIIcon,
    description: 'AI-powered search and research',
    placeholder: 'Enter your Exa API key',
    category: 'search',
  },
  {
    id: 'serper',
    name: 'Serper',
    icon: SerperIcon,
    description: 'Google search API',
    placeholder: 'Enter your Serper API key',
    category: 'search',
  },
  {
    id: 'linkup',
    name: 'Linkup',
    icon: LinkupIcon,
    description: 'Web search and content retrieval',
    placeholder: 'Enter your Linkup API key',
    category: 'search',
  },
  {
    id: 'parallel_ai',
    name: 'Parallel AI',
    icon: ParallelIcon,
    description: 'Web search, extraction, and deep research',
    placeholder: 'Enter your Parallel AI API key',
    category: 'search',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    icon: PerplexityIcon,
    description: 'AI-powered chat and web search',
    placeholder: 'pplx-...',
    category: 'search',
  },
  {
    id: 'jina',
    name: 'Jina AI',
    icon: JinaAIIcon,
    description: 'Web reading and search',
    placeholder: 'jina_...',
    category: 'search',
  },
  {
    id: 'google_cloud',
    name: 'Google Cloud',
    icon: GoogleIcon,
    description: 'Translate, Maps, PageSpeed, and Books APIs',
    placeholder: 'Enter your Google Cloud API key',
    category: 'enrichment',
  },
  {
    id: 'brandfetch',
    name: 'Brandfetch',
    icon: BrandfetchIcon,
    description: 'Brand assets, logos, colors, and company info',
    placeholder: 'Enter your Brandfetch API key',
    category: 'enrichment',
  },
  {
    id: 'hunter',
    name: 'Hunter',
    icon: HunterIOIcon,
    description: 'Email finder, verification, and domain search',
    placeholder: 'Enter your Hunter.io API key',
    category: 'enrichment',
  },
  {
    id: 'peopledatalabs',
    name: 'People Data Labs',
    icon: PeopleDataLabsIcon,
    description: 'Person and company enrichment, search, and identity',
    placeholder: 'Enter your People Data Labs API key',
    category: 'enrichment',
  },
  {
    id: 'findymail',
    name: 'Findymail',
    icon: FindymailIcon,
    description: 'Email finder, verification, and phone lookup',
    placeholder: 'Enter your Findymail API key',
    category: 'enrichment',
  },
  {
    id: 'prospeo',
    name: 'Prospeo',
    icon: ProspeoIcon,
    description: 'Person and company enrichment and search',
    placeholder: 'Enter your Prospeo API key',
    category: 'enrichment',
  },
  {
    id: 'wiza',
    name: 'Wiza',
    icon: WizaIcon,
    description: 'Prospect search, individual reveal, and company enrichment',
    placeholder: 'Enter your Wiza API key',
    category: 'enrichment',
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
  const [selectedCategory, setSelectedCategory] = useState<ProviderCategory | typeof ALL_CATEGORY>(
    ALL_CATEGORY
  )
  const [editingProvider, setEditingProvider] = useState<BYOKProviderId | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [deleteConfirmProvider, setDeleteConfirmProvider] = useState<BYOKProviderId | null>(null)

  const filteredSections = useMemo(() => {
    const searchLower = searchTerm.trim().toLowerCase()
    const matchesSearch = (p: (typeof PROVIDERS)[number]) =>
      !searchLower ||
      p.name.toLowerCase().includes(searchLower) ||
      p.description.toLowerCase().includes(searchLower)

    return PROVIDER_CATEGORIES.filter(
      (category) => selectedCategory === ALL_CATEGORY || category.id === selectedCategory
    )
      .map((category) => ({
        label: category.label,
        providers: PROVIDERS.filter((p) => p.category === category.id).filter(matchesSearch),
      }))
      .filter((section) => section.providers.length > 0)
  }, [searchTerm, selectedCategory])

  const selectedCategoryLabel =
    selectedCategory === ALL_CATEGORY
      ? ALL_CATEGORY
      : (PROVIDER_CATEGORIES.find((c) => c.id === selectedCategory)?.label ?? ALL_CATEGORY)

  const showNoResults = filteredSections.length === 0

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
      const message = getErrorMessage(err, 'Failed to save API key')
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
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex max-w-[48rem] flex-col gap-4.5 pt-6 pb-6'>
          <div className='flex items-center gap-2'>
            <SearchInput
              className='flex-1'
              placeholder='Search providers...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              disabled={isLoading}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type='button' className={chipVariants({ variant: 'filled', flush: true })}>
                  <span className='text-[var(--text-body)]'>{selectedCategoryLabel}</span>
                  <ChevronDown className='h-[7px] w-[9px] text-[var(--text-icon)]' />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='min-w-[160px]'>
                <DropdownMenuItem onSelect={() => setSelectedCategory(ALL_CATEGORY)}>
                  {ALL_CATEGORY}
                </DropdownMenuItem>
                {PROVIDER_CATEGORIES.map((category) => (
                  <DropdownMenuItem
                    key={category.id}
                    onSelect={() => setSelectedCategory(category.id)}
                  >
                    {category.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {isLoading ? null : (
            <div className='flex flex-col gap-7'>
              {filteredSections.map((section) => (
                <section key={section.label} className='flex flex-col'>
                  <span className='pl-0.5 text-[var(--text-muted)] text-small'>
                    {section.label}
                  </span>
                  <div className='mt-[9px] mb-3 h-px bg-[var(--border)]' />
                  <div className='flex flex-col gap-2'>
                    {section.providers.map((provider) => {
                      const existingKey = getKeyForProvider(provider.id)
                      const Icon = provider.icon

                      return (
                        <div key={provider.id} className='flex items-center justify-between gap-3'>
                          <div className='flex items-center gap-3'>
                            <div className='flex size-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--surface-6)]'>
                              <Icon className='size-4' />
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
                              <Chip onClick={() => openEditModal(provider.id)}>Update</Chip>
                              <Chip onClick={() => setDeleteConfirmProvider(provider.id)}>
                                Delete
                              </Chip>
                            </div>
                          ) : (
                            <Chip variant='primary' onClick={() => openEditModal(provider.id)}>
                              Add Key
                            </Chip>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))}
              {showNoResults && (
                <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
                  {searchTerm.trim()
                    ? `No providers found matching "${searchTerm}"`
                    : 'No providers in this category'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ChipModal
        open={!!editingProvider}
        onOpenChange={(open) => {
          if (!open) {
            setEditingProvider(null)
            setApiKeyInput('')
            setShowApiKey(false)
            setError(null)
          }
        }}
        srTitle='Add/Update API Key'
      >
        <ChipModalHeader
          onClose={() => {
            setEditingProvider(null)
            setApiKeyInput('')
            setShowApiKey(false)
            setError(null)
          }}
        >
          {editingProvider && (
            <>
              {getKeyForProvider(editingProvider) ? 'Update' : 'Add'}{' '}
              {PROVIDERS.find((p) => p.id === editingProvider)?.name} API Key
            </>
          )}
        </ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            This key will be used for all {PROVIDERS.find((p) => p.id === editingProvider)?.name}{' '}
            requests in this workspace. Your key is encrypted and stored securely.
          </p>
          <ChipModalField type='custom' title='API Key' required>
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
                name='byok_api_key'
                autoComplete='off'
                autoCorrect='off'
                autoCapitalize='off'
                data-lpignore='true'
                data-form-type='other'
              />
              <Button
                variant='ghost'
                className='-translate-y-1/2 absolute top-1/2 right-[4px] size-[28px] p-0'
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? <EyeOff className='size-[14px]' /> : <Eye className='size-[14px]' />}
              </Button>
            </div>
          </ChipModalField>
          <ChipModalError>{error}</ChipModalError>
        </ChipModalBody>
        <ChipModalFooter>
          <Chip
            variant='filled'
            flush
            onClick={() => {
              setEditingProvider(null)
              setApiKeyInput('')
              setShowApiKey(false)
              setError(null)
            }}
            disabled={upsertKey.isPending}
          >
            Cancel
          </Chip>
          <Chip
            variant='primary'
            flush
            onClick={handleSave}
            disabled={!apiKeyInput.trim() || upsertKey.isPending}
          >
            {upsertKey.isPending ? 'Saving...' : 'Save'}
          </Chip>
        </ChipModalFooter>
      </ChipModal>

      <ChipModal
        open={!!deleteConfirmProvider}
        onOpenChange={() => setDeleteConfirmProvider(null)}
        srTitle='Delete API Key'
      >
        <ChipModalHeader showDivider={false}>Delete API Key</ChipModalHeader>
        <ChipModalBody>
          <p className='px-2 text-[var(--text-secondary)] text-sm'>
            Are you sure you want to delete the{' '}
            <span className='font-medium text-[var(--text-primary)]'>
              {PROVIDERS.find((p) => p.id === deleteConfirmProvider)?.name}
            </span>{' '}
            API key?{' '}
            <span className='text-[var(--text-error)]'>
              This workspace will revert to using platform hosted keys.
            </span>{' '}
            This action cannot be undone.
          </p>
        </ChipModalBody>
        <ChipModalFooter>
          <Chip variant='filled' flush onClick={() => setDeleteConfirmProvider(null)}>
            Cancel
          </Chip>
          <Chip variant='destructive' flush onClick={handleDelete} disabled={deleteKey.isPending}>
            {deleteKey.isPending ? 'Deleting...' : 'Delete'}
          </Chip>
        </ChipModalFooter>
      </ChipModal>
    </div>
  )
}
