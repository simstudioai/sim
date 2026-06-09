'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
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
import {
  BYOKKeyManager,
  type BYOKManagerProvider,
  type BYOKProviderSection,
} from '@/app/workspace/[workspaceId]/settings/components/byok/byok-key-manager'
import { useBYOKKeys, useDeleteBYOKKey, useUpsertBYOKKey } from '@/hooks/queries/byok-keys'
import type { BYOKProviderId } from '@/tools/types'

const PROVIDERS: (BYOKManagerProvider & { id: BYOKProviderId })[] = [
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
const PROVIDER_SECTIONS: BYOKProviderSection[] = [
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
    ids: [
      'brandfetch',
      'hunter',
      'peopledatalabs',
      'findymail',
      'prospeo',
      'wiza',
      'zerobounce',
      'neverbounce',
      'millionverifier',
    ],
  },
]

export function BYOK() {
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''

  const { data, isLoading } = useBYOKKeys(workspaceId)
  const keys = data?.keys ?? []
  const upsertKey = useUpsertBYOKKey()
  const deleteKey = useDeleteBYOKKey()

  const configuredProviderIds = useMemo(() => new Set(keys.map((k) => k.providerId)), [keys])

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex max-w-[48rem] flex-col pt-6 pb-6'>
          <BYOKKeyManager
            providers={PROVIDERS}
            sections={PROVIDER_SECTIONS}
            configuredProviderIds={configuredProviderIds}
            isLoading={isLoading}
            isSaving={upsertKey.isPending}
            isDeleting={deleteKey.isPending}
            onSave={async (providerId, apiKey) => {
              await upsertKey.mutateAsync({
                workspaceId,
                providerId: providerId as BYOKProviderId,
                apiKey,
              })
            }}
            onDelete={async (providerId) => {
              await deleteKey.mutateAsync({
                workspaceId,
                providerId: providerId as BYOKProviderId,
              })
            }}
          />
        </div>
      </div>
    </div>
  )
}
