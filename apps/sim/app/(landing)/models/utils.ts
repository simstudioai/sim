import type { ComponentType } from 'react'
import { type ModelCapabilities, PROVIDER_DEFINITIONS } from '@/providers/models'

const PROVIDER_PREFIXES: Record<string, string[]> = {
  'azure-openai': ['azure/'],
  'azure-anthropic': ['azure-anthropic/'],
  vertex: ['vertex/'],
  bedrock: ['bedrock/'],
  cerebras: ['cerebras/'],
  fireworks: ['fireworks/'],
  groq: ['groq/'],
  openrouter: ['openrouter/'],
  vllm: ['vllm/'],
}

const TOKEN_REPLACEMENTS: Record<string, string> = {
  ai: 'AI',
  aws: 'AWS',
  gpt: 'GPT',
  oss: 'OSS',
  llm: 'LLM',
  xai: 'xAI',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  azure: 'Azure',
  gemini: 'Gemini',
  vertex: 'Vertex',
  groq: 'Groq',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  cerebras: 'Cerebras',
  ollama: 'Ollama',
  bedrock: 'Bedrock',
  google: 'Google',
  moonshotai: 'Moonshot AI',
  qwen: 'Qwen',
  glm: 'GLM',
  kimi: 'Kimi',
  nova: 'Nova',
  llama: 'Llama',
  meta: 'Meta',
  cohere: 'Cohere',
  amazon: 'Amazon',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  flash: 'Flash',
  preview: 'Preview',
  latest: 'Latest',
  mini: 'Mini',
  nano: 'Nano',
  pro: 'Pro',
  plus: 'Plus',
  plusplus: 'PlusPlus',
  code: 'Code',
  codex: 'Codex',
  instant: 'Instant',
  versatile: 'Versatile',
  instruct: 'Instruct',
  guard: 'Guard',
  safeguard: 'Safeguard',
  medium: 'Medium',
  small: 'Small',
  large: 'Large',
  lite: 'Lite',
  premier: 'Premier',
  premierer: 'Premier',
  micro: 'Micro',
  reasoning: 'Reasoning',
  non: 'Non',
  distill: 'Distill',
  chat: 'Chat',
  text: 'Text',
  embedding: 'Embedding',
  router: 'Router',
}

export interface PricingInfo {
  input: number
  cachedInput?: number
  output: number
  updatedAt: string
}

export interface CatalogFaq {
  question: string
  answer: string
}

export interface CapabilityFact {
  label: string
  value: string
}

export interface CatalogModel {
  id: string
  slug: string
  href: string
  displayName: string
  shortId: string
  providerId: string
  providerName: string
  providerSlug: string
  contextWindow: number | null
  releaseDate: string | null
  pricing: PricingInfo
  capabilities: ModelCapabilities
  capabilityTags: string[]
  summary: string
  bestFor?: string
  searchText: string
}

export interface CatalogProvider {
  id: string
  slug: string
  href: string
  name: string
  description: string
  summary: string
  defaultModel: string
  defaultModelDisplayName: string
  icon?: ComponentType<{ className?: string }>
  color?: string
  isReseller: boolean
  contextInformationAvailable: boolean
  providerCapabilityTags: string[]
  modelCount: number
  models: CatalogModel[]
  featuredModels: CatalogModel[]
  searchText: string
}

export function formatTokenCount(value?: number | null): string {
  if (value == null) {
    return 'Unknown'
  }

  if (value >= 1000000) {
    return `${trimTrailingZeros((value / 1000000).toFixed(2))}M`
  }

  if (value >= 1000) {
    return `${trimTrailingZeros((value / 1000).toFixed(0))}k`
  }

  return value.toLocaleString('en-US')
}

export function formatPrice(price?: number | null): string {
  if (price === undefined || price === null) {
    return 'N/A'
  }

  const maximumFractionDigits = price > 0 && price < 0.001 ? 4 : 3

  return `$${trimTrailingZeros(
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits,
    }).format(price)
  )}`
}

export function formatUpdatedAt(date: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(date))
  } catch {
    return date
  }
}

export function formatCapabilityBoolean(
  value: boolean | undefined,
  {
    positive = 'Supported',
    negative = 'Not supported',
  }: {
    positive?: string
    negative?: string
  } = {}
): string {
  return value ? positive : negative
}

