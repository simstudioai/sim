'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { Eye, EyeOff } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Chip,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  Search,
} from '@/components/emcn'
import {
  AnthropicIcon,
  BasetenIcon,
  BrandfetchIcon,
  ExaAIIcon,
  FalIcon,
  FindymailIcon,
  FirecrawlIcon,
  FireworksIcon,
  GeminiIcon,
  GoogleIcon,
  HunterIOIcon,
  JinaAIIcon,
  LinkupIcon,
  MillionVerifierIcon,
  MistralIcon,
  NeverBounceIcon,
  OllamaIcon,
  OpenAIIcon,
  ParallelIcon,
  PeopleDataLabsIcon,
  PerplexityIcon,
  ProspeoIcon,
  SerperIcon,
  TogetherIcon,
  WizaIcon,
  ZeroBounceIcon,
} from '@/components/icons'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
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
    id: 'fireworks',
    name: 'Fireworks',
    icon: FireworksIcon,
    description: 'LLM calls',
    placeholder: 'Enter your Fireworks API key',
  },
  {
    id: 'together',
    name: 'Together AI',
    icon: TogetherIcon,
    description: 'LLM calls',
    placeholder: 'Enter your Together AI API key',
  },
  {
    id: 'baseten',
    name: 'Baseten',
    icon: BasetenIcon,
    description: 'LLM calls',
    placeholder: 'Enter your Baseten API key',
  },
  {
    id: 'ollama-cloud',
    name: 'Ollama Cloud',
    icon: OllamaIcon,
    description: 'LLM calls',
    placeholder: 'Enter your Ollama API key',
  },
  {
    id: 'falai',
    name: 'Fal.ai',
    icon: FalIcon,
    description: 'Image and video generation',
    placeholder: 'Enter your Fal.ai API key',
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
  {
    id: 'hunter',
    name: 'Hunter',
    icon: HunterIOIcon,
    description: 'Email finder, verification, and domain search',
    placeholder: 'Enter your Hunter.io API key',
  },
  {
    id: 'peopledatalabs',
    name: 'People Data Labs',
    icon: PeopleDataLabsIcon,
    description: 'Person and company enrichment, search, and identity',
    placeholder: 'Enter your People Data Labs API key',
  },
  {
    id: 'findymail',
    name: 'Findymail',
    icon: FindymailIcon,
    description: 'Email finder, verification, and phone lookup',
    placeholder: 'Enter your Findymail API key',
  },
  {
    id: 'prospeo',
    name: 'Prospeo',
    icon: ProspeoIcon,
    description: 'Person and company enrichment and search',
    placeholder: 'Enter your Prospeo API key',
  },
  {
    id: 'wiza',
    name: 'Wiza',
    icon: WizaIcon,
    description: 'Prospect search, individual reveal, and company enrichment',
    placeholder: 'Enter your Wiza API key',
  },
  {
    id: 'zerobounce',
    name: 'ZeroBounce',
    icon: ZeroBounceIcon,
    description: 'Real-time email validation and deliverability checks',
    placeholder: 'Enter your ZeroBounce API key',
  },
  {
    id: 'neverbounce',
    name: 'NeverBounce',
    icon: NeverBounceIcon,
    description: 'Real-time email verification and list cleaning',
    placeholder: 'Enter your NeverBounce API key',
  },
  {
    id: 'millionverifier',
    name: 'MillionVerifier',
    icon: MillionVerifierIcon,
    description: 'Real-time email verification and deliverability checks',
    placeholder: 'Enter your MillionVerifier API key',
  },
]

/**
 * Provider groupings rendered as labeled sections. Every provider id in
 * {@link PROVIDERS} belongs to exactly one section; rows keep their
 * {@link PROVIDERS} order within each group.
 */
const PROVIDER_SECTIONS: { label: string; ids: BYOKProviderId[] }[] = [
  {
    label: 'Models',
    ids: [
      'openai',
      'anthropic',
      'google',
      'mistral',
      'fireworks',
      'together',
      'baseten',
      'ollama-cloud',
      'falai',
    ],
  },
  {
    label: 'Search & web',
    ids: [
      'firecrawl',
      'exa',
      'serper',
      'linkup',
      'parallel_ai',
      'perplexity',
      'jina',
      'google_cloud',
    ],
  },
  {
    label: 'Enrichment',
    ids: ['brandfetch', 'hunter', 'peopledatalabs', 'findymail', 'prospeo', 'wiza'],
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

  const filteredIds = useMemo(
    () => new Set(filteredProviders.map((p) => p.id)),
    [filteredProviders]
  )

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
          <ChipInput
            icon={Search}
            placeholder='Search providers...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            disabled={isLoading}
          />

          {isLoading ? null : showNoResults ? (
            <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
              No providers found matching "{searchTerm}"
            </div>
          ) : (
            <div className='flex flex-col gap-7'>
              {PROVIDER_SECTIONS.map((section) => {
                const rows = PROVIDERS.filter(
                  (p) => section.ids.includes(p.id) && filteredIds.has(p.id)
                )
                if (rows.length === 0) return null

                return (
                  <SettingsSection key={section.label} label={section.label}>
                    <div className='flex flex-col gap-2'>
                      {rows.map((provider) => {
                        const existingKey = getKeyForProvider(provider.id)
                        const Icon = provider.icon

                        return (
                          <div
                            key={provider.id}
                            className='flex items-center justify-between gap-2.5'
                          >
                            <div className='flex min-w-0 items-center gap-2.5'>
                              <div className='flex size-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border-1)] bg-[var(--bg)]'>
                                <Icon className='size-5' />
                              </div>
                              <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                                <span className='truncate text-[14px] text-[var(--text-body)]'>
                                  {provider.name}
                                </span>
                                <span className='truncate text-[12px] text-[var(--text-muted)]'>
                                  {provider.description}
                                </span>
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
                  </SettingsSection>
                )
              })}
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
            <ChipInput
              type={showApiKey ? 'text' : 'password'}
              value={apiKeyInput}
              onChange={(e) => {
                setApiKeyInput(e.target.value)
                if (error) setError(null)
              }}
              placeholder={PROVIDERS.find((p) => p.id === editingProvider)?.placeholder}
              name='byok_api_key'
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              data-lpignore='true'
              data-form-type='other'
              endAdornment={
                <Button
                  variant='ghost'
                  className='size-[28px] p-0'
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? (
                    <EyeOff className='size-[14px]' />
                  ) : (
                    <Eye className='size-[14px]' />
                  )}
                </Button>
              }
            />
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
