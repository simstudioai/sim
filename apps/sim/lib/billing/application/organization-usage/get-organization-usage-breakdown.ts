import { defineAuthorizedOrganizationUsageUseCase } from '@/lib/billing/application/organization-usage/authorized-organization-usage-use-case'
import { organizationUsageOperations } from '@/lib/billing/application/organization-usage/operations'
import {
  buildUsageAnalyticsScope,
  foldUsageBreakdown,
  type MergeableRow,
  mergeRowsByKey,
  resolveUsageAnalyticsWindow,
  USAGE_NULL_KEY_LABELS,
  type UsageBreakdownDimension,
  type UsageWindowPreset,
} from '@/lib/billing/core/usage-analytics'
import {
  readUsageBreakdown,
  readUsageEntityNames,
} from '@/lib/billing/core/usage-analytics-queries'
import { dollarsToCredits } from '@/lib/billing/credits/conversion'
import {
  BILLING_USAGE_LOG_SOURCE_LABELS,
  type InternalUsageLogSource,
  toBillingUsageLogSource,
} from '@/lib/billing/usage-sources'
import { getProviderFromModel } from '@/providers/models'

export interface OrganizationUsageBreakdownInput {
  organizationId: string
  dimension: UsageBreakdownDimension
  preset: UsageWindowPreset
  startDate?: Date
  endDate?: Date
  /** Narrows to one workspace, for the Workspaces drill-down. */
  workspaceId?: string
  limit: number
}

export interface OrganizationUsageBreakdownRow {
  id: string
  label: string
  credits: number
  events: number
  share: number
  providerId?: string
  tokens?: number
}

export interface OrganizationUsageBreakdownResult {
  dimension: UsageBreakdownDimension
  rows: OrganizationUsageBreakdownRow[]
  other: { credits: number; events: number; rowCount: number }
  totalCredits: number
}

/** Entity-backed dimensions need a second lookup to turn ids into names. */
const NAMED_DIMENSIONS = new Set<UsageBreakdownDimension>(['member', 'workspace', 'workflow'])

/** Provider ids that read better with their conventional casing. */
const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  'azure-openai': 'Azure OpenAI',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  groq: 'Groq',
  cerebras: 'Cerebras',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  mistral: 'Mistral',
}

function providerLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId
}

export const getOrganizationUsageBreakdown = defineAuthorizedOrganizationUsageUseCase({
  operation: organizationUsageOperations.readBreakdown,
  organizationId: (input: OrganizationUsageBreakdownInput) => input.organizationId,
  async execute({ input, context }): Promise<OrganizationUsageBreakdownResult> {
    const window = resolveUsageAnalyticsWindow({
      preset: input.preset,
      period: context.period,
      customStart: input.startDate,
      customEnd: input.endDate,
    })
    const scope = buildUsageAnalyticsScope(context.billingEntity, window)
    const raw = await readUsageBreakdown(scope, input.dimension, input.workspaceId)

    /**
     * Re-key onto what the panel actually displays before ranking.
     *
     * Two dimensions are coarser than their SQL grouping column: `source` shows one
     * "Sim Chat" row for the ledger's `copilot` *and* `workspace-chat`, and `byok`
     * shows one row per provider rather than per model. Ranking the raw rows would
     * render the same label twice with the total split between them.
     */
    const rows: MergeableRow[] =
      input.dimension === 'source'
        ? mergeRowsByKey(raw, (key) =>
            key ? toBillingUsageLogSource(key as InternalUsageLogSource) : null
          )
        : input.dimension === 'byok'
          ? mergeRowsByKey(raw, (key) => (key ? getProviderFromModel(key) : null))
          : raw

    const totalCost = rows.reduce((sum, row) => sum + (Number(row.cost) || 0), 0)

    /**
     * Names are hydrated for the surviving keys only — joining inside the aggregate
     * would break the index-only scan the member dimension depends on.
     *
     * Sorted before slicing: the breakdown query only groups, so Postgres returns its
     * aggregate in arbitrary order. Slicing that directly hydrated an arbitrary subset
     * while the fold below ranks by cost, so a top row whose name was never fetched
     * fell through to `?? key` and rendered a raw id. The margin over `limit` covers
     * the fold's label tiebreak pulling in a row just past the cut.
     */
    const rankedIds = [...rows]
      .sort((left, right) => Number(right.cost) - Number(left.cost))
      .slice(0, input.limit * 2)
      .map((row) => row.key)
      .filter((key): key is string => Boolean(key))
    const names = NAMED_DIMENSIONS.has(input.dimension)
      ? await readUsageEntityNames(input.dimension, rankedIds)
      : new Map<string, string>()

    const labelFor = (key: string | null): string => {
      /**
       * A null key means something different per dimension, and one shared
       * "Unattributed" label got both wrong: on Workspaces it is usage owned by no
       * workspace, on Workflows it is usage that never came from a workflow — which
       * is most of an organization's spend, and reading it as an attribution failure
       * is what made that list useless.
       */
      if (!key) return USAGE_NULL_KEY_LABELS[input.dimension]
      if (input.dimension === 'source') {
        return BILLING_USAGE_LOG_SOURCE_LABELS[key as keyof typeof BILLING_USAGE_LOG_SOURCE_LABELS]
      }
      if (input.dimension === 'byok') return providerLabel(key)
      if (input.dimension === 'model') return key
      // A deleted workspace or workflow nulls its id on the ledger row, so a key that
      // resolves to no name is a live entity we could not read — not a deleted one.
      return names.get(key) ?? key
    }

    const fold = foldUsageBreakdown(rows, totalCost, labelFor, input.limit)
    const tokensByKey = new Map(
      rows.map((row) => [row.key ?? '', (row.inputTokens ?? 0) + (row.outputTokens ?? 0)])
    )
    const isModelDimension = input.dimension === 'model' || input.dimension === 'byok'

    return {
      dimension: input.dimension,
      rows: fold.rows.map((row) => {
        const tokens = tokensByKey.get(row.id) ?? 0
        return {
          id: row.id,
          label: row.label,
          credits: dollarsToCredits(row.cost),
          events: row.events,
          share: row.share,
          ...(isModelDimension && tokens > 0 ? { tokens } : {}),
          ...(input.dimension === 'byok' ? { providerId: row.id } : {}),
          ...(input.dimension === 'model' && row.id
            ? { providerId: getProviderFromModel(row.id) }
            : {}),
        }
      }),
      other: {
        credits: dollarsToCredits(fold.other.cost),
        events: fold.other.events,
        rowCount: fold.other.rowCount,
      },
      totalCredits: dollarsToCredits(fold.totalCost),
    }
  },
})