function supportsCatalogStructuredOutputs(capabilities: ModelCapabilities): boolean {
  return !capabilities.deepResearch
}

export function getEffectiveMaxOutputTokens(capabilities: ModelCapabilities): number | null {
  return capabilities.maxOutputTokens ?? null
}

function trimTrailingZeros(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-')
}

function getProviderPrefixes(providerId: string): string[] {
  return PROVIDER_PREFIXES[providerId] ?? [`${providerId}/`]
}

function stripProviderPrefix(providerId: string, modelId: string): string {
  for (const prefix of getProviderPrefixes(providerId)) {
    if (modelId.startsWith(prefix)) {
      return modelId.slice(prefix.length)
    }
  }

  return modelId
}

function stripTechnicalSuffixes(value: string): string {
  return value
    .replace(/-\d{8}-v\d+:\d+$/i, '')
    .replace(/-v\d+:\d+$/i, '')
    .replace(/-\d{8}$/i, '')
}

function tokenizeModelName(value: string): string[] {
  return value
    .replace(/[./:_]+/g, '-')
    .split('-')
    .filter(Boolean)
}

function mergeVersionTokens(tokens: string[]): string[] {
  const merged: string[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index]
    const next = tokens[index + 1]

    if (/^\d{1,2}$/.test(current) && /^\d{1,2}$/.test(next)) {
      merged.push(`${current}.${next}`)
      index += 1
      continue
    }

    merged.push(current)
  }

  return merged
}

function formatModelToken(token: string): string {
  const normalized = token.toLowerCase()

  if (TOKEN_REPLACEMENTS[normalized]) {
    return TOKEN_REPLACEMENTS[normalized]
  }

  if (/^\d+b$/i.test(token)) {
    return `${token.slice(0, -1)}B`
  }

  if (/^\d+e$/i.test(token)) {
    return `${token.slice(0, -1)}E`
  }

  if (/^o\d+$/i.test(token)) {
    return token.toLowerCase()
  }

  if (/^r\d+$/i.test(token)) {
    return token.toUpperCase()
  }

  if (/^v\d+$/i.test(token)) {
    return token.toUpperCase()
  }

  if (/^\d+\.\d+$/.test(token)) {
    return token
  }

  if (/^[a-z]{3,}\d+$/i.test(token)) {
    const [, prefix, version] = token.match(/^([a-z]{3,})(\d+)$/i) ?? []
    if (prefix && version) {
      return `${formatModelToken(prefix)} ${version}`
    }
  }

  if (/^[a-z]\d+[a-z]$/i.test(token)) {
    return token.toUpperCase()
  }

  if (/^\d+$/.test(token)) {
    return token
  }

  return token.charAt(0).toUpperCase() + token.slice(1)
}

function formatModelDisplayName(providerId: string, modelId: string): string {
  const shortId = stripProviderPrefix(providerId, modelId)
  const normalized = stripTechnicalSuffixes(shortId)
  const tokens = mergeVersionTokens(tokenizeModelName(normalized))

  const displayName = tokens
    .map(formatModelToken)
    .join(' ')
    .split(/\s+/)
    .filter(
      (word, index, words) => index === 0 || word.toLowerCase() !== words[index - 1].toLowerCase()
    )
    .join(' ')

  return displayName.replace(/^GPT (\d[\w.]*)/i, 'GPT-$1').replace(/\bGpt\b/g, 'GPT')
}

function buildCapabilityTags(capabilities: ModelCapabilities): string[] {
  const tags: string[] = []

  if (capabilities.temperature) {
    tags.push(`Temperature ${capabilities.temperature.min}-${capabilities.temperature.max}`)
  }

  if (capabilities.toolUsageControl) {
    tags.push('Tool choice')
  }

  if (supportsCatalogStructuredOutputs(capabilities)) {
    tags.push('Structured outputs')
  }

  if (capabilities.computerUse) {
    tags.push('Computer use')
  }

  if (capabilities.deepResearch) {
    tags.push('Deep research')
  }

  if (capabilities.reasoningEffort) {
    tags.push(`Reasoning ${capabilities.reasoningEffort.values.join(', ')}`)
  }

  if (capabilities.verbosity) {
    tags.push(`Verbosity ${capabilities.verbosity.values.join(', ')}`)
  }

  if (capabilities.thinking) {
    tags.push(`Thinking ${capabilities.thinking.levels.join(', ')}`)
  }

  if (capabilities.maxOutputTokens) {
    tags.push(`Max output ${formatTokenCount(capabilities.maxOutputTokens)}`)
  }

  if (capabilities.memory === false) {
    tags.push('Memory off')
  }

  return tags
}

