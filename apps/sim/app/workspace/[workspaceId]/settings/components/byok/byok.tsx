'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
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
  BYOKKeyManager,
  type BYOKManagerProvider,
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
    icon: ImageIcon,
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
    <BYOKKeyManager
      providers={PROVIDERS}
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
  )
}
