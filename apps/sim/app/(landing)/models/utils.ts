import type { ComponentType } from 'react'
import { compareStrings, slugify } from '@sim/utils/string'
import { type ModelCapabilities, PROVIDER_DEFINITIONS } from '@/providers/models'
import type { ModelPricing, ModelPricingTier } from '@/providers/types'

const PROVIDER_PREFIXES: Record<string, string[]> = {
  'azure-openai': ['azure/'],
  'azure-anthropic': ['azure-anthropic/'],
  vertex: ['vertex/'],
  bedrock: ['bedrock/'],
  cerebras: ['cerebras/'],
  fireworks: ['fireworks/'],
  together: ['together/'],
  baseten: ['baseten/'],
  'ollama-cloud': ['ollama-cloud/'],
  groq: ['groq/'],
  kie: ['kie/'],
  openrouter: ['openrouter/'],
  vllm: ['vllm/'],
}

/**
 * How searchers name a provider's API when the model family differs from the company name
 * ("Claude", not "Anthropic"). `family` names the models in copy ("the Claude context window");
 * `apiName` leads the provider page title and defaults to `{provider name} ({family})`
 * ("Anthropic (Claude) API Pricing & Models"). Providers left out use their own name for both.
 */
const PROVIDER_MODEL_FAMILIES: Record<string, { family: string; apiName?: string }> = {
  anthropic: { family: 'Claude' },
  'azure-anthropic': { family: 'Claude' },
  google: { family: 'Gemini', apiName: 'Google Gemini' },
  openai: { family: 'GPT', apiName: 'OpenAI' },
  xai: { family: 'Grok' },
  zai: { family: 'GLM' },
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

const PRICE_NUMBER_FORMAT_3 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})

const PRICE_NUMBER_FORMAT_4 = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
})

const UPDATED_AT_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

export type PricingInfo = ModelPricing

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
  /** Superseded or retired: the model carries any `sunset` status. */
  deprecated: boolean
  /** Retired by the provider (`sunset.status === 'deprecated'`): API calls to it now fail. */
  retired: boolean
  featured: boolean
  recommended: boolean
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
  /** Model family name searchers use ("Claude", "Gemini"); the provider name when it has none. */
  modelFamily: string
  /** Name searchers pair with "API pricing" ("Anthropic (Claude)"); the provider name by default. */
  apiName: string
  isReseller: boolean
  contextInformationAvailable: boolean
  /** Max agent-block file attachment size in bytes when the provider exceeds the default. */
  maxFileAttachmentBytes: number | null
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

export function formatFileSize(bytes?: number | null): string {
  if (bytes == null) {
    return 'Unknown'
  }

  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) {
    return `${trimTrailingZeros(gb.toFixed(1))}GB`
  }
  return `${Math.round(bytes / (1024 * 1024))}MB`
}

export function formatPrice(price?: number | null): string {
  if (price === undefined || price === null) {
    return 'N/A'
  }

  const formatter = price > 0 && price < 0.001 ? PRICE_NUMBER_FORMAT_4 : PRICE_NUMBER_FORMAT_3

  return `$${trimTrailingZeros(formatter.format(price))}`
}