function buildBestForLine(model: {
  pricing: PricingInfo
  capabilities: ModelCapabilities
  contextWindow: number | null
}): string | null {
  const { pricing, capabilities, contextWindow } = model

  if (capabilities.deepResearch) {
    return 'Best for multi-step research workflows and agent-led web investigation.'
  }

  if (capabilities.reasoningEffort || capabilities.thinking) {
    return 'Best for reasoning-heavy tasks that need more deliberate model control.'
  }

  if (contextWindow && contextWindow >= 1000000) {
    return 'Best for long-context retrieval, large documents, and high-memory workflows.'
  }

  if (capabilities.nativeStructuredOutputs) {
    return 'Best for production workflows that need reliable typed outputs.'
  }

  if (pricing.input <= 0.2 && pricing.output <= 1.25) {
    return 'Best for cost-sensitive automations, background tasks, and high-volume workloads.'
  }

  return null
}

function buildModelSummary(
  providerName: string,
  displayName: string,
  pricing: PricingInfo,
  contextWindow: number | null,
  capabilityTags: string[]
): string {
  const parts = [
    `${displayName} is a ${providerName} model tracked in Sim.`,
    contextWindow ? `It supports a ${formatTokenCount(contextWindow)} token context window.` : null,
    `Pricing starts at ${formatPrice(pricing.input)}/1M input tokens and ${formatPrice(pricing.output)}/1M output tokens.`,
    capabilityTags.length > 0
      ? `Key capabilities include ${capabilityTags.slice(0, 3).join(', ')}.`
      : null,
  ]

  return parts.filter(Boolean).join(' ')
}

function computeModelRelevanceScore(model: CatalogModel): number {
  return (
    (model.capabilities.reasoningEffort ? 10 : 0) +
    (model.capabilities.thinking ? 10 : 0) +
    (model.capabilities.deepResearch ? 8 : 0) +
    (model.capabilities.nativeStructuredOutputs ? 4 : 0) +
    (model.contextWindow ?? 0) / 100000
  )
}

function compareModelsByRelevance(a: CatalogModel, b: CatalogModel): number {
  return computeModelRelevanceScore(b) - computeModelRelevanceScore(a)
}

