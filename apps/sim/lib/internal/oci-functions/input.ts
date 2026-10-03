import { z } from 'zod'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'
import type { OciFunctionsJson } from '@/tools/oci_functions/types'

export const OCI_FUNCTIONS_PAYLOAD_LIMIT = 6_000_000
const id = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => value !== '.' && value !== '..', 'Invalid resource ID')
const text = z.string().trim().min(1)
const tags = z.record(z.string(), z.record(z.string(), z.unknown()))
const config = z.record(z.string(), z.string()).superRefine((value, ctx) => {
  if (Object.keys(value).length > 100)
    ctx.addIssue({ code: 'custom', message: 'Configuration supports at most 100 entries' })
  let bytes = 0
  for (const [key, entry] of Object.entries(value)) {
    bytes += Buffer.byteLength(key) + Buffer.byteLength(entry)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /[\x00-\x1f\x7f]/.test(entry)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Configuration requires environment-variable keys and printable values',
      })
    }
  }
  if (bytes > 4096)
    ctx.addIssue({
      code: 'custom',
      message: 'Configuration keys and values must fit within 4096 UTF-8 bytes',
    })
})
const destination = z.discriminatedUnion('destinationType', [
  z.object({ destinationType: z.literal('NONE') }).strict(),
  z.object({ destinationType: z.literal('STREAM'), streamId: id }).strict(),
  z
    .object({
      destinationType: z.literal('QUEUE'),
      queueId: id,
      channelId: z.string().min(1).max(64).optional(),
    })
    .strict(),
  z.object({ destinationType: z.literal('NOTIFICATION'), topicId: id }).strict(),
])
const concurrency = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('NONE') }).strict(),
  z.object({ strategy: z.literal('CONSTANT'), count: z.number().int().min(1) }).strict(),
])
const commonSettings = {
  config: config.optional(),
  freeformTags: z.record(z.string(), z.string()).optional(),
  definedTags: tags.optional(),
}
const applicationSettings = z
  .object({
    ...commonSettings,
    networkSecurityGroupIds: z.array(id).max(5).optional(),
    syslogUrl: z.string().max(1024).optional(),
    traceConfig: z
      .object({ domainId: id.optional(), isEnabled: z.boolean().optional() })
      .strict()
      .optional(),
    logging: z
      .object({ lineFormat: z.enum(['JSON', 'PLAIN_TEXT']).optional() })
      .strict()
      .optional(),
    imagePolicyConfig: z
      .object({
        isPolicyEnabled: z.boolean(),
        keyDetails: z.array(z.object({ kmsKeyId: id }).strict()).optional(),
      })
      .strict()
      .optional(),
    securityAttributes: z
      .record(
        z.string(),
        z.record(z.string(), z.object({ value: z.string(), mode: z.literal('enforce') }).strict())
      )
      .optional(),
  })
  .strict()
const functionSettings = z
  .object({
    ...commonSettings,
    imageDigest: text.optional(),
    timeoutInSeconds: z.number().int().min(1).max(300).optional(),
    detachedModeTimeoutInSeconds: z.number().int().min(5).max(3600).optional(),
    provisionedConcurrencyConfig: concurrency.optional(),
    failureDestination: destination.optional(),
    successDestination: destination.optional(),
    traceConfig: z.object({ isEnabled: z.boolean().optional() }).strict().optional(),
  })
  .strict()
const memory = z.union([
  z.literal(128),
  z.literal(256),
  z.literal(512),
  z.literal(1024),
  z.literal(2048),
  z.literal(3072),
])
const base = z.object({ oauthCredential: text, region: text.optional() })
const application = base.extend({ applicationId: id })
const fn = base.extend({ functionId: id })
const ifMatch = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => !/[\r\n]/.test(value), 'Invalid ETag')
  .optional()
const list = {
  page: z.string().min(1).max(1024).optional(),
  limit: z.number().int().min(1).max(50).default(10),
  displayName: text.max(255).optional(),
  id: id.optional(),
  lifecycleState: text.max(255).optional(),
  sortBy: z.enum(['timeCreated', 'id', 'displayName']).optional(),
  sortOrder: z.enum(['ASC', 'DESC']).optional(),
}
const json: z.ZodType<OciFunctionsJson> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(json),
    z.record(z.string(), json),
  ])
)

/** Only declared semantic inputs survive the internal execution boundary. */
export const ociFunctionsInputSchemas = {
  oci_functions_invoke: fn
    .extend({
      invocationType: z.enum(['sync', 'detached']).default('sync'),
      dryRun: z.boolean().default(false),
      intent: z.enum(['httprequest', 'cloudevent']).optional(),
      payloadType: z.enum(['json', 'text', 'file']).default('json'),
      payload: json.optional(),
      file: FileInputSchema.optional(),
      contentType: z
        .string()
        .min(1)
        .max(255)
        .refine(
          (value) => /^[\x20-\x7e]+$/.test(value) && value.includes('/'),
          'Invalid content type'
        )
        .optional(),
      outputFormat: z.enum(['auto', 'file']).default('auto'),
      timeoutMs: z.number().int().min(1).max(300_000).default(300_000),
    })
    .superRefine((value, ctx) => {
      if (value.payloadType === 'file' && !value.file)
        ctx.addIssue({ code: 'custom', message: 'A single uploaded file is required' })
      if (
        value.payloadType === 'text' &&
        value.payload !== undefined &&
        typeof value.payload !== 'string'
      )
        ctx.addIssue({ code: 'custom', message: 'Text payload must be a string' })
    }),
  oci_functions_list_applications: base.extend({ compartmentId: id, ...list }),
  oci_functions_get_application: application,
  oci_functions_create_application: base.extend({
    compartmentId: id,
    displayName: text.max(255),
    subnetIds: z.array(id).min(1),
    shape: z.enum(['GENERIC_X86', 'GENERIC_ARM', 'GENERIC_X86_ARM']).optional(),
    configuration: applicationSettings.optional(),
  }),
  oci_functions_update_application: application.extend({
    configuration: applicationSettings,
    ifMatch,
  }),
  oci_functions_delete_application: application.extend({ ifMatch }),
  oci_functions_change_application_compartment: application.extend({ compartmentId: id, ifMatch }),
  oci_functions_list_functions: application.extend(list),
  oci_functions_get_function: fn,
  oci_functions_create_function: base.extend({
    applicationId: id,
    displayName: text.max(255),
    image: text,
    memoryInMBs: memory,
    configuration: functionSettings.optional(),
  }),
  oci_functions_update_function: fn
    .extend({
      image: text.optional(),
      memoryInMBs: memory.optional(),
      configuration: functionSettings.optional(),
      ifMatch,
    })
    .refine(
      (value) =>
        value.image !== undefined ||
        value.memoryInMBs !== undefined ||
        value.configuration !== undefined,
      'Supply an image, memory size, or configuration update'
    ),
  oci_functions_delete_function: fn.extend({ ifMatch }),
} as const
export type OciFunctionsToolId = keyof typeof ociFunctionsInputSchemas
export type OciFunctionsInputs = {
  [K in OciFunctionsToolId]: z.infer<(typeof ociFunctionsInputSchemas)[K]>
}
