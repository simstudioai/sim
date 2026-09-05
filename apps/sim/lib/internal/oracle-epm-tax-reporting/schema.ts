import { z } from 'zod'
import { userFileSchema } from '@/lib/api/contracts/primitives'
import { assertTaxInputBudget } from '@/tools/oracle_epm_tax_reporting/utils'

const name = z.string().min(1).max(255)
const text = z.string().max(16384)
const id = z.string().regex(/^[0-9]{1,32}$/)
const count = z.number().int().nonnegative().safe()
const scalar = z.union([text, z.number().finite(), z.boolean()])
const parameters = z
  .record(z.string().min(1).max(255), scalar)
  .refine((value) => Object.keys(value).length <= 100, 'At most 100 parameters are supported')
const stringParameters = z
  .record(z.string().min(1).max(255), text)
  .refine((value) => Object.keys(value).length <= 100, 'At most 100 parameters are supported')
const names = z.array(name).max(1000)
const axis = z
  .object({ dimensions: names.optional(), members: z.array(names.min(1)).min(1).max(32) })
  .strict()
  .refine(
    (value) => !value.dimensions || value.dimensions.length === value.members.length,
    'Dimension and member-selection counts must match'
  )
export const gridDefinitionSchema = z
  .object({
    pov: axis,
    columns: z.array(axis).min(1).max(100),
    rows: z.array(axis).min(1).max(100),
    suppressMissingBlocks: z.boolean().optional(),
    suppressMissingRows: z.boolean().optional(),
    suppressMissingColumns: z.boolean().optional(),
  })
  .strict()

/** Core JSON grid shared by the documented data-slice import and export APIs. */
export const dataGridSchema = z
  .object({
    pov: names,
    columns: z.array(names).min(1).max(32),
    rows: z
      .array(
        z
          .object({
            headers: names,
            data: z.array(z.union([text, z.number().finite()])).max(1000),
          })
          .strict()
      )
      .max(1000),
  })
  .strict()

const auth = {
  oauthCredential: name,
  accessToken: z.string().min(1).max(4096),
  instanceUrl: z.string().min(1).max(2048),
}
const app = { application: name }
const wait = { waitForCompletion: z.boolean().default(false) }
const job = { ...app, jobName: name, ...wait }
const paging = {
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).max(100000).default(0),
  messageType: z.enum(['INFO', 'ERROR', 'WARNING']).optional(),
}
const rule = { ...job, parameters: stringParameters.optional() }
const exportMetadata = { exportZipFileName: name.regex(/\.zip$/i).optional() }
const importMetadata = {
  importZipFileName: name.regex(/\.zip$/i).optional(),
  refreshCube: z.boolean().optional(),
  errorFile: name.regex(/\.zip$/i).optional(),
}
export const supportedJobTypeSchema = z.enum([
  'RULES',
  'RULESET',
  'EXPORT_METADATA',
  'IMPORT_METADATA',
])
export const jobParametersSchemas = {
  RULES: stringParameters,
  RULESET: stringParameters,
  EXPORT_METADATA: z.object(exportMetadata).strict(),
  IMPORT_METADATA: z.object(importMetadata).strict(),
}

