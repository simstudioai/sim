import { z } from 'zod'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import type { UserFile } from '@/executor/types'

const identifier = z.string().trim().min(1).max(255)
/** Configured provider names must round-trip unchanged from selectors to requests. */
const name = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value.trim().length > 0, 'Name is required')
const period = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => value.trim().length > 0, 'Period is required')
/** Preserve provider filenames, including meaningful spaces and literal percent signs. */
const fileName = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => value.trim().length > 0, 'File name is required')
const optionalName = name.optional()
const auth = {
  oauthCredential: identifier,
  accessToken: z.string().min(1).max(4096),
  instanceUrl: z.string().min(1).max(4096),
}
const wait = { waitForCompletion: z.boolean().default(false) }
/** Tenant-defined English display names are keys, not a universal parameter catalog. */
const options = z
  .record(z.string().min(1).max(255), z.string().max(65_536))
  .refine((value) => Object.keys(value).length <= 100, 'At most 100 options are supported')
const pipelineCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{3,30}$/, 'Pipeline code must contain 3–30 alphanumeric characters')

export const oracleEpmDataSchemas = {
  list_connections: z.object(auth),
  get_connection: z.object({ ...auth, connectionName: name }),
  update_connection: z.object({
    ...auth,
    sourceSystemId: identifier,
    sourceSystemName: name,
    sourceSystemType: identifier,
    sourceSystemOptions: z
      .array(z.object({ optionName: name, optionValue: z.string().max(65_536) }))
      .min(1)
      .max(100),
  }),
  get_pipeline_details: z.object({ ...auth, pipelineCode }),
  run_pipeline: z.object({ ...auth, pipelineCode, variables: options.optional() }),
  run_integration: z.object({
    ...auth,
    jobName: name,
    periodName: period,
    importMode: identifier,
    exportMode: identifier,
    fileName: fileName.optional(),
    executionMode: z.enum(['SYNC', 'ASYNC']).optional(),
    sourceFilters: options.optional(),
    targetOptions: options.optional(),
  }),
  run_data_rule: z.object({
    ...auth,
    ...wait,
    jobName: name,
    startPeriod: period,
    endPeriod: period,
    importMode: z.enum(['APPEND', 'REPLACE', 'RECALCULATE', 'NONE']),
    exportMode: z.enum([
      'STORE_DATA',
      'ADD_DATA',
      'SUBTRACT_DATA',
      'REPLACE_DATA',
      'REPLACE',
      'MERGE',
      'NONE',
    ]),
    fileName: fileName.optional(),
  }),
  run_batch: z.object({ ...auth, ...wait, jobName: name }),
  get_job_status: z.object({
    ...auth,
    ...wait,
    jobId: identifier.regex(/^[1-9]\d*$/, 'A positive Oracle job ID is required'),
  }),
  execute_report: z.object({
    ...auth,
    ...wait,
    jobName: name,
    reportFormatType: z.enum(['PDF', 'XLSX', 'HTML', 'EXCEL']),
    parameters: options,
  }),
  import_mappings: z.object({
    ...auth,
    ...wait,
    dimension: name,
    fileName,
    importMode: z.enum(['MERGE', 'REPLACE']).optional(),
    validationMode: z.boolean().optional(),
    locationName: optionalName,
  }),
  export_mappings: z.object({ ...auth, ...wait, dimension: name, fileName, locationName: name }),
  import_data_integration: z.object({ ...auth, fileName }),
  export_data_integration: z.object({
    ...auth,
    ...wait,
    fileName,
    snapshotType: z.enum(['ALL', 'ALL_INCREMENTAL', 'INCREMENTAL', 'SETUP']),
    overwriteFile: z.boolean().optional(),
  }),
  get_pov_status: z.object({
    ...auth,
    period,
    category: name,
    application: optionalName,
    locationName: optionalName,
  }),
  set_pov_lock: z
    .object({
      ...auth,
      period,
      category: name,
      application: optionalName,
      locationName: optionalName,
      lockType: z.enum(['application', 'location']),
      lockOperation: z.enum(['lock', 'unlock']),
      unlockByLocation: z.boolean().optional(),
    })
    .superRefine((value, context) => {
      const field = value.lockType === 'application' ? 'application' : 'locationName'
      if (!value[field])
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required for this lock type`,
        })
      if (value.lockType === 'location' && value.unlockByLocation !== undefined)
        context.addIssue({
          code: 'custom',
          path: ['unlockByLocation'],
          message: 'Unlock by location applies only to application locks',
        })
    }),
  list_files: z.object(auth),
  upload_file: z.object({
    ...auth,
    file: z.custom<UserFile>(isUserFileWithMetadata, 'One UserFile with full metadata is required'),
    fileName,
    extDirPath: z.string().min(1).max(255).optional(),
  }),
  download_file: z.object({ ...auth, fileName }),
  delete_file: z.object({ ...auth, fileName }),
} as const

export type OracleEpmDataAction = keyof typeof oracleEpmDataSchemas
export type OracleEpmDataInput<A extends OracleEpmDataAction> = z.output<
  (typeof oracleEpmDataSchemas)[A]
>
