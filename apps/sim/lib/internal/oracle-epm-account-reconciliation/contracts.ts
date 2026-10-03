import { z } from 'zod'
import { isTimeoutAbortReason } from '@/lib/core/execution-limits'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import {
  createOracleEpmClient,
  type OracleEpmClientResponse,
  OracleEpmError,
} from '@/lib/internal/oracle-epm'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import type { UserFile } from '@/executor/types'
import type { OracleEpmAccountReconciliationResponse } from '@/tools/oracle_epm_account_reconciliation/types'

const text = z.string().trim().min(1).max(1_000)
const repositoryName = z.string().min(1).max(255)
const jobId = z
  .string()
  .trim()
  .regex(/^[0-9]{1,20}$/)
const auth = {
  accessToken: z.string().min(1).max(4_096),
  instanceUrl: z.string().min(1).max(2_048),
}
const FileInputSchema = z.custom<UserFile>(isUserFileWithMetadata)

/** Reject incomplete filters before an archive or purge can become broader than requested. */
function hasCompleteAccountFilter(value: {
  filterOperator?: string
  filterValue?: string[]
}): boolean {
  return (value.filterOperator === undefined) === (value.filterValue === undefined)
}

/** Product-local contracts; unknown tool fields cannot become provider request fields. */
export const arcsInputSchemas = {
  add_users_to_team: z.object({
    ...auth,
    fileName: repositoryName,
    teamName: text,
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  archive_matched_transactions: z
    .object({
      ...auth,
      matchTypeId: text,
      age: z.number().int().nonnegative().safe(),
      filterOperator: z
        .enum(['EQUALS', 'NOT_EQUALS', 'STARTS_WITH', 'ENDS_WITH', 'CONTAINS', 'NOT_CONTAINS'])
        .optional(),
      filterValue: z.array(text).min(1).max(10_000).optional(),
      logFileName: repositoryName.optional(),
      fileName: repositoryName.optional(),
      waitForCompletion: z.boolean().optional(),
      maxWaitSeconds: z.number().int().min(5).max(300).optional(),
    })
    .refine(hasCompleteAccountFilter, 'Supply filterOperator and filterValue together'),
  create_reconciliations: z.object({
    ...auth,
    period: text,
    filter: text.optional(),
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  delete_file: z.object({
    ...auth,
    fileName: repositoryName,
  }),
  delete_profile: z.object({
    ...auth,
    accountId: text,
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  download_comment_attachment: z.object({
    ...auth,
    period: text,
    accountId: text,
    referenceId: jobId,
  }),
  download_file: z.object({
    ...auth,
    fileName: repositoryName,
  }),
  export_user_details_report: z.object({
    ...auth,
    fileName: repositoryName,
    format: z.enum(['CSV', 'XLS']).optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  get_compliance_job_status: z.object({
    ...auth,
    jobId: jobId,
  }),
  get_matching_job_status: z.object({
    ...auth,
    jobId: jobId,
  }),
  import_balances: z.object({
    ...auth,
    period: text,
    dataLoadDefinition: text,
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  import_compliance_transactions: z.object({
    ...auth,
    fileName: repositoryName,
    period: text,
    transactionType: z.enum(['BEX', 'SRC', 'SUB', 'VEX']),
    dateFormat: text,
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  import_matching_transactions: z.object({
    ...auth,
    fileName: repositoryName,
    matchTypeId: text,
    dataSource: text,
    dateFormat: text,
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  import_premapped_balances: z.object({
    ...auth,
    fileName: repositoryName,
    period: text,
    balanceType: z.enum(['SRC', 'SUB']),
    currencyBucket: text,
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  import_profiles: z.object({
    ...auth,
    fileName: repositoryName,
    importType: z.enum(['Replace', 'Update']),
    profileType: z.enum(['Profiles', 'Children']),
    dateFormat: text,
    period: text.optional(),
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  import_rates: z.object({
    ...auth,
    fileName: repositoryName,
    period: text,
    rateType: text,
    importType: z.enum(['Replace', 'ReplaceAll']),
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  import_reconciliation_attributes: z.object({
    ...auth,
    fileName: repositoryName,
    period: text,
    rules: text
      .regex(
        /^(ALL|SET_ATTR_VAL|CRT_ALT|AUTO_APP|AUTO_SUB)(,(ALL|SET_ATTR_VAL|CRT_ALT|AUTO_APP|AUTO_SUB))*$/
      )
      .optional(),
    reopen: z.boolean().optional(),
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  list_files: z.object({
    ...auth,
  }),
  list_periods: z.object({
    ...auth,
    status: z.enum(['ALL', 'OPEN', 'CLOSED', 'LOCKED', 'PENDING', 'OPEN_PENDING']).optional(),
  }),
  list_reconciliation_comments: z.object({
    ...auth,
    period: text,
    accountId: text,
  }),
  list_users: z.object({
    ...auth,
    userlogin: text.optional(),
    userattribute: text.optional(),
    epmgroups: z.boolean().optional(),
    idcsgroups: z.boolean().optional(),
    applicationroles: z.boolean().optional(),
    granularroles: z.boolean().optional(),
    indirect: z.boolean().optional(),
  }),
  monitor_reconciliations: z.object({
    ...auth,
    periodName: text,
    filterName: text,
  }),
  purge_archived_transactions: z.object({
    ...auth,
    jobId: jobId,
    logFileName: repositoryName.optional(),
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  purge_matched_transactions: z
    .object({
      ...auth,
      matchTypeId: text,
      age: z.number().int().nonnegative().safe(),
      filterOperator: z
        .enum(['EQUALS', 'NOT_EQUALS', 'STARTS_WITH', 'ENDS_WITH', 'CONTAINS', 'NOT_CONTAINS'])
        .optional(),
      filterValue: z.array(text).min(1).max(10_000).optional(),
      logFileName: repositoryName.optional(),
      waitForCompletion: z.boolean().optional(),
      maxWaitSeconds: z.number().int().min(5).max(300).optional(),
    })
    .refine(hasCompleteAccountFilter, 'Supply filterOperator and filterValue together')
    .refine(
      (value) =>
        !value.filterOperator ||
        ['EQUALS', 'NOT_EQUALS'].includes(value.filterOperator) ||
        value.filterValue?.length === 1,
      'Pattern filters support exactly one value'
    ),
  remove_users_from_team: z.object({
    ...auth,
    fileName: repositoryName,
    teamName: text,
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  run_auto_alert: z.object({
    ...auth,
    matchTypeId: text,
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  run_auto_match: z.object({
    ...auth,
    matchTypeId: text,
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  run_profile_rules: z.object({
    ...auth,
    period: text,
    filter: text.optional(),
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  run_reconciliation_rules: z.object({
    ...auth,
    period: text,
    filter: text.optional(),
    ruleTypes: text.optional(),
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  set_period_status: z.object({
    ...auth,
    period: text,
    status: z.enum(['pending', 'open', 'closed', 'locked']),
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  unmatch_auto_match_job: z.object({
    ...auth,
    autoMatchJobId: z.number().int().nonnegative().safe(),
    createReverseAdjustment: z.boolean(),
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  unmatch_transactions: z.object({
    ...auth,
    matchTypeId: text,
    matchIds: z.array(z.number().int().positive().safe()).min(1).max(10_000),
    forceReopen: z.boolean().optional(),
    waitForCompletion: z.boolean().optional(),
    maxWaitSeconds: z.number().int().min(5).max(300).optional(),
  }),
  upload_file: z.object({
    ...auth,
    file: FileInputSchema,
    fileName: repositoryName.optional(),
    extDirPath: text.optional(),
  }),
}

export class ArcsContractError extends Error {}

/** Parses only documented fields; provider prose is retained as prose, not structured records. */
export const arcsJobSchema = z.object({
  status: z.number().int().min(-1),
  details: z.string().nullable().optional(),
  links: z
    .array(
      z.object({
        rel: z.string().max(128),
        href: z.string().max(8_192),
        action: z.string().max(16),
      })
    )
    .max(100)
    .optional(),
})

export type ArcsJob = z.output<typeof arcsJobSchema>
export type ArcsLink = NonNullable<ArcsJob['links']>[number]

export const arcsStatusSchema = z.object({
  status: z.number().int().min(-1),
  details: z.string().nullable().optional(),
})

export const arcsPeriodsSchema = arcsStatusSchema.extend({
  items: z
    .array(z.object({ Id: z.string(), Name: z.string(), Status: z.enum(['51', '52', '53', '54']) }))
    .max(20_000),
})

export const arcsFilesSchema = arcsStatusSchema.extend({
  items: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(['EXTERNAL', 'LCM']),
        size: z.string().nullable(),
        lastmodifiedtime: z.string().nullable(),
      })
    )
    .max(20_000),
})

export const arcsCommentsSchema = z
  .array(
    z.object({
      commentId: z.number().int().safe(),
      parentObjectId: z.number().int().safe(),
      commentText: z.string(),
      postedBy: z.string(),
      postedDate: z.string(),
      references: z
        .array(
          z.object({
            referenceId: z.number().int().safe(),
            type: z.enum(['FILE', 'URL']),
            name: z.string(),
            url: z.string().nullable(),
            fileDownloadLink: z.string().nullable(),
          })
        )
        .max(10_000),
    })
  )
  .max(20_000)

const group = z.object({ groupname: z.string(), description: z.string(), type: z.string() })
const role = z.object({ rolename: z.string(), id: z.string() })
export const arcsUsersSchema = z.object({
  status: z.number().int().nonnegative(),
  error: z.object({ errorcode: z.string(), errormessage: z.string() }).nullable(),
  details: z
    .array(
      z.object({
        userlogin: z.string(),
        firstname: z.string(),
        lastname: z.string(),
        email: z.string(),
        epmgroups: z.array(group).max(10_000).optional(),
        idcsgroups: z.array(group).max(10_000).optional(),
        applicationroles: z.array(role).max(10_000).optional(),
        granularroles: z.array(role).max(10_000).optional(),
      })
    )
    .max(20_000)
    .nullable(),
})

export function parseArcsResponse<T>(schema: z.ZodType<T>, response: OracleEpmClientResponse): T {
  if (!('data' in response))
    throw new ArcsContractError('Oracle EPM returned an unexpected response format')
  const parsed = schema.safeParse(response.data)
  if (!parsed.success)
    throw new ArcsContractError('Oracle EPM returned an undocumented or malformed response')
  return parsed.data
}

export function arcsFailure(
  error: unknown,
  output: OracleEpmAccountReconciliationResponse['output'] = {}
): OracleEpmAccountReconciliationResponse {
  if (
    isTimeoutAbortReason(error) ||
    (error instanceof DOMException && error.name === 'TimeoutError')
  ) {
    return { success: false, error: 'Oracle EPM operation exceeded its time budget', output }
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { success: false, error: 'Oracle EPM operation was cancelled', output }
  }
  return {
    success: false,
    error:
      error instanceof ArcsContractError || error instanceof OracleEpmError
        ? error.message
        : 'Oracle EPM operation could not be completed',
    output,
  }
}

/** Validates internal inputs before constructing the credential-bound provider client. */
export async function executeArcsOperation<T extends { accessToken: string; instanceUrl: string }>(
  schema: z.ZodType<T>,
  input: unknown,
  signal: AbortSignal | undefined,
  context: InternalToolOperationContext | undefined,
  execute: (
    params: T,
    client: ReturnType<typeof createOracleEpmClient>,
    signal: AbortSignal | undefined,
    context: InternalToolOperationContext | undefined
  ) => Promise<OracleEpmAccountReconciliationResponse>
): Promise<OracleEpmAccountReconciliationResponse> {
  const parsed = schema.safeParse(input)
  if (!parsed.success)
    return arcsFailure(new ArcsContractError('Missing or invalid Oracle EPM operation parameters'))
  try {
    signal?.throwIfAborted()
    return await execute(parsed.data, createOracleEpmClient(parsed.data), signal, context)
  } catch (error) {
    return arcsFailure(error)
  }
}
