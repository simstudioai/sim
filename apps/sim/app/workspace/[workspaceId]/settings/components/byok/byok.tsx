'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import {
  AnthropicIcon,
  BasetenIcon,
  BrandfetchIcon,
  ContextDevIcon,
  DatagmaIcon,
  DropcontactIcon,
  EnrowIcon,
  ExaAIIcon,
  FalIcon,
  FindymailIcon,
  FirecrawlIcon,
  FireworksIcon,
  GeminiIcon,
  GoogleIcon,
  HunterIOIcon,
  IcypeasIcon,
  JinaAIIcon,
  LeadMagicIcon,
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
  xAIIcon,
  ZeroBounceIcon,
} from '@/components/icons'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import { MAX_BYOK_KEYS_PER_PROVIDER } from '@/lib/api/contracts/byok-keys'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  BYOKKeyManager,
  type BYOKManagerKey,
  type BYOKManagerProvider,
  type BYOKProviderSection,
} from '@/app/workspace/[workspaceId]/settings/components/byok/byok-key-manager'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
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
    id: 'xai',
    name: 'xAI',
    icon: xAIIcon,
    description: 'LLM calls',
    placeholder: 'xai-...',
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
    id: 'context_dev',
    name: 'Context.dev',
    icon: ContextDevIcon,
    description: 'Web scraping, crawling, search, and brand intelligence',
    placeholder: 'Enter your Context.dev API key',
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
    id: 'datagma',
    name: 'Datagma',
    icon: DatagmaIcon,
    description: 'Email, phone, person, and company enrichment',
    placeholder: 'Enter your Datagma API key',
  },
  {
    id: 'dropcontact',
    name: 'Dropcontact',
    icon: DropcontactIcon,
    description: 'GDPR-compliant contact enrichment and email finding',
    placeholder: 'Enter your Dropcontact API key',
  },
  {
    id: 'leadmagic',
    name: 'LeadMagic',
    icon: LeadMagicIcon,
    description: 'Email finding, validation, and B2B profile enrichment',
    placeholder: 'Enter your LeadMagic API key',
  },
  {
    id: 'icypeas',
    name: 'Icypeas',
    icon: IcypeasIcon,
    description: 'Email finding and verification',
    placeholder: 'Enter your Icypeas API key',
  },
  {
    id: 'enrow',
    name: 'Enrow',
    icon: EnrowIcon,
    description: 'Email finding and verification',
    placeholder: 'Enter your Enrow API key',
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
      'xai',
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
      'context_dev',
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
      'datagma',
      'dropcontact',
      'leadmagic',
      'icypeas',
      'enrow',
      'zerobounce',
      'neverbounce',
      'millionverifier',
    ],
  },
]

export function BYOK() {
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const workspacePermissions = useUserPermissionsContext()
  const canManage = canMutateWorkspaceSettingsSection('byok', workspacePermissions)

  const { data, isLoading } = useBYOKKeys(workspaceId)
  const upsertKey = useUpsertBYOKKey()
  const deleteKey = useDeleteBYOKKey()

  const keysByProvider = useMemo(() => {
    const grouped = new Map<string, BYOKManagerKey[]>()
    for (const key of data?.keys ?? []) {
      const providerKeys = grouped.get(key.providerId) ?? []
      providerKeys.push({ id: key.id, name: key.name, maskedKey: key.maskedKey })
      grouped.set(key.providerId, providerKeys)
    }
    return grouped
  }, [data?.keys])

  return (
    <SettingsPanel>
      <BYOKKeyManager
        multiKey
        providers={PROVIDERS}
        sections={PROVIDER_SECTIONS}
        keysByProvider={keysByProvider}
        maxKeysPerProvider={MAX_BYOK_KEYS_PER_PROVIDER}
        isLoading={isLoading}
        isSaving={upsertKey.isPending}
        isDeleting={deleteKey.isPending}
        readOnly={!canManage}
        onSaveKey={async ({ providerId, apiKey, keyId, name }) => {
          await upsertKey.mutateAsync({
            workspaceId,
            providerId: providerId as BYOKProviderId,
            apiKey,
            keyId,
            name,
          })
        }}
        onDeleteKey={async (providerId, keyId) => {
          await deleteKey.mutateAsync({
            workspaceId,
            providerId: providerId as BYOKProviderId,
            keyId,
          })
        }}
      />
    </SettingsPanel>
  )
}
