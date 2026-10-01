import { getErrorMessage } from '@sim/utils/errors'
import { omit } from '@sim/utils/object'
import { JSON_SCHEMA, load } from 'js-yaml'
import { z } from 'zod'
import { parseChartSpec } from '@/lib/charts/spec'
import { measureYamlExpansion } from '@/lib/file-parsers/yaml-limits'
import {
  type AnalyticsSelection,
  analyticsQuerySchema,
  analyticsSelectionSchema,
} from '@/lib/table/analytics/schema'

/** Dashboard YAML is bounded before parsing; writes report the same limit without decoding. */
export const MAX_DASHBOARD_SOURCE_BYTES = 128 * 1024
export const DASHBOARD_SOURCE_TOO_LARGE = 'Dashboard source exceeds 128 KB'

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

function queryMode(source: DashboardSource | undefined): 'columns' | 'aggregate' | undefined {
  return source?.columns ? 'columns' : source?.aggregate ? 'aggregate' : undefined
}

/**
 * A panel's source shallowly overrides the dashboard's. Choosing a query mode (`aggregate` or
 * `columns`) drops the other mode's inherited fields, so shared defaults serve both panel kinds.
 * Switching away from the dashboard's mode also drops its `sort` and `limit`, which name
 * aggregate aliases or top-N groups in one mode and rows in the other.
 */
export function resolveDashboardSource(
  defaults: DashboardSource | undefined,
  source: DashboardSource | undefined
): ResolvedDashboardSource {
  const mode = queryMode(source)
  const switched =
    mode !== undefined && queryMode(defaults) !== undefined && mode !== queryMode(defaults)
  const modeFields =
    mode === 'columns'
      ? (['aggregate', 'groupBy', 'bucket'] as const)
      : mode === 'aggregate'
        ? (['columns'] as const)
        : []
  const inherited = omit(defaults ?? {}, [
    ...modeFields,
    ...(switched ? (['sort', 'limit'] as const) : []),
  ])
  const merged = { ...inherited, ...source }
  if (!merged.tableId)
    throw new Error('A data panel requires source.tableId, on the dashboard or on the panel')
  return { ...merged, tableId: merged.tableId }
}

const BLOCK_KINDS = ['text', 'stat', 'chart', 'table', 'row', 'tabs'] as const

/**
 * One line per issue, `path: message`. A block reports the errors of the kind it declares; a
 * block that declares no kind says which kinds exist and which keys no kind accepts, instead of
 * Zod's per-branch union dump.
 */
function describeSchemaIssues(
  issues: readonly z.core.$ZodIssue[],
  prefix: PropertyKey[] = []
): string[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path]
    const at = path.length ? `${path.map(String).join('.')}: ` : ''
    if (issue.code !== 'invalid_union' || issue.errors.length === 0)
      return [`${at}${issue.message}`]
    const declared = issue.errors.find(
      (branch) =>
        !branch.some(
          (entry) =>
            entry.code === 'invalid_type' &&
            entry.path.length === 1 &&
            BLOCK_KINDS.some((kind) => kind === entry.path[0])
        )
    )
    const isBlock = issue.errors.some((branch) =>
      branch.some((entry) => entry.path.length === 1 && entry.path[0] === 'text')
    )
    if (!isBlock || declared) {
      const branch =
        declared ??
        issue.errors.reduce((fewest, next) => (next.length < fewest.length ? next : fewest))
      return describeSchemaIssues(branch, path)
    }
    const rejected = issue.errors.map(
      (branch) =>
        new Set(
          branch.flatMap((entry) =>
            entry.code === 'unrecognized_keys' && entry.path.length === 0 ? entry.keys : []
          )
        )
    )
    const unknown = [...rejected[0]].filter((key) => rejected.every((keys) => keys.has(key)))
    const keys = unknown.map((key) => `"${key}"`).join(', ')
    return [
      `${at}expected a block with one of ${BLOCK_KINDS.join(', ')}${keys ? `; unknown key ${keys}` : ''}`,
    ]
  })
}

/** Strict YAML validation, including expansion limits before recursive parsing. */
export function parseDashboardSpec(
  content: string
): { spec: DashboardSpec; error?: never } | { error: string; spec?: never } {
  try {
    if (new TextEncoder().encode(content).byteLength > MAX_DASHBOARD_SOURCE_BYTES)
      throw new Error(DASHBOARD_SOURCE_TOO_LARGE)
    const raw: unknown = load(content, { schema: JSON_SCHEMA })
    const measured = measureYamlExpansion(raw, {
      maxNodes: 10000,
      maxDepth: 24,
      maxSerializedBytes: 256 * 1024,
    })
    if (!measured.within) throw new Error(measured.reason)
    const parsed = dashboardSchema.safeParse(raw)
    if (!parsed.success) throw new Error(describeSchemaIssues(parsed.error.issues).join('\n'))
    const spec = parsed.data
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
