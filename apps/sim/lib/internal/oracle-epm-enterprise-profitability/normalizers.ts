import { z } from 'zod'
import type {
  OracleEpcmApplication,
  OracleEpcmExchangeJobType,
  OracleEpcmImportResult,
  OracleEpcmJob,
  OracleEpcmMember,
  OracleEpcmRepositoryFile,
} from '@/tools/oracle_epm_enterprise_profitability/types'

export const EPCM_MAX_COLLECTION_ITEMS = 10_000
export const EPCM_MAX_JSON_BYTES = 4 * 1024 * 1024
export const EPCM_EXCHANGE_JOB_TYPES = [
  'IMPORT_DATA',
  'EXPORT_DATA',
  'IMPORT_METADATA',
  'EXPORT_METADATA',
] as const

export class OracleEpcmOperationError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
    this.name = 'OracleEpcmOperationError'
  }
}

export const epcmName = z.string().min(1).max(255)
const responseText = z.string().max(65_536)
const count = z.number().int().nonnegative().safe()
const optionalText = responseText.nullable().optional()
const identifier = z
  .union([z.number().int().nonnegative().safe(), z.string().regex(/^\d{1,16}$/)])
  .transform(String)

export function requireOracleEpcmResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new OracleEpcmOperationError('Oracle EPCM returned an invalid response contract', 502)
  }
  return parsed.data
}

const applicationSchema = z.object({
  name: epcmName,
  type: epcmName.optional(),
  appType: epcmName.optional(),
  appStorage: epcmName.optional(),
})

export function normalizeOracleEpcmApplications(value: unknown): OracleEpcmApplication[] {
  return requireOracleEpcmResponse(
    z.object({ items: z.array(applicationSchema).max(EPCM_MAX_COLLECTION_ITEMS) }),
    value
  ).items
}

export function normalizeOracleEpcmMember(value: unknown): OracleEpcmMember {
  return requireOracleEpcmResponse(
    z.object({
      name: epcmName,
      description: optionalText,
      parentName: epcmName.nullable().optional(),
      dimName: epcmName.optional(),
      dataType: epcmName.optional(),
      dataStorage: epcmName.optional(),
      objectType: z.number().int().optional(),
      twoPass: z.boolean().optional(),
    }),
    value
  )
}

/** Exchange discovery is not a catalog of EPCM models, allocation rules, or rule sets. */
export function normalizeOracleEpcmJobDefinitions(
  value: unknown,
  jobType: OracleEpcmExchangeJobType
): { jobType: OracleEpcmExchangeJobType; jobName: string }[] {
  const data = requireOracleEpcmResponse(
    z.object({
      items: z
        .array(z.object({ jobName: epcmName, jobType: epcmName }))
        .max(EPCM_MAX_COLLECTION_ITEMS),
    }),
    value
  )
  return data.items
    .filter((item) => item.jobType === jobType)
    .map((item) => ({ jobName: item.jobName, jobType }))
}

/** Job ID casing differs between Oracle's common-job table and EPCM examples. */
export function normalizeOracleEpcmJob(value: unknown): OracleEpcmJob {
  const data = requireOracleEpcmResponse(
    z
      .object({
        jobId: identifier.optional(),
        jobID: identifier.optional(),
        status: z.number().int(),
        jobName: epcmName.optional(),
        descriptiveStatus: responseText.optional(),
        details: optionalText,
      })
      .refine(
        (job) =>
          Boolean(job.jobId ?? job.jobID) && !(job.jobId && job.jobID && job.jobId !== job.jobID)
      ),
    value
  )
  const state = oracleEpcmJobState(data.status)
  const { jobID, ...job } = data
  return { ...job, jobId: (data.jobId ?? jobID) as string, state }
}

export function oracleEpcmJobState(status: number): OracleEpcmJob['state'] {
  if (status === -1 || status === 2) return 'pending'
  if (status === 0) return 'succeeded'
  if ([1, 3, 4, 2_147_483_647].includes(status)) return 'failed'
  throw new OracleEpcmOperationError('Oracle EPCM returned an undocumented job status', 502)
}

export function requireOracleEpcmRepositorySuccess(value: unknown): void {
  const data = requireOracleEpcmResponse(z.object({ status: z.number().int() }), value)
  if (data.status !== 0) {
    throw new OracleEpcmOperationError(
      data.status === -1
        ? 'Oracle started unsupported snapshot processing; it was not retried or polled'
        : 'Oracle rejected the repository operation; check the filename, permissions, and repository job details',
      502
    )
  }
}

