import { z } from 'zod'

export const fccsName = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value.trim().length > 0)
export const fccsJobId = z.string().regex(/^[0-9]{1,20}$/)
const count = z.number().int().nonnegative()
const optionalText = z.string().nullable().optional()
export const fccsPageInput = {
  offset: count.max(2_147_483_647).default(0),
  limit: z.number().int().min(1).max(1000).default(25),
}
export const fccsJobTypes = [
  'RULES',
  'RULESET',
  'IMPORT_DATA',
  'EXPORT_DATA',
  'IMPORT_METADATA',
  'EXPORT_METADATA',
  'IMPORT_EXCHANGE_RATES',
  'JOBCONSOLE_EXPORT',
  'Clear_Data',
  'Copy_Data',
  'IMPORT_JOURNAL',
  'EXPORT_JOURNAL',
  'GENERATE_INTERCOMPANY_REPORT',
] as const
export const fccsJobType = z.enum(fccsJobTypes)
export const fccsDetailJobType = z.enum([
  'IMPORT_DATA',
  'EXPORT_DATA',
  'IMPORT_METADATA',
  'EXPORT_METADATA',
])
export const fccsChildJobType = z.enum(['IMPORT_METADATA', 'EXPORT_METADATA'])
export const fccsParameters = z.record(z.string(), z.unknown())

/** Stable fields from get_applications.html; Oracle's appType list is deliberately open-ended. */
export const fccsApplicationsSchema = z.object({
  items: z
    .array(
      z.object({
        name: fccsName,
        type: z.string().optional(),
        appType: z.string().optional(),
        appStorage: z.string().optional(),
      })
    )
    .max(1000),
})
export const fccsCubesSchema = z.object({
  items: z
    .array(
      z.object({
        planTypeName: fccsName,
        planType: z.number().int().optional(),
        cubeName: z.string().optional(),
        numDimensions: count.optional(),
        cubeType: z.number().int().optional(),
      })
    )
    .max(1000),
})
export const fccsDimensionsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        name: fccsName,
        level: count.optional(),
        dimType: z.string().optional(),
        objectType: z.string().optional(),
      })
    )
    .max(1000),
  totalResults: count,
  hasMore: z.boolean(),
})

export interface FccsHierarchyMember {
  name: string
  id?: string
  path?: string
  alias?: string | null
  children?: FccsHierarchyMember[]
}
export const FCCS_MEMBER_BUDGET = 10_000
export const FCCS_DEPTH_BUDGET = 64
/** Checks size/depth before recursive projection to avoid stack exhaustion on a tenant hierarchy. */
export function assertFccsHierarchyBudget(value: unknown): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]
  let nodes = 0
  while (stack.length) {
    const node = stack.pop()!
    if (++nodes > FCCS_MEMBER_BUDGET || node.depth > FCCS_DEPTH_BUDGET) {
      throw new Error(
        'FCCS dimension exceeds the picker budget (10,000 members / 64 levels). Use Advanced manual member input.'
      )
    }
    if (
      node.value &&
      typeof node.value === 'object' &&
      'children' in node.value &&
      Array.isArray(node.value.children)
    ) {
      if (nodes + stack.length + node.value.children.length > FCCS_MEMBER_BUDGET) {
        throw new Error(
          'FCCS dimension exceeds the picker budget (10,000 members). Use Advanced manual member input.'
        )
      }
      for (const child of node.value.children) stack.push({ value: child, depth: node.depth + 1 })
    }
  }
}
export const fccsHierarchySchema: z.ZodType<FccsHierarchyMember> = z.lazy(() =>
  z.object({
    name: fccsName,
    id: z.string().optional(),
    path: z.string().optional(),
    alias: optionalText,
    children: z.array(fccsHierarchySchema).optional(),
  })
)
/** get_member.html documents children ambiguously; omit it rather than invent its shape. */
export const fccsMemberSchema = z.object({
  name: fccsName,
  description: optionalText,
  parentName: optionalText,
  dataType: optionalText,
  objectType: z.number().int().optional(),
  dataStorage: optionalText,
  dimName: optionalText,
  twoPass: z.boolean().optional(),
})
export const fccsMetadataValidationSchema = z.object({
  numWarnings: count,
  numInfo: count,
  outPutFileName: z.string(),
  numErrors: count,
  status: z.string(),
})
export const fccsJobDefinitionsSchema = z.object({
  items: z.array(z.object({ jobType: z.string(), jobName: fccsName })).max(10_000),
})
/** execute_a_job.html / retrieve_job_status.html use both spellings. Reject conflicting IDs. */
const wireJobId = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const fccsJobSchema = z
  .object({
    jobId: wireJobId.optional(),
    jobID: wireJobId.optional(),
    status: z.number().int().min(-1),
    details: optionalText,
    jobName: z.string().optional(),
    descriptiveStatus: z.string().optional(),
    detailedStatus: z.number().int().optional(),
  })
  .refine(
    (value) =>
      (value.jobId !== undefined || value.jobID !== undefined) &&
      (value.jobId === undefined || value.jobID === undefined || value.jobId === value.jobID)
  )
  .transform(({ jobID, jobId, ...job }) => ({ ...job, jobId: String(jobId ?? jobID) }))

