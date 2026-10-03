import { z } from 'zod'
import type { OraclePcmRepositoryFile, OraclePcmTask } from '@/tools/oracle_epm_profitability/types'

export const PCM_MAX_JSON_BYTES = 4 * 1024 * 1024
export const PCM_MAX_ITEMS = 10_000
export const pcmName = z.string().trim().min(1).max(255)
export const pcmRepositoryName = z.string().min(1).max(4_096)
export const pcmFileName = pcmRepositoryName
  .max(255)
  .regex(/^[^/\\]+$/, 'Use a filename without repository folders')

export function isOraclePcmDownloadablePath(name: string): boolean {
  return new TextEncoder().encode(name).byteLength <= 255
}

export function requireOraclePcmDownloadablePath(name: string): void {
  if (!isOraclePcmDownloadablePath(name)) {
    throw new OraclePcmOperationError('PCM repository paths must fit within 255 UTF-8 bytes')
  }
}

export class OraclePcmOperationError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
    this.name = 'OraclePcmOperationError'
  }
}

export function requireOraclePcmResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new OraclePcmOperationError('Oracle PCM returned an invalid response contract', 502)
  }
  return result.data
}

export const pcmStatusSchema = z.object({
  status: z.number().int().min(-1),
  statusMessage: z.string().max(65_536).nullish(),
  details: z.string().max(65_536).nullish(),
})

/** PCM uses migration statuses: every positive code is a failure, including 2. */
export function normalizeOraclePcmTask(value: unknown, processName: string | null): OraclePcmTask {
  const data = requireOraclePcmResponse(pcmStatusSchema, value)
  return {
    processName,
    status: data.status,
    state: data.status === -1 ? 'pending' : data.status === 0 ? 'succeeded' : 'failed',
    statusMessage: data.statusMessage ?? null,
    details: data.details ?? null,
  }
}

export function requireOraclePcmRepositorySuccess(value: unknown): void {
  const data = requireOraclePcmResponse(z.object({ status: z.number().int() }), value)
  if (data.status !== 0) {
    throw new OraclePcmOperationError(
      data.status === -1
        ? 'Oracle started unsupported snapshot processing; the upload was not retried'
        : 'Oracle rejected the repository operation; check the filename and permissions',
      502
    )
  }
}

const decimalMetadata = z
  .union([z.number().int().nonnegative().safe(), z.string().regex(/^\d{1,16}$/)])
  .transform(Number)
  .refine(Number.isSafeInteger)
  .nullable()

export function normalizeOraclePcmFiles(value: unknown): OraclePcmRepositoryFile[] {
  requireOraclePcmRepositorySuccess(value)
  const data = requireOraclePcmResponse(
    z.object({
      items: z
        .array(
          z.object({
            name: pcmRepositoryName,
            type: z.enum(['EXTERNAL', 'LCM']),
            size: decimalMetadata,
            lastmodifiedtime: decimalMetadata,
          })
        )
        .max(PCM_MAX_ITEMS),
    }),
    value
  )
  return data.items
    .filter((item) => item.type === 'EXTERNAL' && /^(profitinbox|profitoutbox)\//.test(item.name))
    .map((item) => ({
      name: item.name,
      type: 'EXTERNAL',
      size: item.size,
      lastModifiedTime: item.lastmodifiedtime,
    }))
}

/** Oracle documents scalar balance fields but not the contents of the nested rules array. */
export const pcmBalanceSchema = z.object({
  ruleNumber: z.string().max(255),
  balanceTypeRule: z.boolean(),
  scale: z.number(),
  sequence: z.number(),
  name: pcmName,
  description: z.string().max(65_536).nullable(),
  runningBalance: z.number().nullable(),
  balance: z.number().nullable(),
  allocationIn: z.number().nullable(),
  allocationOut: z.number().nullable(),
  adjustmentIn: z.number().nullable(),
  adjustmentOut: z.number().nullable(),
  input: z.number().nullable(),
  runningRemainder: z.number().nullable(),
  remainder: z.number().nullable(),
  netChange: z.number().nullable(),
  offset: z.number().nullable(),
})