const decimalMetadata = z
  .union([count, z.string().regex(/^\d{1,16}$/)])
  .transform(Number)
  .refine(Number.isSafeInteger)
  .nullable()

export function normalizeOracleEpcmFiles(value: unknown): OracleEpcmRepositoryFile[] {
  requireOracleEpcmRepositorySuccess(value)
  const data = requireOracleEpcmResponse(
    z.object({
      items: z
        .array(
          z.object({
            name: epcmName,
            type: z.enum(['EXTERNAL', 'LCM']),
            size: decimalMetadata,
            lastmodifiedtime: decimalMetadata,
          })
        )
        .max(EPCM_MAX_COLLECTION_ITEMS),
    }),
    value
  )
  return data.items
    .filter((item) => item.type === 'EXTERNAL')
    .map((item) => ({
      name: item.name,
      type: 'EXTERNAL',
      size: item.size,
      lastModifiedTime: item.lastmodifiedtime,
    }))
}

export const epcmStringAxis = z.array(epcmName).max(1_000)
const selectionAxis = z
  .object({
    dimensions: z.array(epcmName).max(100).optional(),
    members: z.array(epcmStringAxis.min(1)).min(1).max(100),
  })
  .strict()
  .refine(
    (axis) => !axis.dimensions || axis.dimensions.length === axis.members.length,
    'Dimensions and member selections must have matching lengths'
  )

export const epcmGridDefinitionSchema = z
  .object({
    suppressMissingBlocks: z.boolean().optional(),
    suppressMissingRows: z.boolean().optional(),
    suppressMissingColumns: z.boolean().optional(),
    pov: selectionAxis,
    rows: z.array(selectionAxis).min(1).max(100),
    columns: z.array(selectionAxis).min(1).max(100),
  })
  .strict()

export const epcmDataGridSchema = z
  .object({
    pov: epcmStringAxis,
    columns: z.array(epcmStringAxis).max(10_000),
    rows: z
      .array(
        z
          .object({
            headers: epcmStringAxis,
            data: z.array(z.union([z.string().max(4_096), z.number().finite()])).max(10_000),
          })
          .strict()
      )
      .max(10_000),
  })
  .strict()
  .superRefine((grid, context) => {
    const width = grid.columns[0]?.length ?? 0
    if (
      grid.columns.some((axis) => axis.length !== width) ||
      grid.rows.some((row) => row.data.length !== width)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Grid columns and row data must have matching widths',
      })
    }
    if (grid.rows.length * Math.max(width, 1) > 100_000) {
      context.addIssue({ code: 'custom', message: 'A data slice is limited to 100,000 cells' })
    }
  })

export function normalizeOracleEpcmExportGrid(value: unknown) {
  /** Oracle exports values as strings; preserve decimals and missing-value markers verbatim. */
  return requireOracleEpcmResponse(
    z
      .object({
        pov: epcmStringAxis,
        columns: z.array(epcmStringAxis).max(10_000),
        rows: z
          .array(
            z.object({
              headers: epcmStringAxis,
              data: z.array(z.string().max(4_096)).max(10_000),
            })
          )
          .max(10_000),
      })
      .superRefine((grid, context) => {
        if (grid.rows.reduce((cells, row) => cells + row.data.length, 0) > 100_000) {
          context.addIssue({ code: 'custom', message: 'Too many result cells' })
        }
      }),
    value
  )
}

export function normalizeOracleEpcmImportResult(value: unknown): OracleEpcmImportResult {
  return requireOracleEpcmResponse(
    z.object({
      numAcceptedCells: count,
      numRejectedCells: count,
      numUpdateCells: count.optional(),
      rejectedCells: z.array(responseText).max(100).optional(),
      rejectedCellsWithDetails: z
        .array(
          z.object({
            memberNames: epcmStringAxis,
            readOnlyReasons: z.array(responseText).max(100),
            otherReasons: z.array(responseText).max(100),
          })
        )
        .max(100)
        .optional(),
    }),
    value
  )
}

export const epcmDiagnosticPageSchema = z.object({
  items: z
    .array(
      z.object({
        recordsRead: count.optional(),
        recordsRejected: count.optional(),
        recordsProcessed: count.optional(),
        dimensionName: epcmName.optional(),
        loadType: responseText.optional(),
        links: z.array(z.unknown()).max(32).nullish(),
      })
    )
    .max(1_000),
})

export const epcmMessagePageSchema = z.object({
  items: z
    .array(
      z.object({
        msgType: epcmName,
        msgCategory: responseText.optional(),
        msgText: responseText,
      })
    )
    .max(1_000),
})
