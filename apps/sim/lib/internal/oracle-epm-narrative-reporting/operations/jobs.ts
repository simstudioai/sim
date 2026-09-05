import { filterUndefined } from '@sim/utils/object'
import { z } from 'zod'
import { OracleEpmError, oracleEpmLocalError } from '@/lib/internal/oracle-epm/errors'
import { pollOracleEpmJob } from '@/lib/internal/oracle-epm/jobs'
import type { OracleEpmValidatedLink } from '@/lib/internal/oracle-epm/types'
import type { NarrativeOperationContext } from '@/lib/internal/oracle-epm-narrative-reporting/operations'
import {
  narrativeEndpoints,
  narrativeJobSelfPolicy,
} from '@/lib/internal/oracle-epm-narrative-reporting/routes'
import {
  type NarrativeExportInput,
  type NarrativeImportInput,
  type NarrativeJob,
  type NarrativeResourceInput,
  type NarrativeWaitInput,
  narrativeJobSchema,
  parseNarrativeJson,
} from '@/lib/internal/oracle-epm-narrative-reporting/schemas'

const jobLinksSchema = z.object({
  links: z
    .array(
      z.object({
        rel: z.string().max(64),
        href: z.string().max(8_192),
        method: z.string().max(8).optional(),
      })
    )
    .max(100)
    .optional(),
})

export async function submitNarrativeJob(
  jobType:
    | 'EXPORT_LIBRARY_ARTIFACT'
    | 'IMPORT_LIBRARY_ARTIFACT'
    | 'CREATE_REPORT_SNAPSHOT'
    | 'REFRESH_RP_DS',
  parameters: Record<string, unknown>,
  context: NarrativeOperationContext
) {
  const response = await context.client.request(narrativeEndpoints.submitJob, {
    json: { jobType, parameters },
    signal: context.signal,
  })
  return { success: true, output: { job: parseNarrativeJson(narrativeJobSchema, response, 201) } }
}

export async function getJob(input: NarrativeResourceInput, context: NarrativeOperationContext) {
  const response = await context.client.request(narrativeEndpoints.getJob, {
    pathParams: { id: input.resourceId },
    signal: context.signal,
  })
  const job = parseNarrativeJson(narrativeJobSchema, response)
  if (job.jobId !== input.resourceId) throw oracleEpmLocalError('invalid_response')
  return { success: true, output: { job } }
}

/** Waits within the execution budget; timeout does not cancel the Oracle job. */
export async function waitForJob(input: NarrativeWaitInput, context: NarrativeOperationContext) {
  let self: OracleEpmValidatedLink | undefined
  let latestJob: NarrativeJob | null = null
  let attempts = 0
  try {
    const result = await pollOracleEpmJob<NarrativeJob, NarrativeJob, NarrativeJob>({
      read: async (signal) => {
        attempts += 1
        const response = self
          ? await context.client.requestValidatedLink(self, signal)
          : await context.client.request(narrativeEndpoints.getJob, {
              pathParams: { id: input.resourceId },
              signal,
            })
        const job = parseNarrativeJson(narrativeJobSchema, response)
        if (job.jobId !== input.resourceId) throw oracleEpmLocalError('invalid_response')
        latestJob = job
        if (!self && job.status === -1) {
          const { links } = parseNarrativeJson(jobLinksSchema, response)
          const matches = links?.filter((link) => link.rel === 'self') ?? []
          if (matches.length > 1) throw oracleEpmLocalError('invalid_response')
          if (matches.length === 1) {
            const link = matches[0]
            const validated = context.client.validateReturnedLink(narrativeJobSelfPolicy, link)
            /** Validate resource identity after the foundation validates the complete URL. */
            const linkedId = decodeURIComponent(new URL(link.href).pathname.split('/').at(-1) ?? '')
            if (linkedId !== input.resourceId) throw oracleEpmLocalError('invalid_response')
            self = validated
          }
        }
        return job
      },
      classify: (job) => {
        if (job.status === -1) return { state: 'pending' }
        if (job.status === 0) return { state: 'success', result: job }
        if (job.status === 1 || job.status === 3) return { state: 'failure', error: job }
        throw oracleEpmLocalError('invalid_response')
      },
      signal: context.signal,
      maxWaitMs: input.maxWaitSeconds * 1_000,
      cleanupReserveMs: 1_000,
      maxAttempts: 120,
      initialDelayMs: 1_000,
      maxDelayMs: 5_000,
    })
    const job = result.state === 'success' ? result.result : result.error
    return {
      success: result.state === 'success',
      ...(result.state === 'failure'
        ? { error: 'Oracle Narrative Reporting job failed or was cancelled' }
        : {}),
      output: {
        job,
        jobId: input.resourceId,
        completed: job.status === 0,
        timedOut: false,
        attempts,
      },
    }
  } catch (error) {
    context.signal?.throwIfAborted()
    const timedOut =
      (error instanceof DOMException && error.name === 'TimeoutError') ||
      (error instanceof OracleEpmError && error.category === 'timeout')
    if (!timedOut) throw error
    return {
      success: true,
      output: {
        job: latestJob,
        jobId: input.resourceId,
        completed: false,
        timedOut: true,
        attempts,
      },
    }
  }
}

export async function exportLibraryArtifact(
  input: NarrativeExportInput,
  context: NarrativeOperationContext
) {
  return submitNarrativeJob(
    'EXPORT_LIBRARY_ARTIFACT',
    filterUndefined({
      artifactName: input.artifactName,
      artifactType: input.artifactType,
      exportLocation: input.exportLocation,
      exportFormat: input.exportFormat,
      exportLibraryFolder: input.exportLibraryFolder,
      saveAsFile: input.saveAsFile,
      applicationName: input.applicationName,
      errorFile: input.errorFile,
    }),
    context
  )
}

export async function importLibraryArtifact(
  input: NarrativeImportInput,
  context: NarrativeOperationContext
) {
  return submitNarrativeJob(
    'IMPORT_LIBRARY_ARTIFACT',
    filterUndefined({
      importFile: input.importFile,
      importLocation: input.importLocation,
      importFormat: input.importFormat,
      importFolder: input.importFolder,
      deleteAfterImport: input.deleteAfterImport,
      importPermissions: input.importPermissions,
      overwrite: input.overwrite,
      errorFile: input.errorFile,
    }),
    context
  )
}
