import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { FILTER_OPS } from '@/lib/table/constants'
import { normalizeTablePredicate } from '@/lib/table/query-builder/predicate'
import { validatePredicateShape } from '@/lib/table/query-builder/validate'
import type { PredicateNode, TablePredicateInput } from '@/lib/table/types'

export const ANALYTICS_MAX_ROWS = 500
export const ANALYTICS_MAX_ROW_BYTES = 8192
export const analyticsFieldSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
export const analyticsBucketSchema = z.enum([
  'auto',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'year',
])

/** Shares the table predicate grammar without importing HTTP contracts into the domain. */
export const analyticsFilterSchema = z
  .custom<TablePredicateInput>()
  .superRefine((value, ctx) => {
    try {
      validatePredicateShape(value)
      const visit = (node: PredicateNode): void => {
        const keys = 'all' in node ? ['all'] : 'any' in node ? ['any'] : ['field', 'op', 'value']
        if (Object.keys(node).some((key) => !keys.includes(key)))
          throw new Error('Unknown filter key')
        if ('all' in node) node.all.forEach(visit)
        else if ('any' in node) node.any.forEach(visit)
        else if (!FILTER_OPS.includes(node.op))
          throw new Error(`Unknown filter operator: ${node.op}`)
      }
      visit(value)
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: getErrorMessage(error, 'Invalid table filter') })
    }
  })
  .transform(normalizeTablePredicate)

export const analyticsMeasureSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.enum(['count', 'countDistinct', 'sum', 'avg', 'min', 'max']),
      field: analyticsFieldSchema.optional(),
    })
    .strict()
    .refine((value) => value.op === 'count' || value.field !== undefined, {
      message: 'An aggregate other than count requires a field',
    }),
  z.object({ op: z.literal('percent'), filter: analyticsFilterSchema }).strict(),
])

export const analyticsSelectionSchema = z
  .object({
    filter: analyticsFilterSchema.optional(),
    timeField: analyticsFieldSchema.optional(),
    bucket: analyticsBucketSchema.optional(),
    groupBy: z.array(analyticsFieldSchema).min(1).max(2).optional(),
    aggregate: z
      .record(analyticsFieldSchema, analyticsMeasureSchema)
      .refine(
        (value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 8,
        'Provide between 1 and 8 aggregates'
      )
      .optional(),
    columns: z.array(analyticsFieldSchema).min(1).max(12).optional(),
    sort: z
      .array(z.object({ field: analyticsFieldSchema, direction: z.enum(['asc', 'desc']) }).strict())
      .min(1)
      .max(3)
      .optional(),
    limit: z.number().int().min(1).max(ANALYTICS_MAX_ROWS).optional(),
  })
  .strict()

export const analyticsQuerySchema = analyticsSelectionSchema
  .extend({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
    if (Date.parse(value.from) >= Date.parse(value.to)) fail('from must be earlier than to')
    if (Boolean(value.aggregate) === Boolean(value.columns))
      fail('Provide aggregate or columns, exactly one')
    if (value.groupBy && !value.aggregate) fail('groupBy requires aggregate')
    if (value.bucket && !value.groupBy?.includes(value.timeField ?? 'createdAt')) {
      fail('bucket requires grouping by the timeField')
    }
    if (new Set(value.groupBy).size !== (value.groupBy?.length ?? 0))
      fail('Duplicate groupBy field')
    if (new Set(value.columns).size !== (value.columns?.length ?? 0)) fail('Duplicate column')
    if (value.groupBy?.some((field) => Object.hasOwn(value.aggregate ?? {}, field))) {
      fail('Aggregate names must differ from groupBy fields')
    }
  })

export type AnalyticsQuery = z.output<typeof analyticsQuerySchema>
export type AnalyticsSelection = z.output<typeof analyticsSelectionSchema>
export type AnalyticsBucket = Exclude<z.output<typeof analyticsBucketSchema>, 'auto'>
export type AnalyticsValue = string | number | boolean | null
export interface AnalyticsResult {
  rows: Record<string, AnalyticsValue>[]
  columns: string[]
  columnLabels: Record<string, string>
  truncated: boolean
  bucket: AnalyticsBucket | null
}
