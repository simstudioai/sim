import { z } from 'zod'

const MAX_QUERY_BYTES = 256 * 1024
const MAX_WHERE_BYTES = 64 * 1024
const MAX_STRUCTURED_DATA_BYTES = 1024 * 1024
const MAX_WALLET_BYTES = 1024 * 1024
const MAX_BIND_COUNT = 100
const MAX_COLUMN_COUNT = 100

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

function boundedString(maxBytes: number, message: string) {
  return z
    .string()
    .min(1)
    .refine((value) => utf8Bytes(value) <= maxBytes, { message })
}

const descriptorHostSchema = boundedString(1024, 'Host must be at most 1024 bytes').refine(
  (value) => /^[A-Za-z0-9._:[\]-]+$/.test(value),
  'Host contains characters that are unsafe in an Oracle Net descriptor'
)

const descriptorValueSchema = boundedString(
  512,
  'Connection identifier must be at most 512 bytes'
).refine(
  (value) => !/[()=\u0000-\u001f\u007f\s]/.test(value),
  'Connection identifier contains characters that are unsafe in an Oracle Net descriptor'
)

const identifierSchema = boundedString(128, 'Identifier must be at most 128 bytes')
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, 'Identifier cannot be empty')
  .refine((value) => !value.includes('\0'), 'Identifier cannot contain a null byte')

const querySchema = boundedString(MAX_QUERY_BYTES, 'SQL must be at most 256 KiB')
const whereSchema = boundedString(MAX_WHERE_BYTES, 'WHERE clause must be at most 64 KiB')

const oracleBindScalarSchema = z.union([
  z.string(),
  z.number().finite('Bind numbers must be finite'),
  z.null(),
])

const bindsSchema = z
  .record(
    z
      .string()
      .regex(
        /^[A-Za-z][A-Za-z0-9_$#]{0,127}$/,
        'Bind names must start with a letter and contain only letters, numbers, _, $, or #'
      ),
    oracleBindScalarSchema
  )
  .refine((value) => Object.keys(value).length <= MAX_BIND_COUNT, {
    message: `At most ${MAX_BIND_COUNT} named binds are allowed`,
  })
  .refine(
    (value) => {
      try {
        return utf8Bytes(JSON.stringify(value)) <= MAX_STRUCTURED_DATA_BYTES
      } catch {
        return false
      }
    },
    { message: 'Binds must serialize to at most 1 MiB' }
  )
  .optional()

const nonEmptyRecordSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => Object.keys(value).length > 0, 'Data object cannot be empty')
  .refine((value) => Object.keys(value).length <= MAX_COLUMN_COUNT, {
    message: `Data may contain at most ${MAX_COLUMN_COUNT} columns`,
  })
  .refine(
    (value) => {
      try {
        return utf8Bytes(JSON.stringify(value)) <= MAX_STRUCTURED_DATA_BYTES
      } catch {
        return false
      }
    },
    { message: 'Data must serialize to at most 1 MiB' }
  )

const jsonObjectStringSchema = z
  .string()
  .min(1)
  .max(MAX_STRUCTURED_DATA_BYTES)
  .transform((value, context): Record<string, unknown> => {
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        context.addIssue({ code: 'custom', message: 'Data must be a JSON object' })
        return z.NEVER
      }
      return parsed as Record<string, unknown>
    } catch {
      context.addIssue({ code: 'custom', message: 'Data must be valid JSON' })
      return z.NEVER
    }
  })
  .pipe(nonEmptyRecordSchema)

const dataSchema = z.union([nonEmptyRecordSchema, jsonObjectStringSchema])

