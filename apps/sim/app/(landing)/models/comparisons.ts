import {
  ALL_CATALOG_MODELS,
  type CatalogFaq,
  type CatalogModel,
  type CatalogProvider,
  fitWithinLength,
  formatPrice,
  formatTokenCount,
  getEffectiveMaxOutputTokens,
  getLatestModelUpdate,
  getProviderBySlug,
  hasPublishedPricing,
  isPromptModel,
  MAX_PAGE_TITLE_LENGTH,
} from '@/app/(landing)/models/utils'
import { resolveModelTokenPricing } from '@/providers/pricing'

/**
 * Curated head-to-head comparisons, as pairs of first-party catalog model ids. Each pair renders at
 * `/models/compare/{first}-vs-{second}` only, so list a pair once, in the order searchers usually
 * type it.
 *
 * Every id must resolve to exactly one callable first-party model with published token prices. A
 * pair that stops resolving (a model renamed, removed, or retired in `providers/models.ts`) throws
 * when this module loads, which fails the build instead of shipping a broken or thin page.
 */
const MODEL_COMPARISON_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['claude-opus-5-5', 'claude-sonnet-5-5'],
  ['claude-sonnet-5-5', 'claude-haiku-5-5'],
  ['claude-opus-5-5', 'claude-haiku-5-5'],
  ['claude-fable-5-1', 'claude-opus-5-5'],
  ['claude-fable-5-1', 'claude-haiku-5-5'],
  ['claude-opus-5-5', 'claude-opus-4-8'],
  ['claude-sonnet-5-5', 'claude-sonnet-4-6'],
  ['claude-opus-4-7', 'claude-sonnet-4-6'],
  ['claude-haiku-5-5', 'claude-haiku-4-5'],
  ['gpt-6-astra', 'gpt-6-sol'],
  ['gpt-6-sol', 'gpt-6-luna'],
  ['gpt-6-astra', 'gpt-6-luna'],
  ['gpt-6.1-sol', 'gpt-6-sol'],
  ['gpt-5.5', 'gpt-5.4'],
  ['gpt-5.5', 'gpt-5.5-pro'],
  ['gpt-5.4', 'gpt-5.4-mini'],
  ['gpt-5.4-mini', 'gpt-5.4-nano'],
  ['gpt-5', 'gpt-5-mini'],
  ['gpt-5', 'gpt-4.1'],
  ['gemini-4-argon', 'gemini-3.8-flash'],
  ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
  ['gemini-3.1-pro-preview', 'gemini-2.5-pro'],
  ['gemini-2.5-pro', 'gemini-2.5-flash'],
  ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  ['claude-opus-5-5', 'gpt-6-astra'],
  ['claude-opus-5-5', 'gemini-4-argon'],
  ['gpt-6-astra', 'gemini-4-argon'],
  ['claude-sonnet-5-5', 'gpt-6-sol'],
  ['claude-sonnet-5-5', 'gemini-4-argon'],
  ['gpt-6-sol', 'gemini-4-argon'],
  ['claude-opus-5-5', 'grok-4.7'],
  ['gpt-6-astra', 'grok-4.7'],
  ['gemini-4-argon', 'grok-4.7'],
  ['claude-opus-5-5', 'deepseek-v4-pro'],
  ['gpt-6-sol', 'deepseek-v4-pro'],
  ['gemini-4-argon', 'deepseek-v4-pro'],
  ['deepseek-v4-pro', 'kimi-k3'],
  ['claude-sonnet-5-5', 'kimi-k3'],
  ['claude-sonnet-5-5', 'glm-5.3'],
  ['claude-opus-5-5', 'mistral-large-4'],
  ['claude-haiku-5-5', 'gpt-6-luna'],
  ['claude-haiku-5-5', 'gemini-3.8-flash'],
  ['gpt-6-luna', 'gemini-3.8-flash'],
  ['gemini-3.8-flash', 'deepseek-flash'],
  ['gpt-5-mini', 'gemini-2.5-flash'],
  ['gpt-5', 'claude-sonnet-4-5'],
  ['gpt-5', 'gemini-2.5-pro'],
]