const rawProviders = Object.values(PROVIDER_DEFINITIONS).map((provider) => {
  const providerSlug = slugify(provider.id)
  const providerDisplayName = provider.name
  const providerCapabilityTags = buildCapabilityTags(provider.capabilities ?? {})

  const models: CatalogModel[] = provider.models.map((model) => {
    const shortId = stripProviderPrefix(provider.id, model.id)
    const mergedCapabilities = { ...provider.capabilities, ...model.capabilities }
    const capabilityTags = buildCapabilityTags(mergedCapabilities)
    const bestFor = buildBestForLine({
      pricing: model.pricing,
      capabilities: mergedCapabilities,
      contextWindow: model.contextWindow ?? null,
    })
    const displayName = formatModelDisplayName(provider.id, model.id)
    const modelSlug = slugify(shortId)
    const href = `/models/${providerSlug}/${modelSlug}`

    return {
      id: model.id,
      slug: modelSlug,
      href,
      displayName,
      shortId,
      providerId: provider.id,
      providerName: providerDisplayName,
      providerSlug,
      contextWindow: model.contextWindow ?? null,
      releaseDate: model.releaseDate ?? null,
      pricing: model.pricing,
      capabilities: mergedCapabilities,
      capabilityTags,
      summary: buildModelSummary(
        providerDisplayName,
        displayName,
        model.pricing,
        model.contextWindow ?? null,
        capabilityTags
      ),
      ...(bestFor ? { bestFor } : {}),
      searchText: [
        provider.name,
        providerDisplayName,
        provider.id,
        provider.description,
        model.id,
        shortId,
        displayName,
        capabilityTags.join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
    }
  })

  const defaultModelDisplayName =
    models.find((model) => model.id === provider.defaultModel)?.displayName ||
    (provider.defaultModel ? formatModelDisplayName(provider.id, provider.defaultModel) : 'Dynamic')

  const featuredModels = [...models].sort(compareModelsByRelevance).slice(0, 6)

  return {
    id: provider.id,
    slug: providerSlug,
    href: `/models/${providerSlug}`,
    name: providerDisplayName,
    description: provider.description,
    summary: `${providerDisplayName} has ${models.length} tracked model${models.length === 1 ? '' : 's'} in Sim with pricing, context window, and capability metadata.`,
    defaultModel: provider.defaultModel,
    defaultModelDisplayName,
    icon: provider.icon,
    color: provider.color,
    isReseller: provider.isReseller ?? false,
    contextInformationAvailable: provider.contextInformationAvailable !== false,
    providerCapabilityTags,
    modelCount: models.length,
    models,
    featuredModels,
    searchText: [
      provider.name,
      provider.id,
      provider.description,
      provider.defaultModel,
      defaultModelDisplayName,
      providerCapabilityTags.join(' '),
      models.map((model) => model.displayName).join(' '),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  } satisfies CatalogProvider
})

function assertUniqueGeneratedRoutes(providers: CatalogProvider[]): void {
  const seenProviderHrefs = new Map<string, string>()
  const seenModelHrefs = new Map<string, string>()

  for (const provider of providers) {
    const existingProvider = seenProviderHrefs.get(provider.href)
    if (existingProvider) {
      throw new Error(
        `Duplicate provider route detected: ${provider.href} for ${provider.id} and ${existingProvider}`
      )
    }
    seenProviderHrefs.set(provider.href, provider.id)

    for (const model of provider.models) {
      const existingModel = seenModelHrefs.get(model.href)
      if (existingModel) {
        throw new Error(
          `Duplicate model route detected: ${model.href} for ${model.id} and ${existingModel}`
        )
      }
      seenModelHrefs.set(model.href, model.id)
    }
  }
}

assertUniqueGeneratedRoutes(rawProviders)

export const MODEL_CATALOG_PROVIDERS: CatalogProvider[] = rawProviders
export const MODEL_PROVIDERS_WITH_CATALOGS = MODEL_CATALOG_PROVIDERS.filter(
  (provider) => provider.models.length > 0
)
export const MODEL_PROVIDERS_WITH_DYNAMIC_CATALOGS = MODEL_CATALOG_PROVIDERS.filter(
  (provider) => provider.models.length === 0
)
export const ALL_CATALOG_MODELS = MODEL_PROVIDERS_WITH_CATALOGS.flatMap(
  (provider) => provider.models
)
export const TOTAL_MODEL_PROVIDERS = MODEL_CATALOG_PROVIDERS.length
export const TOTAL_MODELS = ALL_CATALOG_MODELS.length
export const MAX_CONTEXT_WINDOW = Math.max(
  ...ALL_CATALOG_MODELS.map((model) => model.contextWindow ?? 0)
)
export const TOP_MODEL_PROVIDERS = MODEL_PROVIDERS_WITH_CATALOGS.slice(0, 8).map(
  (provider) => provider.name
)

export function getPricingBounds(pricing: PricingInfo): { lowPrice: number; highPrice: number } {
  return {
    lowPrice: Math.min(
      pricing.input,
      pricing.output,
      ...(pricing.cachedInput !== undefined ? [pricing.cachedInput] : [])
    ),
    highPrice: Math.max(pricing.input, pricing.output),
  }
}

export function getProviderBySlug(providerSlug: string): CatalogProvider | null {
  return MODEL_CATALOG_PROVIDERS.find((provider) => provider.slug === providerSlug) ?? null
}

export function getModelBySlug(providerSlug: string, modelSlug: string): CatalogModel | null {
  const provider = getProviderBySlug(providerSlug)
  if (!provider) {
    return null
  }

  return provider.models.find((model) => model.slug === modelSlug) ?? null
}

export function getRelatedModels(targetModel: CatalogModel, limit = 6): CatalogModel[] {
  const provider = MODEL_PROVIDERS_WITH_CATALOGS.find(
    (entry) => entry.id === targetModel.providerId
  )
  if (!provider) {
    return []
  }

  const targetTokens = new Set(tokenizeModelName(stripTechnicalSuffixes(targetModel.shortId)))

  return provider.models
    .filter((model) => model.id !== targetModel.id)
    .map((model) => {
      const modelTokens = tokenizeModelName(stripTechnicalSuffixes(model.shortId))
      const sharedTokenCount = modelTokens.filter((token) => targetTokens.has(token)).length
      const sharedCapabilityCount = model.capabilityTags.filter((tag) =>
        targetModel.capabilityTags.includes(tag)
      ).length

      return {
        model,
        score: sharedTokenCount * 2 + sharedCapabilityCount + (model.contextWindow ?? 0) / 1000000,
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ model }) => model)
}

export function buildProviderFaqs(provider: CatalogProvider): CatalogFaq[] {
  const cheapestModel = getCheapestProviderModel(provider)
  const largestContextModel = getLargestContextProviderModel(provider)

  const toolUseModels = provider.models.filter(
    (m) =>
      m.capabilities.toolUsageControl !== undefined ||
      provider.providerCapabilityTags.includes('Tool Use')
  )

  const faqs: CatalogFaq[] = [
    {
      question: `What ${provider.name} models are available in Sim?`,
      answer: `Sim currently tracks ${provider.modelCount} ${provider.name} model${provider.modelCount === 1 ? '' : 's'} including ${provider.models
        .slice(0, 6)
        .map((model) => model.displayName)
        .join(', ')}${provider.modelCount > 6 ? ', and more' : ''}.`,
    },
    {
      question: `What is the default ${provider.name} model in Sim?`,
      answer: provider.defaultModel
        ? `${provider.defaultModelDisplayName} is the default ${provider.name} model in Sim.`
        : `${provider.name} does not have a fixed default model in the public catalog because models are loaded dynamically.`,
    },
    {
      question: `What is the cheapest ${provider.name} model tracked in Sim?`,
      answer: cheapestModel
        ? `${cheapestModel.displayName} currently has the lowest listed input price at ${formatPrice(
            cheapestModel.pricing.input
          )}/1M tokens.`
        : `Sim does not currently expose a fixed public pricing table for ${provider.name} models on this page.`,
    },
    {
      question: `Which ${provider.name} model has the largest context window?`,
      answer: largestContextModel?.contextWindow
        ? `${largestContextModel.displayName} currently has the largest listed context window at ${formatTokenCount(
            largestContextModel.contextWindow
          )} tokens.`
        : `Context window details are not fully available for every ${provider.name} model in the public catalog.`,
    },
  ]

  if (toolUseModels.length > 0) {
    faqs.push({
      question: `Which ${provider.name} models support tool use and function calling in Sim?`,
      answer:
        toolUseModels.length === provider.modelCount
          ? `All ${provider.name} models in Sim support tool use and function calling, allowing agents to invoke external APIs, query databases, and run custom actions.`
          : `${toolUseModels
              .slice(0, 5)
              .map((m) => m.displayName)
              .join(
                ', '
              )}${toolUseModels.length > 5 ? ', and others' : ''} support tool use and function calling in Sim, enabling agents to invoke external APIs and run custom actions.`,
    })
  }

  return faqs
}

export function buildModelFaqs(provider: CatalogProvider, model: CatalogModel): CatalogFaq[] {
  const faqs: CatalogFaq[] = [
    {
      question: `What is ${model.displayName}?`,
      answer: `${model.displayName} is a ${provider.name} model available in Sim. ${model.summary}`,
    },
    {
      question: `How much does ${model.displayName} cost?`,
      answer: `${model.displayName} is listed at ${formatPrice(model.pricing.input)}/1M input tokens${model.pricing.cachedInput !== undefined ? `, ${formatPrice(model.pricing.cachedInput)}/1M cached input tokens` : ''}, and ${formatPrice(model.pricing.output)}/1M output tokens.`,
    },
    {
      question: `What is the context window for ${model.displayName}?`,
      answer: model.contextWindow
        ? `${model.displayName} supports a context window of ${formatTokenCount(model.contextWindow)} tokens in Sim. In an agent workflow, this determines how much conversation history, tool outputs, and retrieved documents the model can hold in a single call.`
        : `A public context window value is not currently tracked for ${model.displayName}.`,
    },
    {
      question: `What capabilities does ${model.displayName} support?`,
      answer:
        model.capabilityTags.length > 0
          ? `${model.displayName} supports the following capabilities in Sim: ${model.capabilityTags.join(', ')}.`
          : `${model.displayName} supports standard text generation in Sim. No additional capability flags such as tool use or structured outputs are currently tracked for this model.`,
    },
  ]

  if (model.bestFor) {
    faqs.push({
      question: `What is ${model.displayName} best used for?`,
      answer: `${model.bestFor} When used in a Sim workflow, it can be selected in any Agent block from the model picker.`,
    })
  }

  return faqs
}

export function buildModelCapabilityFacts(model: CatalogModel): CapabilityFact[] {
  const { capabilities } = model
  const supportsStructuredOutputs = supportsCatalogStructuredOutputs(capabilities)

  return [
    {
      label: 'Temperature',
      value: capabilities.temperature
        ? `${capabilities.temperature.min} to ${capabilities.temperature.max}`
        : 'Not configurable',
    },
    {
      label: 'Reasoning effort',
      value: capabilities.reasoningEffort
        ? capabilities.reasoningEffort.values.join(', ')
        : 'Not supported',
    },
    {
      label: 'Verbosity',
      value: capabilities.verbosity ? capabilities.verbosity.values.join(', ') : 'Not supported',
    },
    {
      label: 'Thinking levels',
      value: capabilities.thinking
        ? `${capabilities.thinking.levels.join(', ')}${
            capabilities.thinking.default ? ` (default: ${capabilities.thinking.default})` : ''
          }`
        : 'Not supported',
    },
    {
      label: 'Structured outputs',
      value: supportsStructuredOutputs
        ? capabilities.nativeStructuredOutputs
          ? 'Supported (native)'
          : 'Supported'
        : 'Not supported',
    },
    {
      label: 'Tool choice',
      value: formatCapabilityBoolean(capabilities.toolUsageControl),
    },
    {
      label: 'Computer use',
      value: formatCapabilityBoolean(capabilities.computerUse),
    },
    {
      label: 'Deep research',
      value: formatCapabilityBoolean(capabilities.deepResearch),
    },
    {
      label: 'Memory support',
      value: capabilities.memory === false ? 'Disabled' : 'Supported',
    },
    {
      label: 'Max output tokens',
      value: capabilities.maxOutputTokens
        ? formatTokenCount(getEffectiveMaxOutputTokens(capabilities))
        : 'Not published',
    },
  ]
}

export function getCheapestProviderModel(provider: CatalogProvider): CatalogModel | null {
  return [...provider.models].sort((a, b) => a.pricing.input - b.pricing.input)[0] ?? null
}

export function getLargestContextProviderModel(provider: CatalogProvider): CatalogModel | null {
  return (
    [...provider.models].sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0))[0] ?? null
  )
}