const operationShapes = {
  get_api_version: {},
  list_applications: {},
  list_job_definitions: { ...app, jobType: supportedJobTypeSchema.optional() },
  get_member: { ...app, dimension: name, memberName: name },
  add_member: { ...app, dimension: name, memberName: name, parentName: name },
  export_data_slice: { ...app, planType: name, gridDefinition: gridDefinitionSchema },
  import_data_slice: {
    ...app,
    planType: name,
    dataGrid: dataGridSchema.refine(
      (grid) => grid.rows.length > 0,
      'At least one data row is required'
    ),
    aggregateEssbaseData: z.boolean().optional(),
    dateFormat: z
      .enum(['MM-DD-YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY/MM/DD'])
      .optional(),
    strictDateValidation: z.boolean().optional(),
  },
  clear_data_slice: {
    ...app,
    planType: name,
    gridDefinition: gridDefinitionSchema,
    clearEssbaseData: z.boolean().default(true),
    clearPlanningData: z.boolean().default(false),
  },
  copy_data: { ...app, profileName: name, ...wait },
  clear_data: { ...app, profileName: name, ...wait },
  run_rule: rule,
  run_ruleset: rule,
  execute_job: { ...job, jobType: supportedJobTypeSchema, parameters: parameters.optional() },
  get_job_status: {
    application: name.optional(),
    jobId: id,
    jobFamily: z
      .enum(['planning', 'supplemental_collection', 'supplemental_dimension'])
      .default('planning'),
    ...wait,
  },
  get_job_details: { ...app, jobId: id, ...paging },
  get_child_job_details: { ...app, jobId: id, childJobId: id, ...paging },
  export_metadata: { ...job, ...exportMetadata },
  import_metadata: { ...job, ...importMetadata },
  import_supplemental_collection_data: {
    ...app,
    ...wait,
    fileName: name,
    collection: name,
    year: name,
    period: name,
    jobName: name.optional(),
    frequencyDimensions: stringParameters.optional(),
  },
  deploy_form_templates: {
    ...app,
    ...wait,
    jobName: name.optional(),
    collectionIntervalName: name,
    templates: names.max(100),
    resetWorkflows: z.boolean().default(false),
    frequencyDimensions: stringParameters.optional(),
  },
  import_supplemental_dimension_members: {
    ...wait,
    dimension: name,
    fileName: name,
    importMode: z.enum(['Replace', 'Update']).default('Replace'),
    delimiter: z.string().length(1).optional(),
    dateFormat: name.optional(),
  },
  generate_report: {
    groupName: name,
    reportName: name,
    generatedReportFileName: name.optional(),
    parameters: parameters.optional(),
    format: z.enum(['HTML', 'PDF', 'XLSX', 'CSV']).default('PDF'),
    module: z.enum(['FCM', 'SDM']),
    ...wait,
  },
  generate_user_details_report: {
    fileName: name,
    format: z.enum(['CSV', 'XLS']).default('CSV'),
    ...wait,
  },
  get_report_status: {
    jobId: id,
    module: z.enum(['FCCS', 'SDM']).optional(),
    ...wait,
    reportStatusRoute: z
      .enum(['standalone', 'generated_report', 'user_details'])
      .default('standalone'),
    downloadReport: z.boolean().default(false),
  },
  list_files: {},
  upload_file: {
    file: userFileSchema,
    fileName: name,
    directory: name.regex(/^(inbox|outbox)(\/[^/\\]+)*$/).optional(),
  },
  download_file: { fileName: name },
} as const

export type TaxOperation = keyof typeof operationShapes
export const TAX_OPERATIONS = Object.keys(operationShapes) as TaxOperation[]
type ShapeOutput<S> = { [P in keyof S]: S[P] extends z.ZodType ? z.output<S[P]> : never }
export type TaxInput<K extends TaxOperation = TaxOperation> = K extends TaxOperation
  ? ShapeOutput<(typeof operationShapes)[K]> & ShapeOutput<typeof auth> & { operation: K }
  : never

/** The registered tool ID selects its contract; callers cannot choose a different operation. */
export function parseTaxInput<K extends TaxOperation>(operation: K, input: unknown): TaxInput<K> {
  assertTaxInputBudget(input)
  const parsed = z
    .object({ ...auth, ...operationShapes[operation] })
    .strip()
    .parse(input)
  const result = { ...parsed, operation } as unknown as TaxInput<K>
  if (result.operation === 'execute_job') {
    jobParametersSchemas[result.jobType].parse(result.parameters ?? {})
  }
  if (
    result.operation === 'get_job_status' &&
    result.jobFamily !== 'supplemental_dimension' &&
    !result.application
  ) {
    throw new Error('Application is required for this job family')
  }
  if (
    result.operation === 'get_report_status' &&
    result.reportStatusRoute !== 'user_details' &&
    !result.module
  ) {
    throw new Error('Report module is required for this status route')
  }
  if (
    result.operation === 'import_supplemental_collection_data' ||
    result.operation === 'deploy_form_templates'
  ) {
    const reserved = new Set([
      'filename',
      'collection',
      'year',
      'period',
      'collectionintervalname',
      'template',
      'resetworkflows',
    ])
    if (
      Object.keys(result.frequencyDimensions ?? {}).some((key) => reserved.has(key.toLowerCase()))
    ) {
      // Deploy frequencies legitimately include Year/Period; collection imports have dedicated fields.
      const keys = Object.keys(result.frequencyDimensions ?? {}).map((key) => key.toLowerCase())
      if (
        keys.some(
          (key) =>
            reserved.has(key) &&
            !(result.operation === 'deploy_form_templates' && ['year', 'period'].includes(key))
        )
      ) {
        throw new Error('Frequency dimensions cannot override operation parameters')
      }
    }
  }
  return result
}

