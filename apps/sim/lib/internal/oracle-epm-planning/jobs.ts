import { z } from 'zod'
import { pollOracleEpmJob } from '@/lib/internal/oracle-epm/jobs'
import { planningEndpoints } from '@/lib/internal/oracle-epm-planning/route-space'
import {
  jobSchema,
  PlanningInputError,
  type PlanningOperationContext,
  parsePlanningResponse,
} from '@/lib/internal/oracle-epm-planning/schema'
import type {
  OracleEpmPlanningResponse,
  PlanningJob,
  PlanningJobParameters,
} from '@/tools/oracle_epm_planning/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_job_status.html */
export function classifyPlanningJob(job: PlanningJob) {
  if (job.status === -1 || job.status === 2) return { state: 'pending' } as const
  if (job.status === 0) return { state: 'success', result: job } as const
  return { state: 'failure', error: job } as const
}

export function planningJobResult(job: PlanningJob): OracleEpmPlanningResponse {
  const failed = classifyPlanningJob(job).state === 'failure'
  return {
    success: !failed,
    output: { job },
    ...(failed
      ? { error: 'Oracle Planning job failed; inspect the returned job status and details' }
      : {}),
  }
}

/** Mutations are submitted once. Waiting is always a separate operation. */
export async function submitPlanningJob(
  input: {
    application: string
    jobType: string
    jobName?: string
    parameters?: PlanningJobParameters
  },
  context: PlanningOperationContext
): Promise<PlanningJob> {
  return parsePlanningResponse(
    jobSchema,
    await context.client.request(planningEndpoints.submitJob, {
      pathParams: { application: input.application },
      json: {
        jobType: input.jobType,
        ...(input.jobName === undefined ? {} : { jobName: input.jobName }),
        ...(input.parameters === undefined ? {} : { parameters: input.parameters }),
      },
      signal: context.signal,
    })
  )
}

export async function readPlanningJob(
  input: { application: string; jobId: string },
  context: PlanningOperationContext
): Promise<PlanningJob> {
  const job = parsePlanningResponse(
    jobSchema,
    await context.client.request(planningEndpoints.job, {
      pathParams: { application: input.application, jobId: input.jobId },
      signal: context.signal,
    })
  )
  if (String(job.jobId) !== input.jobId.replace(/^0+(?=\d)/, '')) {
    throw new PlanningInputError('Oracle returned a different Planning job ID')
  }
  return job
}

export async function waitForPlanningJob(
  input: { application: string; jobId: string; maxWaitSeconds?: number },
  context: PlanningOperationContext
): Promise<OracleEpmPlanningResponse> {
  const terminal = await pollOracleEpmJob({
    read: (signal) => readPlanningJob(input, { ...context, signal }),
    classify: classifyPlanningJob,
    signal: context.signal,
    maxWaitMs: (input.maxWaitSeconds ?? 300) * 1000,
    cleanupReserveMs: 0,
    maxAttempts: 1000,
    initialDelayMs: 1000,
    maxDelayMs: 10_000,
  })
  return planningJobResult(terminal.state === 'success' ? terminal.result : terminal.error)
}

const booleanParameter = z.union([z.boolean(), z.enum(['true', 'false'])])
const nonempty = z.string().min(1)
const missingValue = z.string().regex(/^#?[A-Za-z]{1,16}$/)
/** export_data.html, import_data.html and cube_refresh.html define these job-specific overrides. */
const exportParameters = z
  .object({
    cube: nonempty.optional(),
    rowMembers: nonempty.optional(),
    columnMembers: nonempty.optional(),
    povMembers: nonempty.optional(),
    exportFileName: nonempty.optional(),
    delimiter: z.enum(['comma', 'tab']).optional(),
    exportSmartListAs: z.enum(['label', 'name']).optional(),
    includeDynamicMembers: booleanParameter.optional(),
    exportDataDecimalScale: z
      .union([z.number().int().min(0).max(16), z.string().regex(/^(?:[0-9]|1[0-6])$/)])
      .optional(),
    customMissingValue: missingValue.optional(),
    exportImpliedShareEnabled: booleanParameter.optional(),
  })
  .strict()
const importParameters = z
  .object({
    importFileName: nonempty.optional(),
    sourceType: z.enum(['Planning', 'Essbase']).optional(),
    cube: nonempty.optional(),
    delimiter: z.enum(['comma', 'tab']).optional(),
    dateFormat: z.enum(['MM-DD-YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD']).optional(),
    includeMetaData: booleanParameter.optional(),
    errorFile: nonempty.optional(),
    stopOnError: booleanParameter.optional(),
    customMissingValue: missingValue.optional(),
  })
  .strict()
const refreshParameters = z
  .object({
    allowedUsersDuringCubeRefresh: z.enum(['Administrators', 'All Users']).optional(),
    allowedUsersAfterCubeRefresh: z.enum(['Administrators', 'All Users']).optional(),
    terminateActiveRequestsBeforeCubeRefresh: booleanParameter.optional(),
    logOffAllUsersBeforeCubeRefresh: booleanParameter.optional(),
    generateApplicationDiagnostics: booleanParameter.optional(),
  })
  .strict()

export function validatePlanningJobParameters(
  kind: 'export' | 'import' | 'refresh',
  input: { jobName?: string; cube?: string; fileName?: string; parameters?: PlanningJobParameters }
): PlanningJobParameters {
  const supplied = { ...input.parameters }
  if (input.cube !== undefined) {
    if (supplied.cube !== undefined && supplied.cube !== input.cube)
      throw new PlanningInputError('Cube conflicts with parameters.cube')
    supplied.cube = input.cube
  }
  if (input.fileName !== undefined) {
    if (supplied.importFileName !== undefined && supplied.importFileName !== input.fileName)
      throw new PlanningInputError('File name conflicts with parameters.importFileName')
    supplied.importFileName = input.fileName
  }
  const schema =
    kind === 'export' ? exportParameters : kind === 'import' ? importParameters : refreshParameters
  const parsed = schema.safeParse(supplied)
  if (!parsed.success)
    throw new PlanningInputError(
      'Invalid job-specific parameters; use the parameters documented by Oracle for this job type'
    )
  if (
    !input.jobName &&
    kind === 'export' &&
    ['cube', 'rowMembers', 'columnMembers', 'povMembers'].some((key) => !supplied[key])
  ) {
    throw new PlanningInputError(
      'An export without a configured job requires cube, rowMembers, columnMembers and povMembers'
    )
  }
  if (!input.jobName && kind === 'import') {
    if (
      !supplied.importFileName ||
      !supplied.sourceType ||
      (supplied.sourceType === 'Essbase' && !supplied.cube)
    ) {
      throw new PlanningInputError(
        'An import without a configured job requires a file and sourceType, plus cube for Essbase'
      )
    }
  }
  if (
    kind === 'import' &&
    supplied.sourceType === 'Essbase' &&
    supplied.includeMetaData !== undefined
  ) {
    throw new PlanningInputError('includeMetaData applies only to Planning imports')
  }
  if (
    kind === 'import' &&
    supplied.sourceType === 'Planning' &&
    supplied.stopOnError !== undefined
  ) {
    throw new PlanningInputError('stopOnError applies only to Essbase imports')
  }
  return supplied
}

export function validatePlanningRulePrompts(parameters?: PlanningJobParameters): void {
  if (parameters && Object.values(parameters).some((value) => typeof value !== 'string')) {
    throw new PlanningInputError('Rule runtime prompt values must be strings')
  }
}