const connectionShape = {
  host: descriptorHostSchema,
  port: z.coerce
    .number()
    .int()
    .min(1, 'Port must be between 1 and 65535')
    .max(65535, 'Port must be between 1 and 65535')
    .default(1521),
  protocol: z.enum(['tcp', 'tcps']).default('tcp'),
  connectionType: z.enum(['serviceName', 'sid']).default('serviceName'),
  serviceName: descriptorValueSchema.optional(),
  sid: descriptorValueSchema.optional(),
  username: boundedString(512, 'Username must be at most 512 bytes'),
  password: boundedString(4096, 'Password must be at most 4096 bytes'),
  connectionTimeout: z.coerce
    .number()
    .int()
    .min(1000, 'connectionTimeout must be at least 1000 ms')
    .max(120000, 'connectionTimeout must be at most 120000 ms')
    .default(15000),
  walletContent: z
    .string()
    .min(1, 'Wallet content cannot be empty')
    .refine((value) => utf8Bytes(value) <= MAX_WALLET_BYTES, {
      message: 'Wallet content must be at most 1 MiB',
    })
    .refine(
      (value) => /-----BEGIN [A-Z0-9 ]+-----[\s\S]+-----END [A-Z0-9 ]+-----/.test(value),
      'Wallet content must contain PEM data from ewallet.pem'
    )
    .optional(),
  walletPassword: boundedString(4096, 'Wallet password must be at most 4096 bytes').optional(),
} as const

type ConnectionShape = z.infer<z.ZodObject<typeof connectionShape>>

function validateConnection(input: ConnectionShape, context: z.RefinementCtx): void {
  if (input.connectionType === 'serviceName') {
    if (!input.serviceName) {
      context.addIssue({
        code: 'custom',
        path: ['serviceName'],
        message: 'Service name is required when connectionType is serviceName',
      })
    }
    if (input.sid !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['sid'],
        message: 'SID must be omitted when connectionType is serviceName',
      })
    }
  } else {
    if (!input.sid) {
      context.addIssue({
        code: 'custom',
        path: ['sid'],
        message: 'SID is required when connectionType is sid',
      })
    }
    if (input.serviceName !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['serviceName'],
        message: 'Service name must be omitted when connectionType is sid',
      })
    }
  }

  if (input.protocol !== 'tcps' && input.walletContent !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['walletContent'],
      message: 'Wallet content is supported only with TCPS',
    })
  }
  if (input.walletPassword !== undefined && input.walletContent === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['walletPassword'],
      message: 'Wallet password requires wallet content',
    })
  }
}

function connectionSchema<TShape extends z.ZodRawShape>(shape: TShape) {
  return z
    .object({ ...connectionShape, ...shape })
    .strict()
    .superRefine((input, context) => validateConnection(input as ConnectionShape, context))
}

export const oracleConnectionInputSchema = connectionSchema({})
export const oracleQueryInputSchema = connectionSchema({
  query: querySchema,
  binds: bindsSchema,
})
export const oracleExecuteInputSchema = oracleQueryInputSchema
export const oracleInsertInputSchema = connectionSchema({
  schema: identifierSchema.optional(),
  table: identifierSchema,
  data: dataSchema,
})
export const oracleUpdateInputSchema = connectionSchema({
  schema: identifierSchema.optional(),
  table: identifierSchema,
  data: dataSchema,
  where: whereSchema,
})
export const oracleDeleteInputSchema = connectionSchema({
  schema: identifierSchema.optional(),
  table: identifierSchema,
  where: whereSchema,
})
export const oracleIntrospectInputSchema = connectionSchema({
  schema: identifierSchema.optional(),
})

export type OracleConnectionInput = z.output<typeof oracleConnectionInputSchema>
export type OracleQueryInput = z.output<typeof oracleQueryInputSchema>
export type OracleExecuteInput = z.output<typeof oracleExecuteInputSchema>
export type OracleInsertInput = z.output<typeof oracleInsertInputSchema>
export type OracleUpdateInput = z.output<typeof oracleUpdateInputSchema>
export type OracleDeleteInput = z.output<typeof oracleDeleteInputSchema>
export type OracleIntrospectInput = z.output<typeof oracleIntrospectInputSchema>
export type OracleBindScalar = z.output<typeof oracleBindScalarSchema>