export const oracleLinkSchema = z.object({
  rel: z.string().min(1).max(64).optional(),
  href: z.string().min(1).max(4096),
  action: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']).optional(),
})
const links = z.array(oracleLinkSchema).max(100).optional()
const jobId = z.union([id, count]).transform(String)

/** Oracle documents jobId in examples and jobID in parameter tables; neither is fabricated. */
export const statusResponseSchema = z.object({
  status: z.number().int(),
  details: text.nullable().optional(),
  links,
})
export const reportResponseSchema = statusResponseSchema
  .extend({
    jobID: jobId.optional(),
    type: text.optional(),
  })
  .transform(({ jobID, ...value }) => ({ ...value, ...(jobID ? { jobId: jobID } : {}) }))
export const supplementalResponseSchema = statusResponseSchema.extend({
  jobId: jobId.optional(),
  detail: text.nullable().optional(),
})
export const jobResponseSchema = z
  .object({
    status: z.number().int(),
    jobId: jobId.optional(),
    jobID: jobId.optional(),
    jobName: text.optional(),
    details: text.nullable().optional(),
    detailedStatus: z.number().int().optional(),
    descriptiveStatus: text.nullable().optional(),
    links,
  })
  .transform(({ jobID, ...value }) => ({
    ...value,
    ...(value.jobId || jobID ? { jobId: value.jobId ?? jobID } : {}),
  }))
export type TaxJobResult = z.output<typeof jobResponseSchema>

export const applicationListSchema = z.object({
  items: z
    .array(
      z.object({
        name,
        type: name.optional(),
        appType: name.optional(),
        appStorage: name.optional(),
        unicode: z.boolean().optional(),
        adminMode: z.union([z.boolean(), z.enum(['true', 'false'])]).optional(),
      })
    )
    .max(1000),
})
export const jobDefinitionsSchema = z.object({
  items: z.array(z.object({ jobName: name, jobType: name })).max(1000),
})
export const memberResponseSchema = z.object({
  name,
  parentName: name.nullable().optional(),
  description: text.nullable().optional(),
  dataType: name.optional(),
  objectType: z.number().int().optional(),
  dataStorage: name.optional(),
  dimName: name.optional(),
  twoPass: z.boolean().optional(),
})
export const apiVersionSchema = z.object({
  version: name,
  lifecycle: name.optional(),
  isLatest: z.boolean().optional(),
})
export const importSliceResponseSchema = z.object({
  numAcceptedCells: count,
  numUpdateCells: count.optional(),
  numRejectedCells: count,
  rejectedCells: z.array(text).max(100).optional(),
  rejectedCellsWithDetails: z
    .array(z.object({ memberNames: names, readOnlyReasons: names, otherReasons: names }))
    .max(100)
    .optional(),
})
export const clearSliceResponseSchema = z.object({
  numClearedCells: count,
  numRejectedCells: count,
  rejectedCells: z.array(text).max(1000).optional(),
})
export const jobDetailsSchema = z.object({
  items: z
    .array(
      z.object({
        recordsRead: count.optional(),
        recordsRejected: count.optional(),
        recordsProcessed: count.optional(),
        dimensionName: name.optional(),
        loadType: name.optional(),
        links,
      })
    )
    .max(100),
  links,
})
export const childJobDetailsSchema = z.object({
  items: z
    .array(
      z.object({
        msgType: name,
        msgCategory: text,
        msgText: text,
      })
    )
    .max(100),
  links,
})
export const fileListSchema = z.object({
  status: z.number().int(),
  details: text.nullable().optional(),
  items: z
    .array(
      z.object({
        name,
        type: z.enum(['LCM', 'EXTERNAL']),
        size: z
          .union([count, z.string().regex(/^[0-9]+$/)])
          .nullable()
          .optional(),
        lastmodifiedtime: z
          .union([count, z.string().regex(/^[0-9]+$/)])
          .nullable()
          .optional(),
      })
    )
    .max(1000),
})