export const fccsLinkSchema = z.object({
  rel: z.string(),
  href: z.string(),
  action: z.string().optional(),
})
export const fccsJobDetailsSchema = z.object({
  items: z
    .array(
      z.object({
        recordsRead: count.optional(),
        recordsRejected: count.optional(),
        recordsProcessed: count.optional(),
        dimensionName: z.string().optional(),
        loadType: z.string().optional(),
        links: z.array(fccsLinkSchema).optional(),
      })
    )
    .max(1000),
  links: z.array(fccsLinkSchema).optional(),
})
export const fccsChildJobDetailsSchema = z.object({
  items: z
    .array(
      z.object({
        msgType: z.string(),
        msgCategory: z.string(),
        msgText: z.string(),
      })
    )
    .max(1000),
  links: z.array(fccsLinkSchema).optional(),
})

const strings = z.array(z.string())
const gridAxis = z.object({ dimensions: strings.optional(), members: z.array(strings) }).strict()
export const fccsGridDefinition = z
  .object({
    pov: gridAxis,
    columns: z.array(gridAxis).min(1),
    rows: z.array(gridAxis).min(1),
    suppressMissingBlocks: z.boolean().optional(),
    suppressMissingRows: z.boolean().optional(),
    suppressMissingColumns: z.boolean().optional(),
  })
  .strict()
/** Numeric Essbase values and #missing only; no Planning cell notes/supporting details. */
const numericCell = z.union([
  z.number().finite(),
  z
    .string()
    .refine(
      (value) =>
        value.toLowerCase() === '#missing' ||
        (value.trim() !== '' && Number.isFinite(Number(value)))
    ),
])
export const fccsDataGridInput = z
  .object({
    pov: strings,
    columns: z.array(strings),
    rows: z.array(z.object({ headers: strings, data: z.array(numericCell) }).strict()),
  })
  .strict()
export const fccsDataGridSchema = z.object({
  pov: strings,
  columns: z.array(strings),
  rows: z.array(z.object({ headers: strings, data: z.array(z.union([z.string(), z.number()])) })),
})
export const fccsImportSliceSchema = z.object({
  numAcceptedCells: count,
  numUpdateCells: count.optional(),
  numRejectedCells: count,
  rejectedCells: strings.optional(),
  rejectedCellsWithDetails: z
    .array(z.object({ memberNames: strings, readOnlyReasons: strings, otherReasons: strings }))
    .optional(),
})
export const fccsClearSliceSchema = z.object({
  numClearedCells: count,
  numRejectedCells: count,
  rejectedCells: strings,
})
export const fccsJournalsSchema = z.object({
  totalResults: count,
  hasMore: z.boolean(),
  count,
  limit: count,
  offset: count,
  items: z
    .array(
      z.object({
        label: z.string(),
        scenario: z.string(),
        year: z.string(),
        period: z.string(),
        status: z.string(),
        currency: optionalText,
        createdOn: optionalText,
        modifiedBy: optionalText,
        journalType: optionalText,
        createdBy: optionalText,
        balanceType: optionalText,
        postedBy: optionalText,
        description: optionalText,
        group: optionalText,
      })
    )
    .max(1000),
})
export const fccsJournalActionSchema = z.object({
  actionStatus: z.number().int(),
  actionDetail: z.string(),
})
/** fccs_perform_journal_update.html: parameter table and response example document these two alternatives. */
export const fccsJournalPeriodSchema = z.union([
  fccsJournalActionSchema,
  z.object({ scenario: z.string(), year: z.string(), period: z.string(), action: z.string() }),
])
export const fccsFileStatusSchema = z.object({ status: z.number().int(), details: optionalText })
export const fccsFilesSchema = fccsFileStatusSchema.extend({
  items: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(['EXTERNAL', 'LCM']),
        size: z
          .string()
          .regex(/^[0-9]+$/)
          .nullable(),
        lastmodifiedtime: z
          .string()
          .regex(/^[0-9]+$/)
          .nullable(),
      })
    )
    .max(10_000),
})