export function getProviderCapabilitySummary(provider: CatalogProvider): CapabilityFact[] {
  const reasoningCount = provider.models.filter(
    (model) => model.capabilities.reasoningEffort || model.capabilities.thinking
  ).length
  const structuredCount = provider.models.filter((model) =>
    supportsCatalogStructuredOutputs(model.capabilities)
  ).length
  const deepResearchCount = provider.models.filter(
    (model) => model.capabilities.deepResearch
  ).length
  const cheapestModel = getCheapestProviderModel(provider)
  const largestContextModel = getLargestContextProviderModel(provider)

  return [
    {
      label: 'Reasoning-capable models',
      value: reasoningCount > 0 ? `${reasoningCount} tracked` : 'None tracked',
    },
    {
      label: 'Structured outputs',
      value: structuredCount > 0 ? `${structuredCount} tracked` : 'None tracked',
    },
    {
      label: 'Deep research models',
      value: deepResearchCount > 0 ? `${deepResearchCount} tracked` : 'None tracked',
    },
    {
      label: 'Lowest input price',
      value: cheapestModel
        ? `${cheapestModel.displayName} at ${formatPrice(cheapestModel.pricing.input)}/1M`
        : 'Not available',
    },
    {
      label: 'Largest context window',
      value: largestContextModel?.contextWindow
        ? `${largestContextModel.displayName} at ${formatTokenCount(largestContextModel.contextWindow)}`
        : 'Not available',
    },
  ]
}