/** Token volume behind the "typical agent call" cost in every verdict: 1,000 calls of 10k in, 1k out. */
const SAMPLE_CALLS = 1000
const SAMPLE_INPUT_TOKENS_PER_CALL = 10_000
const SAMPLE_OUTPUT_TOKENS_PER_CALL = 1000

/** Ratios within this band read as "about the same" rather than a multiple. */
const SAME_RATIO_THRESHOLD = 1.1

interface ComparedModel {
  model: CatalogModel
  provider: CatalogProvider
}

/** A curated pair, rendered at `href`; `a` and `b` keep the pair's curated order. */
export interface ModelComparison {
  slug: string
  href: string
  title: string
  a: ComparedModel
  b: ComparedModel
}

function resolveComparedModel(id: string): ComparedModel {
  const matches = ALL_CATALOG_MODELS.filter((model) => model.id === id)
  if (matches.length !== 1) {
    throw new Error(
      `Model comparison id "${id}" matches ${matches.length} first-party catalog models; update MODEL_COMPARISON_PAIRS`
    )
  }
  const [model] = matches
  if (model.retired) {
    throw new Error(
      `Model comparison id "${id}" is retired by its provider; update MODEL_COMPARISON_PAIRS`
    )
  }
  if (!isPromptModel(model)) {
    throw new Error(`Model comparison id "${id}" is an evaluation model, not a prompt model`)
  }
  if (!hasPublishedPricing(model.pricing)) {
    throw new Error(`Model comparison id "${id}" has no published token pricing`)
  }
  const provider = getProviderBySlug(model.providerSlug)
  if (!provider) {
    throw new Error(`Model comparison id "${id}" has no provider page`)
  }
  return { model, provider }
}

function buildComparisons(): ModelComparison[] {
  const seenSlugs = new Set<string>()

  return MODEL_COMPARISON_PAIRS.map(([firstId, secondId]) => {
    if (firstId === secondId) {
      throw new Error(`Model comparison pairs "${firstId}" with itself`)
    }

    const a = resolveComparedModel(firstId)
    const b = resolveComparedModel(secondId)
    const slug = `${a.model.slug}-vs-${b.model.slug}`
    const reverseSlug = `${b.model.slug}-vs-${a.model.slug}`
    if (seenSlugs.has(slug) || seenSlugs.has(reverseSlug)) {
      throw new Error(`Model comparison slug ${slug} collides with another pair`)
    }
    seenSlugs.add(slug)
    seenSlugs.add(reverseSlug)

    return {
      slug,
      href: `/models/compare/${slug}`,
      title: `${a.model.displayName} vs ${b.model.displayName}`,
      a,
      b,
    }
  })
}

/** Every curated comparison, in {@link MODEL_COMPARISON_PAIRS} order. */
export const MODEL_COMPARISONS: ModelComparison[] = buildComparisons()

/** Page title for a comparison, as specific as the 60-character `<title>` budget allows. */
export function getComparisonPageTitle(comparison: ModelComparison): string {
  return fitWithinLength(
    [
      `${comparison.title}: API Pricing & Context Window`,
      `${comparison.title}: API Pricing & Specs`,
      `${comparison.title} API Pricing`,
      comparison.title,
    ],
    MAX_PAGE_TITLE_LENGTH
  )
}

/** Meta description for a comparison page; long model names drop the trailing Sim sentence. */
export function getComparisonPageDescription(comparison: ModelComparison): string {
  const lead = `${comparison.title}: API pricing per 1M tokens, context window, max output, and capabilities side by side.`
  return fitWithinLength([`${lead} Use either in Sim's AI agents.`, lead], 155)
}

/** The curated comparison at `/models/compare/{slug}`; `null` for a reversed or unknown pair. */
export function getModelComparisonBySlug(slug: string): ModelComparison | null {
  return MODEL_COMPARISONS.find((comparison) => comparison.slug === slug) ?? null
}

/** Curated comparisons that include the given model, in curated order. */
export function getModelComparisonsFor(model: CatalogModel): ModelComparison[] {
  return MODEL_COMPARISONS.filter(
    (comparison) => comparison.a.model.href === model.href || comparison.b.model.href === model.href
  )
}

