import {
  ALL_CATALOG_MODELS,
  type CatalogModel,
  isPromptModel,
  MODEL_PROVIDERS_WITH_CATALOGS,
} from '@/app/(landing)/models/utils'

/** A free tool page under `/models`, linked from the directory, sitemap, and llms.txt. */
interface ModelTool {
  name: string
  href: string
  description: string
}

/** The free tools under `/models`, keyed so pages can link a specific tool; iterate with `Object.values`. */
export const MODEL_TOOLS = {
  pricingCalculator: {
    name: 'LLM API pricing calculator',
    href: '/models/pricing-calculator',
    description:
      'Estimate cost per request and per month across OpenAI, Claude, Gemini, and other models',
  },
  tokenCounter: {
    name: 'Token counter',
    href: '/models/token-counter',
    description: 'Count tokens and estimate input cost for pasted text, in the browser',
  },
} as const satisfies Record<string, ModelTool>

/** Every current first-party prompt model; deprecated and evaluation models drop out of the pickers. */
export const TOOL_MODELS: CatalogModel[] = ALL_CATALOG_MODELS.filter(
  (model) => isPromptModel(model) && !model.deprecated
)

const TOOL_MODELS_BY_ID = new Map(TOOL_MODELS.map((model) => [model.id, model]))

/** Selected model ids resolved to catalog models, deduplicated, unknown ids dropped. */
export function resolveToolModels(ids: readonly string[]): CatalogModel[] {
  return [...new Set(ids)]
    .map((id) => TOOL_MODELS_BY_ID.get(id))
    .filter((model): model is CatalogModel => model !== undefined)
}

const DEFAULT_TOOL_PROVIDER_IDS = ['openai', 'anthropic', 'google']

/** The lead model of each top provider, matching the featured cards on `/models`. */
export const DEFAULT_TOOL_MODEL_IDS: string[] = DEFAULT_TOOL_PROVIDER_IDS.flatMap((providerId) => {
  const provider = MODEL_PROVIDERS_WITH_CATALOGS.find((entry) => entry.id === providerId)
  const lead = provider?.featuredModels.find((model) => !model.deprecated)
  return lead ? [lead.id] : []
})

/** Latest pricing `updatedAt` across the tool models, as an ISO date. */
export const TOOL_PRICING_UPDATED_AT: string = TOOL_MODELS.reduce(
  (latest, model) => (model.pricing.updatedAt > latest ? model.pricing.updatedAt : latest),
  ''
)

const USD_CENTS_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const USD_SUB_DOLLAR_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumSignificantDigits: 2,
  maximumSignificantDigits: 3,
})

/** Formats a USD amount: cents from a dollar up, three significant digits below a dollar. */
export function formatUsd(value: number): string {
  if (value === 0) return '$0'
  return value >= 1 ? USD_CENTS_FORMAT.format(value) : USD_SUB_DOLLAR_FORMAT.format(value)
}
