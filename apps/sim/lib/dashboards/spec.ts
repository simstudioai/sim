import { getErrorMessage } from '@sim/utils/errors'
import { omit } from '@sim/utils/object'
import { JSON_SCHEMA, load } from 'js-yaml'
import { z } from 'zod'
import {
  assertAnnotatable,
  CHART_TONES,
  type ChartHighlight,
  type ChartThreshold,
  valueAxisKey,
} from '@/lib/charts/annotations'
import { isTimeSeriesOption, parseChartSpec } from '@/lib/charts/spec'
import {
  type DashboardTimeRange,
  parseDashboardCustomRange,
  parseDashboardInstant,
} from '@/lib/dashboards/time'
import { measureYamlExpansion } from '@/lib/file-parsers/yaml-limits'
import {
  type AnalyticsSelection,
  analyticsQuerySchema,
  analyticsSelectionSchema,
} from '@/lib/table/analytics/schema'

/** Dashboard YAML is bounded before parsing; writes report the same limit without decoding. */
export const MAX_DASHBOARD_SOURCE_BYTES = 128 * 1024
const MAX_DASHBOARD_EMBED_SOURCE_BYTES = 32 * 1024
const MAX_DASHBOARD_EMBED_BLOCKS = 12
export const DASHBOARD_SOURCE_TOO_LARGE = 'Dashboard source exceeds 128 KB'

export const DASHBOARD_RANGES = ['1h', '24h', '7d', '30d', '90d'] as const
export type DashboardRange = (typeof DASHBOARD_RANGES)[number]
const rangeSchema = z.enum(DASHBOARD_RANGES)
/** A relative preset, or fixed instants for a chart that must not slide with the clock. */
export type DashboardTime = DashboardRange | DashboardTimeRange
const timeSchema = z.union([
  rangeSchema,
  z
    .object({ from: z.string(), to: z.string() })
    .strict()
    .superRefine((value, ctx) => {
      try {
        parseDashboardCustomRange(value.from, value.to)
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: getErrorMessage(error, 'Invalid time range') })
      }
    }),
])
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
  thresholds?: ChartThreshold[]
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
  time?: DashboardTime
  source?: DashboardSource
  /** Time bands and instants drawn on every time-series chart. */
  highlights?: ChartHighlight[]
  blocks: DashboardBlock[]
}
export type DashboardEmbedBlock = DashboardDataBlock | DashboardEmbedRow
export interface DashboardEmbedRow extends BlockBase {
  row: DashboardEmbedBlock[]
}
/** A dashboard fragment inside markdown: the surrounding document supplies text and structure. */
export interface DashboardEmbedSpec {
  title?: string
  time?: DashboardTime
  source?: DashboardSource
  highlights?: ChartHighlight[]
  blocks: DashboardEmbedBlock[]
}

const toneSchema = z.enum(CHART_TONES)
const annotationLabelSchema = z.string().min(1).max(80)
/** Instants are normalized to ISO with `Z` so the canvas never reads them as local time. */
const instantSchema = z.string().transform((value, ctx) => {
  try {
    return parseDashboardInstant(value)
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: getErrorMessage(error, 'Invalid time') })
    return z.NEVER
  }
})
const highlightSchema = z.union([
  z
    .object({
      from: instantSchema,
      to: instantSchema,
      label: annotationLabelSchema.optional(),
      tone: toneSchema.optional(),
    })
    .strict()
    .refine((value) => value.from < value.to, 'A highlight must start before it ends'),
  z
    .object({
      at: instantSchema,
      label: annotationLabelSchema.optional(),
      tone: toneSchema.optional(),
    })
    .strict(),
])
const highlightsSchema = z.array(highlightSchema).min(1).max(20)
const thresholdSchema = z
  .object({
    value: z.number().finite(),
    label: annotationLabelSchema.optional(),
    tone: toneSchema.optional(),
  })
  .strict()

const base = { flex: z.number().int().min(1).max(12).optional() }
const source = { ...base, source: dashboardSourceSchema.optional() }
const dataBlockSchemas = [
  z.object({ ...source, stat: titleSchema, unit: z.string().max(24).optional() }).strict(),
  z
    .object({
      ...source,
      chart: titleSchema,
      option: z.record(z.string(), z.unknown()),
      thresholds: z.array(thresholdSchema).min(1).max(5).optional(),
    })
    .strict(),
  z.object({ ...source, table: titleSchema }).strict(),
] as const
const blockSchema: z.ZodType<DashboardBlock> = z.lazy(() =>
  z.union([
    z.object({ ...base, text: z.string().min(1).max(10000) }).strict(),
    ...dataBlockSchemas,
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
    time: timeSchema.optional(),
    source: dashboardSourceSchema.optional(),
    highlights: highlightsSchema.optional(),
    blocks: z.array(blockSchema).min(1).max(48),
  })
  .strict()
const embedBlockSchema: z.ZodType<DashboardEmbedBlock> = z.lazy(() =>
  z.union([
    ...dataBlockSchemas,
    z.object({ ...base, row: z.array(embedBlockSchema).min(1).max(12) }).strict(),
  ])
)
const dashboardEmbedSchema: z.ZodType<DashboardEmbedSpec> = z
  .object({
    title: titleSchema.optional(),
    time: timeSchema.optional(),
    source: dashboardSourceSchema.optional(),
    highlights: highlightsSchema.optional(),
    blocks: z.array(embedBlockSchema).min(1).max(MAX_DASHBOARD_EMBED_BLOCKS),
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
const EMBED_BLOCK_KINDS = ['stat', 'chart', 'table', 'row'] as const

/**
 * One line per issue, `path: message`. A block reports the errors of the kind it declares; a
 * block that declares no kind says which kinds exist and which keys no kind accepts, instead of
 * Zod's per-branch union dump.
 */
function describeSchemaIssues(
  issues: readonly z.core.$ZodIssue[],
  kinds: readonly string[],
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
            kinds.some((kind) => kind === entry.path[0])
        )
    )
    const isBlock = issue.errors.some((branch) =>
      branch.some((entry) => entry.path.length === 1 && entry.path[0] === kinds[0])
    )
    if (!isBlock || declared) {
      const branch =
        (isBlock ? declared : undefined) ??
        issue.errors.reduce((fewest, next) => (next.length < fewest.length ? next : fewest))
      return describeSchemaIssues(branch, kinds, path)
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
      `${at}expected a block with one of ${kinds.join(', ')}${keys ? `; unknown key ${keys}` : ''}`,
    ]
  })
}