/** Latest pricing update across both models in a comparison. */
export function getComparisonUpdatedAt(comparison: ModelComparison): Date {
  return getLatestModelUpdate([comparison.a.model, comparison.b.model])
}

/**
 * Dollar cost of the sample workload. Rates resolve per call, so a long-context tier applies only
 * when one call's input crosses its threshold, never because of the workload's total volume.
 */
function sampleWorkloadCost(model: CatalogModel): number {
  const rates = resolveModelTokenPricing(model.pricing, SAMPLE_INPUT_TOKENS_PER_CALL)
  const costPerCall =
    (rates.input * SAMPLE_INPUT_TOKENS_PER_CALL + rates.output * SAMPLE_OUTPUT_TOKENS_PER_CALL) /
    1_000_000
  return SAMPLE_CALLS * costPerCall
}

/** "3×", "1.5×" - a multiple rounded for reading, never shown below the same-ratio band. */
function formatRatio(ratio: number): string {
  const rounded = ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10
  return `${rounded}×`
}

/** Larger value over smaller, or null when either side is missing or zero. */
function ratioOf(left: number | null | undefined, right: number | null | undefined) {
  if (!left || !right) return null
  return Math.max(left, right) / Math.min(left, right)
}

function supportsReasoning(model: CatalogModel): boolean {
  return Boolean(model.capabilities.reasoningEffort || model.capabilities.thinking)
}

const CAPABILITY_CHECKS: ReadonlyArray<{
  label: string
  supports: (model: CatalogModel) => boolean
}> = [
  { label: 'configurable reasoning', supports: supportsReasoning },
  {
    label: 'tool choice control',
    supports: (model) => Boolean(model.capabilities.toolUsageControl),
  },
  {
    label: 'native structured outputs',
    supports: (model) => Boolean(model.capabilities.nativeStructuredOutputs),
  },
  { label: 'computer use', supports: (model) => Boolean(model.capabilities.computerUse) },
  { label: 'deep research', supports: (model) => Boolean(model.capabilities.deepResearch) },
]

function buildCostSentence({ a, b }: ModelComparison): string {
  const costA = sampleWorkloadCost(a.model)
  const costB = sampleWorkloadCost(b.model)
  const workload = `${SAMPLE_CALLS.toLocaleString('en-US')} agent calls with ${formatTokenCount(SAMPLE_INPUT_TOKENS_PER_CALL)} input and ${formatTokenCount(SAMPLE_OUTPUT_TOKENS_PER_CALL)} output tokens each`
  const ratio = ratioOf(costA, costB)

  if (ratio === null || ratio < SAME_RATIO_THRESHOLD) {
    return `${a.model.displayName} and ${b.model.displayName} cost about the same: ${workload} cost ${formatPrice(costA)} and ${formatPrice(costB)} at standard rates.`
  }

  const [cheaper, pricier] = costA < costB ? [a, b] : [b, a]
  return `${cheaper.model.displayName} is ${formatRatio(ratio)} cheaper than ${pricier.model.displayName}: ${workload} cost ${formatPrice(sampleWorkloadCost(cheaper.model))} versus ${formatPrice(sampleWorkloadCost(pricier.model))} at standard rates.`
}

function buildRateSentence({ a, b }: ModelComparison): string {
  return `${a.model.displayName} charges ${formatPrice(a.model.pricing.input)} input and ${formatPrice(a.model.pricing.output)} output per 1M tokens; ${b.model.displayName} charges ${formatPrice(b.model.pricing.input)} and ${formatPrice(b.model.pricing.output)}.`
}

function buildContextSentence({ a, b }: ModelComparison): string {
  const contextA = a.model.contextWindow
  const contextB = b.model.contextWindow

  if (contextA && contextB) {
    const ratio = ratioOf(contextA, contextB) ?? 1
    if (ratio < SAME_RATIO_THRESHOLD) {
      return contextA === contextB
        ? `Both models have a ${formatTokenCount(contextA)} token context window.`
        : `Their context windows are about the same size: ${formatTokenCount(contextA)} versus ${formatTokenCount(contextB)} tokens.`
    }
    const [larger, smaller] = contextA > contextB ? [a, b] : [b, a]
    return `${larger.model.displayName} has a ${formatRatio(ratio)} larger context window: ${formatTokenCount(larger.model.contextWindow)} versus ${formatTokenCount(smaller.model.contextWindow)} tokens.`
  }

  const known = contextA ? a : contextB ? b : null
  return known
    ? `${known.model.displayName} has a ${formatTokenCount(known.model.contextWindow)} token context window; Sim does not track a published context window for the other model.`
    : 'Sim does not track a published context window for either model.'
}

