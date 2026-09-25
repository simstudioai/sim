import { getErrorMessage } from '@sim/utils/errors'
import { JSON_SCHEMA, load } from 'js-yaml'
import { z } from 'zod'
import { parseChartSpec } from '@/lib/charts/spec'
import { measureYamlExpansion } from '@/lib/file-parsers/yaml-limits'
import {
  type AnalyticsSelection,
  analyticsQuerySchema,
  analyticsSelectionSchema,
} from '@/lib/table/analytics/schema'

export const DASHBOARD_RANGES = ['1h', '24h', '7d', '30d', '90d'] as const
export type DashboardRange = (typeof DASHBOARD_RANGES)[number]
const rangeSchema = z.enum(DASHBOARD_RANGES)
const titleSchema = z.string().min(1).max(160)
export const dashboardSourceSchema = analyticsSelectionSchema
  .extend({
    tableId: z.string().min(1).max(128).optional(),
    range: rangeSchema.optional(),
  })
  .strict()
export type DashboardSource = z.output<typeof dashboardSourceSchema>
export type ResolvedDashboardSource = DashboardSource & { tableId: string }

interface BlockBase {
  flex?: number
}
export interface DashboardText extends BlockBase {
  text: string
}
export interface DashboardStat extends BlockBase {
  stat: string
  source?: DashboardSource
  unit?: string
}
export interface DashboardChart extends BlockBase {
  chart: string
  source?: DashboardSource
  option: Record<string, unknown>
}
export interface DashboardTable extends BlockBase {
  table: string
  source?: DashboardSource
}
export interface DashboardRow extends BlockBase {
  row: DashboardBlock[]
}
export interface DashboardTabs extends BlockBase {
  tabs: Record<string, DashboardBlock[]>
}
export type DashboardDataBlock = DashboardStat | DashboardChart | DashboardTable
export type DashboardBlock = DashboardText | DashboardDataBlock | DashboardRow | DashboardTabs
export interface DashboardSpec {
  title: string
  time?: DashboardRange
  source?: DashboardSource
  blocks: DashboardBlock[]
}

const base = { flex: z.number().int().min(1).max(12).optional() }
const source = { ...base, source: dashboardSourceSchema.optional() }
const blockSchema: z.ZodType<DashboardBlock> = z.lazy(() =>
  z.union([
    z.object({ ...base, text: z.string().min(1).max(10000) }).strict(),
    z.object({ ...source, stat: titleSchema, unit: z.string().max(24).optional() }).strict(),
    z.object({ ...source, chart: titleSchema, option: z.record(z.string(), z.unknown()) }).strict(),
    z.object({ ...source, table: titleSchema }).strict(),
    z.object({ ...base, row: z.array(blockSchema).min(1).max(12) }).strict(),
    z
      .object({
        ...base,
        tabs: z
          .record(titleSchema, z.array(blockSchema).min(1).max(48))
          .refine(
            (tabs) => Object.keys(tabs).length >= 1 && Object.keys(tabs).length <= 8,
            'Use 1–8 tabs'
          ),
      })
      .strict(),
  ])
)
const dashboardSchema: z.ZodType<DashboardSpec> = z
  .object({
    title: titleSchema,
    time: rangeSchema.optional(),
    source: dashboardSourceSchema.optional(),
    blocks: z.array(blockSchema).min(1).max(48),
  })
  .strict()

export function resolveDashboardSource(
  defaults: DashboardSource | undefined,
  source: DashboardSource | undefined
): ResolvedDashboardSource {
  const merged = { ...defaults, ...source }
  if (!merged.tableId)
    throw new Error('A data panel requires source.tableId, on the dashboard or on the panel')
  return { ...merged, tableId: merged.tableId }
}

/** Strict YAML validation, including expansion limits before recursive parsing. */
export function parseDashboardSpec(
  content: string
): { spec: DashboardSpec; error?: never } | { error: string; spec?: never } {
  try {
    if (new TextEncoder().encode(content).byteLength > 128 * 1024)
      throw new Error('Dashboard source exceeds 128 KB')
    const raw: unknown = load(content, { schema: JSON_SCHEMA })
    const measured = measureYamlExpansion(raw, {
      maxNodes: 10000,
      maxDepth: 24,
      maxSerializedBytes: 256 * 1024,
    })
    if (!measured.within) throw new Error(measured.reason)
    const spec = dashboardSchema.parse(raw)
    let count = 0
    const visit = (blocks: DashboardBlock[], depth: number): void => {
      if (depth > 4) throw new Error('Dashboard layout exceeds 4 levels')
      for (const block of blocks) {
        if (++count > 48) throw new Error('Dashboard exceeds 48 blocks')
        if ('row' in block) visit(block.row, depth + 1)
        else if ('tabs' in block)
          Object.values(block.tabs).forEach((children) => visit(children, depth + 1))
        else if (!('text' in block)) {
          const resolved = resolveDashboardSource(spec.source, block.source)
          const { tableId: _tableId, range: _range, ...selection } = resolved
          const parsed = analyticsQuerySchema.safeParse({
            ...selection,
            from: '2026-01-01T00:00:00Z',
            to: '2026-01-02T00:00:00Z',
          })
          if (!parsed.success)
            throw new Error(parsed.error.issues.map((issue) => issue.message).join('; '))
          if (
            'stat' in block &&
            (!selection.aggregate ||
              Object.keys(selection.aggregate).length !== 1 ||
              selection.groupBy)
          ) {
            throw new Error(`Stat "${block.stat}" requires exactly one aggregate and no groupBy`)
          }
          if ('chart' in block) {
            const chart = parseChartSpec(
              JSON.stringify({ schema_version: 1, option: block.option })
            )
            if (!chart.spec) throw new Error(chart.error)
            block.option = chart.spec.option
          }
        }
      }
    }
    visit(spec.blocks, 1)
    return { spec }
  } catch (error) {
    return { error: getErrorMessage(error, 'Invalid dashboard') }
  }
}

export function dashboardSelection(source: ResolvedDashboardSource): AnalyticsSelection {
  const { tableId: _tableId, range: _range, ...selection } = source
  return selection
}