export function formatUpdatedAt(date: string): string {
  try {
    return UPDATED_AT_DATE_FORMAT.format(new Date(date))
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

/** True when a model lists a non-zero input or output token price. */
export function hasPublishedPricing(pricing: PricingInfo): boolean {
  return pricing.input > 0 || pricing.output > 0
}

/**
 * True for a model that takes a prompt. Evaluation models (`capabilities.evaluation`) take native
 * state and questions instead, so prompt token, cost, and context-window comparisons leave them out,
 * as the non-Agent model pickers do.
 */
export function isPromptModel(model: CatalogModel): boolean {
  return !model.capabilities.evaluation
}

/** One long-context surcharge tier as a sentence fragment, without trailing punctuation. */
export function formatPricingTier(tier: ModelPricingTier): string {
  return `Above ${formatTokenCount(tier.aboveInputTokens)} input tokens, the full request is priced at ${formatPrice(tier.input)}/1M input tokens${tier.cachedInput !== undefined ? `, ${formatPrice(tier.cachedInput)}/1M cached input tokens` : ''}, and ${formatPrice(tier.output)}/1M output tokens`
}

function trimTrailingZeros(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
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

  for (const token of tokens) {
    const previous = merged[merged.length - 1]

    if (
      previous !== undefined &&
      /^[a-z]*\d{1,2}(\.\d{1,2})*$/i.test(previous) &&
      /^\d{1,2}$/.test(token)
    ) {
      merged[merged.length - 1] = `${previous}.${token}`
      continue
    }

    merged.push(token)
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

  if (/^\d+(\.\d+)+$/.test(token)) {
    return token
  }

  if (/^[a-z]{3,}\d+(\.\d+)*$/i.test(token)) {
    const [, prefix, version] = token.match(/^([a-z]{3,})(\d+(?:\.\d+)*)$/i) ?? []
    if (prefix && version) {
      return `${formatModelToken(prefix)} ${version}`
    }
  }

  if (/^[a-z]\d+(\.\d+)+$/i.test(token)) {
    return token.toUpperCase()
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
  const featuredDifference = Number(b.featured) - Number(a.featured)
  if (featuredDifference !== 0) return featuredDifference

  const recommendationDifference = Number(b.recommended) - Number(a.recommended)
  if (recommendationDifference !== 0) return recommendationDifference

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
      deprecated: !!model.sunset,
      retired: model.sunset?.status === 'deprecated',
      featured: model.featured ?? false,
      recommended: model.recommended ?? false,
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
  const naming = PROVIDER_MODEL_FAMILIES[provider.id]
  const modelFamily = naming?.family ?? providerDisplayName

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
    modelFamily,
    apiName: naming
      ? (naming.apiName ?? `${providerDisplayName} (${modelFamily})`)
      : providerDisplayName,
    isReseller: provider.isReseller ?? false,
    contextInformationAvailable: provider.contextInformationAvailable !== false,
    maxFileAttachmentBytes: provider.fileAttachment?.maxBytes ?? null,
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
/** Every provider with a page: those with a model catalog, resellers included. */
export const MODEL_PROVIDERS_WITH_MODELS = MODEL_CATALOG_PROVIDERS.filter(
  (provider) => provider.models.length > 0
)
export const MODEL_PROVIDERS_WITH_CATALOGS = MODEL_CATALOG_PROVIDERS.filter(
  (provider) => provider.models.length > 0 && !provider.isReseller
)
export const MODEL_PROVIDERS_WITH_DYNAMIC_CATALOGS = MODEL_CATALOG_PROVIDERS.filter(
  (provider) => provider.models.length === 0
)
export const ALL_CATALOG_MODELS = MODEL_PROVIDERS_WITH_CATALOGS.flatMap(
  (provider) => provider.models
)
/** Display names more than one first-party provider lists, so their pages name the provider too. */
const SHARED_FIRST_PARTY_NAMES = new Set(
  ALL_CATALOG_MODELS.map((model) => model.displayName).filter(
    (name, index, names) => names.indexOf(name) !== index
  )
)
export const TOTAL_MODEL_PROVIDERS = MODEL_CATALOG_PROVIDERS.length
export const TOTAL_MODELS = ALL_CATALOG_MODELS.length
export const TOP_MODEL_PROVIDERS = MODEL_PROVIDERS_WITH_CATALOGS.slice(0, 8).map(
  (provider) => provider.name
)

export function getPricingBounds(pricing: PricingInfo): { lowPrice: number; highPrice: number } {
  const prices = [pricing, ...(pricing.tiers ?? [])].flatMap((tokenPricing) => [
    tokenPricing.input,
    tokenPricing.output,
    ...(tokenPricing.cachedInput !== undefined ? [tokenPricing.cachedInput] : []),
  ])

  return {
    lowPrice: Math.min(...prices),
    highPrice: Math.max(...prices),
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

  const scored = provider.models.reduce<Array<{ model: CatalogModel; score: number }>>(
    (acc, model) => {
      if (model.id === targetModel.id) {
        return acc
      }

      const modelTokens = tokenizeModelName(stripTechnicalSuffixes(model.shortId))
      const sharedTokenCount = modelTokens.filter((token) => targetTokens.has(token)).length
      const sharedCapabilityCount = model.capabilityTags.filter((tag) =>
        targetModel.capabilityTags.includes(tag)
      ).length

      acc.push({
        model,
        score: sharedTokenCount * 2 + sharedCapabilityCount + (model.contextWindow ?? 0) / 1000000,
      })
      return acc
    },
    []
  )

  return scored
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
  const pricingTiers = model.pricing.tiers ?? []
  const faqs: CatalogFaq[] = [
    {
      question: `What is ${model.displayName}?`,
      answer: `${model.displayName} is a ${provider.name} model available in Sim. ${model.summary}`,
    },
    {
      question: `How much does ${model.displayName} cost?`,
      answer: `${model.displayName} starts at ${formatPrice(model.pricing.input)}/1M input tokens${model.pricing.cachedInput !== undefined ? `, ${formatPrice(model.pricing.cachedInput)}/1M cached input tokens` : ''}, and ${formatPrice(model.pricing.output)}/1M output tokens.${pricingTiers
        .map((tier) => ` ${formatPricingTier(tier)}.`)
        .join('')}`,
    },
    {
      question: `What is the context window for ${model.displayName}?`,
      answer: model.contextWindow
        ? `${model.displayName} supports a context window of ${formatTokenCount(model.contextWindow)} tokens in Sim. In an agent, this determines how much conversation history, tool outputs, and retrieved documents the model can hold in a single call.`
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
  if (provider.models.length === 0) return null
  return provider.models.reduce((min, m) => (m.pricing.input < min.pricing.input ? m : min))
}

/**
 * Largest context window first. Ties put current models before superseded or retired ones, then
 * newer releases first, then the display name, so the order is stable between builds.
 */
export function compareByContextWindow(a: CatalogModel, b: CatalogModel): number {
  return (
    (b.contextWindow ?? 0) - (a.contextWindow ?? 0) ||
    Number(a.deprecated) - Number(b.deprecated) ||
    compareStrings(b.releaseDate ?? '', a.releaseDate ?? '') ||
    compareStrings(a.displayName, b.displayName)
  )
}

/**
 * The provider's largest-context model that is not retired. Ties go to the first model in catalog
 * order, so the answer names the provider's headline model rather than a smaller sibling with the
 * same window.
 */
export function getLargestContextProviderModel(provider: CatalogProvider): CatalogModel | null {
  const candidates = provider.models.filter((model) => !model.retired && model.contextWindow)
  if (candidates.length === 0) return null
  return candidates.reduce((max, model) =>
    (model.contextWindow ?? 0) > (max.contextWindow ?? 0) ? model : max
  )
}

function providerHasPublishedPricing(provider: CatalogProvider): boolean {
  return provider.models.some((model) => hasPublishedPricing(model.pricing))
}

/**
 * Provider page title. A provider with published token prices is titled for the API-pricing
 * searches people run ("Anthropic (Claude) API Pricing & Models"); one without keeps a plain
 * models title, so the page never promises pricing it does not list.
 */
export function getProviderPageTitle(provider: CatalogProvider): string {
  return providerHasPublishedPricing(provider)
    ? `${provider.apiName} API Pricing & Models`
    : `${provider.name} Models`
}

/** Provider meta description: per-1M-token pricing and context windows when prices are listed. */
export function getProviderPageDescription(provider: CatalogProvider): string {
  const models = `${provider.modelCount} model${provider.modelCount === 1 ? '' : 's'}`
  return providerHasPublishedPricing(provider)
    ? `${provider.apiName} API pricing per 1M input and output tokens, context windows, and capabilities for ${models}. Use any of them in Sim's AI agents.`
    : `Context windows and capabilities for ${models}. Use any of them in Sim's AI agents.`
}

/** Longest page title that keeps the rendered `<title>` (with the " | Sim" template) at 60 chars. */
export const MAX_PAGE_TITLE_LENGTH = 54

/** The first candidate within `maxLength` characters, else the last (shortest) candidate. */
export function fitWithinLength(candidates: readonly [string, ...string[]], maxLength: number) {
  return (
    candidates.find((candidate) => candidate.length <= maxLength) ??
    candidates[candidates.length - 1]
  )
}

/**
 * Model name qualified by its host ("Claude Opus 4.7 on AWS Bedrock") on a reseller's page or when
 * two first-party providers list the same name, so every model page has a distinct title and H1.
 */
export function getModelPageName(provider: CatalogProvider, model: CatalogModel): string {
  return provider.isReseller || SHARED_FIRST_PARTY_NAMES.has(model.displayName)
    ? `${model.displayName} on ${provider.name}`
    : model.displayName
}

/**
 * Model page title, as specific as the 60-character `<title>` budget allows. A model without
 * published token prices is never titled for pricing.
 */
export function getModelPageTitle(provider: CatalogProvider, model: CatalogModel): string {
  const name = getModelPageName(provider, model)
  return hasPublishedPricing(model.pricing)
    ? fitWithinLength(
        [
          `${name} API Pricing & Context Window`,
          `${name} API Pricing & Specs`,
          `${name} API Pricing`,
          `${name} Pricing`,
          name,
        ],
        MAX_PAGE_TITLE_LENGTH
      )
    : fitWithinLength([`${name} Context Window & Features`, name], MAX_PAGE_TITLE_LENGTH)
}

/** Model meta description; long model names drop the trailing Sim sentence. */
export function getModelPageDescription(provider: CatalogProvider, model: CatalogModel): string {
  const lead = hasPublishedPricing(model.pricing)
    ? `${model.displayName} by ${provider.name}: API pricing per 1M tokens, cached input cost, context window, and capabilities.`
    : `${model.displayName} by ${provider.name}: context window, max output, and capabilities.`
  return fitWithinLength([`${lead} Use it in Sim's AI agents.`, lead], 155)
}

/** Most recent `pricing.updatedAt` across a non-empty list of models. */
export function getLatestModelUpdate(models: CatalogModel[]): Date {
  return new Date(Math.max(...models.map((model) => new Date(model.pricing.updatedAt).getTime())))
}