function buildMaxOutputSentence({ a, b }: ModelComparison): string | null {
  const outputA = getEffectiveMaxOutputTokens(a.model.capabilities)
  const outputB = getEffectiveMaxOutputTokens(b.model.capabilities)
  if (!outputA || !outputB) return null
  if (outputA === outputB) {
    return `Both can generate up to ${formatTokenCount(outputA)} output tokens per response.`
  }
  const [larger, largerOutput, smallerOutput] =
    outputA > outputB ? [a, outputA, outputB] : [b, outputB, outputA]
  return `${larger.model.displayName} can generate up to ${formatTokenCount(largerOutput)} output tokens per response, versus ${formatTokenCount(smallerOutput)}.`
}

function buildCapabilitySentence({ a, b }: ModelComparison): string {
  const onlyA = CAPABILITY_CHECKS.filter(
    (check) => check.supports(a.model) && !check.supports(b.model)
  )
  const onlyB = CAPABILITY_CHECKS.filter(
    (check) => check.supports(b.model) && !check.supports(a.model)
  )

  if (onlyA.length === 0 && onlyB.length === 0) {
    const shared = CAPABILITY_CHECKS.filter((check) => check.supports(a.model))
    return shared.length > 0
      ? `Both support ${joinLabels(shared.map((check) => check.label))} in Sim.`
      : 'Neither model exposes configurable reasoning, tool choice control, or native structured outputs in Sim.'
  }

  return [
    onlyA.length > 0
      ? `Only ${a.model.displayName} supports ${joinLabels(onlyA.map((check) => check.label))} in Sim.`
      : null,
    onlyB.length > 0
      ? `Only ${b.model.displayName} supports ${joinLabels(onlyB.map((check) => check.label))} in Sim.`
      : null,
  ]
    .filter(Boolean)
    .join(' ')
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 2) return labels.join(' and ')
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`
}

/**
 * Plain-language verdict computed from catalog data: relative cost on a sample agent workload,
 * per-token rates, context window, max output, and capability differences.
 */
export function buildComparisonVerdict(comparison: ModelComparison): string[] {
  return [
    buildCostSentence(comparison),
    buildRateSentence(comparison),
    buildContextSentence(comparison),
    buildMaxOutputSentence(comparison),
    buildCapabilitySentence(comparison),
  ].filter((sentence): sentence is string => sentence !== null)
}

/** FAQ entries for a comparison page, built from the same sentences as the verdict. */
export function buildComparisonFaqs(comparison: ModelComparison): CatalogFaq[] {
  const { a, b } = comparison
  const [cheaper, pricier] =
    sampleWorkloadCost(a.model) <= sampleWorkloadCost(b.model) ? [a, b] : [b, a]

  return [
    {
      question: `Is ${a.model.displayName} cheaper than ${b.model.displayName}?`,
      answer: `${buildCostSentence(comparison)} ${buildRateSentence(comparison)}`,
    },
    {
      question: `Which has a larger context window, ${a.model.displayName} or ${b.model.displayName}?`,
      answer: [buildContextSentence(comparison), buildMaxOutputSentence(comparison)]
        .filter(Boolean)
        .join(' '),
    },
    {
      question: `What is the difference between ${a.model.displayName} and ${b.model.displayName}?`,
      answer: buildComparisonVerdict(comparison).join(' '),
    },
    {
      question: `Can I use ${a.model.displayName} and ${b.model.displayName} in the same Sim agent?`,
      answer: `Yes. Both models are available in the Sim Agent block, and each Agent block selects its own model. One agent can run ${cheaper.model.displayName} on high-volume steps and ${pricier.model.displayName} on the steps that need it, and switching a block's model does not change the rest of the agent.`,
    },
  ]
}