type ParseResult<T> = { spec: T; error?: never } | { error: string; spec?: never }

/** Bounded YAML decoding: byte size and expansion limits before recursive schema parsing. */
function loadBoundedYaml(content: string, maxBytes: number, tooLarge: string): unknown {
  if (new TextEncoder().encode(content).byteLength > maxBytes) throw new Error(tooLarge)
  const raw: unknown = load(content, { schema: JSON_SCHEMA })
  const measured = measureYamlExpansion(raw, {
    maxNodes: 10000,
    maxDepth: 24,
    maxSerializedBytes: 256 * 1024,
  })
  if (!measured.within) throw new Error(measured.reason)
  return raw
}

/**
 * Validates each data block's resolved query and sanitizes chart options in place. Limits nesting
 * and the total block count, including nested rows and tabs.
 */
function validateDashboardBlocks(
  blocks: DashboardBlock[],
  defaults: DashboardSource | undefined,
  maxBlocks: number,
  highlights: ChartHighlight[] | undefined
): void {
  let count = 0
  const visit = (children: DashboardBlock[], depth: number): void => {
    if (depth > 4) throw new Error('Dashboard layout exceeds 4 levels')
    for (const block of children) {
      if (++count > maxBlocks) throw new Error(`Dashboard exceeds ${maxBlocks} blocks`)
      if ('row' in block) visit(block.row, depth + 1)
      else if ('tabs' in block) Object.values(block.tabs).forEach((tab) => visit(tab, depth + 1))
      else if (!('text' in block)) {
        const resolved = resolveDashboardSource(defaults, block.source)
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
          const chart = parseChartSpec(JSON.stringify({ schema_version: 1, option: block.option }))
          if (!chart.spec) throw new Error(chart.error)
          block.option = chart.spec.option
          if (block.thresholds) valueAxisKey(block.option)
          if (block.thresholds || (highlights && isTimeSeriesOption(block.option)))
            assertAnnotatable(block.option)
        }
      }
    }
  }
  visit(blocks, 1)
}

/** Strict YAML validation, including expansion limits before recursive parsing. */
export function parseDashboardSpec(content: string): ParseResult<DashboardSpec> {
  try {
    const raw = loadBoundedYaml(content, MAX_DASHBOARD_SOURCE_BYTES, DASHBOARD_SOURCE_TOO_LARGE)
    const parsed = dashboardSchema.safeParse(raw)
    if (!parsed.success)
      throw new Error(describeSchemaIssues(parsed.error.issues, BLOCK_KINDS).join('\n'))
    validateDashboardBlocks(parsed.data.blocks, parsed.data.source, 48, parsed.data.highlights)
    return { spec: parsed.data }
  } catch (error) {
    return { error: getErrorMessage(error, 'Invalid dashboard') }
  }
}

/** Parses a markdown ```dashboard fence body with the dashboard grammar, minus text and tabs. */
export function parseDashboardEmbed(content: string): ParseResult<DashboardEmbedSpec> {
  try {
    const raw = loadBoundedYaml(
      content,
      MAX_DASHBOARD_EMBED_SOURCE_BYTES,
      'Dashboard embed exceeds 32 KB'
    )
    const parsed = dashboardEmbedSchema.safeParse(raw)
    if (!parsed.success)
      throw new Error(describeSchemaIssues(parsed.error.issues, EMBED_BLOCK_KINDS).join('\n'))
    validateDashboardBlocks(
      parsed.data.blocks,
      parsed.data.source,
      MAX_DASHBOARD_EMBED_BLOCKS,
      parsed.data.highlights
    )
    return { spec: parsed.data }
  } catch (error) {
    return { error: getErrorMessage(error, 'Invalid dashboard embed') }
  }
}

/** Every table a dashboard's data blocks read, for scoping refresh and fetch state. */
export function dashboardTableIds(
  blocks: readonly DashboardBlock[],
  defaults: DashboardSource | undefined
): Set<string> {
  const ids = new Set<string>()
  const visit = (children: readonly DashboardBlock[]) => {
    for (const block of children) {
      if ('row' in block) visit(block.row)
      else if ('tabs' in block) Object.values(block.tabs).forEach(visit)
      else if (!('text' in block)) ids.add(resolveDashboardSource(defaults, block.source).tableId)
    }
  }
  visit(blocks)
  return ids
}

export function dashboardSelection(source: ResolvedDashboardSource): AnalyticsSelection {
  const { tableId: _tableId, range: _range, ...selection } = source
  return selection
}
