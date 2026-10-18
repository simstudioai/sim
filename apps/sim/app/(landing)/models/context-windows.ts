import { compareStrings } from '@sim/utils/string'
import {
  ALL_CATALOG_MODELS,
  type CatalogFaq,
  type CatalogModel,
  type CatalogProvider,
  compareByContextWindow,
  formatTokenCount,
  getLargestContextProviderModel,
  isPromptModel,
  MODEL_PROVIDERS_WITH_CATALOGS,
} from '@/app/(landing)/models/utils'

/**
 * Callable first-party prompt models with a published context window, ordered by
 * {@link compareByContextWindow}. Retired models are left out: their API calls fail.
 */
export const CONTEXT_WINDOW_MODELS: CatalogModel[] = ALL_CATALOG_MODELS.filter(
  (model) =>
    isPromptModel(model) &&
    !model.retired &&
    model.contextWindow !== null &&
    model.contextWindow > 0
).sort(compareByContextWindow)

/** Distinct providers across {@link CONTEXT_WINDOW_MODELS}. */
export const CONTEXT_WINDOW_PROVIDER_COUNT = new Set(
  CONTEXT_WINDOW_MODELS.map((model) => model.providerId)
).size

/**
 * Providers whose context windows get their own FAQ entry, in the order searchers ask about them.
 * `label` overrides the model family in the question when the family name would undercount the
 * lineup (OpenAI lists o-series models alongside GPT).
 */
const CONTEXT_WINDOW_FAQ_PROVIDERS: ReadonlyArray<{ id: string; label?: string }> = [
  { id: 'anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google' },
  { id: 'xai' },
  { id: 'deepseek' },
]

/**
 * Providers on the comparison, each with the same largest-context model its provider page's FAQ
 * names ({@link getLargestContextProviderModel}).
 */
export function getLargestContextByProvider(): Array<{
  provider: CatalogProvider
  model: CatalogModel
}> {
  return MODEL_PROVIDERS_WITH_CATALOGS.flatMap((provider) => {
    if (!CONTEXT_WINDOW_MODELS.some((entry) => entry.providerId === provider.id)) return []
    const model = getLargestContextProviderModel(provider)
    return model ? [{ provider, model }] : []
  })
}

/** FAQ entries for the context-window page: the overall largest window, then per-provider ranges. */
export function buildContextWindowFaqs(): CatalogFaq[] {
  const largest = CONTEXT_WINDOW_MODELS[0]
  const faqs: CatalogFaq[] = []

  if (largest?.contextWindow) {
    const tiedCount = CONTEXT_WINDOW_MODELS.filter(
      (model) => model.contextWindow === largest.contextWindow
    ).length
    faqs.push({
      question: 'Which LLM has the largest context window?',
      answer: `The largest context window tracked in Sim is ${formatTokenCount(largest.contextWindow)} tokens, on ${largest.displayName} by ${largest.providerName}${tiedCount > 1 ? ` and ${tiedCount - 1} other model${tiedCount === 2 ? '' : 's'}` : ''}. Sim tracks context windows for ${CONTEXT_WINDOW_MODELS.length} models across ${CONTEXT_WINDOW_PROVIDER_COUNT} providers.`,
    })
  }

  for (const { id, label } of CONTEXT_WINDOW_FAQ_PROVIDERS) {
    const provider = MODEL_PROVIDERS_WITH_CATALOGS.find((entry) => entry.id === id)
    const models = CONTEXT_WINDOW_MODELS.filter((model) => model.providerId === id)
    if (!provider || models.length === 0) continue

    const name = label ?? provider.modelFamily
    const top = models[0]
    const smallest = models[models.length - 1]
    const recent = models
      .filter((model) => !model.deprecated)
      .sort((a, b) => compareStrings(b.releaseDate ?? '', a.releaseDate ?? ''))
      .slice(0, 3)
    const range =
      top.contextWindow === smallest.contextWindow
        ? `Every ${name} model tracked in Sim has a ${formatTokenCount(top.contextWindow)} token context window.`
        : `${name} context windows tracked in Sim range from ${formatTokenCount(smallest.contextWindow)} to ${formatTokenCount(top.contextWindow)} tokens.`

    faqs.push({
      question: `What is the ${name} context window?`,
      answer: `${range}${
        recent.length > 0
          ? ` Recent models: ${recent
              .map(
                (model) => `${model.displayName} (${formatTokenCount(model.contextWindow)} tokens)`
              )
              .join(', ')}.`
          : ''
      }`,
    })
  }

  faqs.push({
    question: 'What is the difference between context window and max output tokens?',
    answer:
      'The context window is the total number of tokens a model can work with in one call: the system prompt, conversation history, tool results, and documents you pass in. Max output tokens caps how much the model can generate in a single response. In a Sim agent, a larger context window holds more history and retrieved documents, while a larger max output lets one response carry a long report or a large block of code.',
  })

  return faqs
}
