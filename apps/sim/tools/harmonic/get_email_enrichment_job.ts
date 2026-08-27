import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  HARMONIC_EMAIL_JOB_COUNTS_OUTPUT_PROPERTIES,
  HARMONIC_EMAIL_JOB_ITEM_OUTPUT_PROPERTIES,
  type HarmonicGetEmailEnrichmentJobParams,
  type HarmonicGetEmailEnrichmentJobResponse,
} from '@/tools/harmonic/types'
import {
  HARMONIC_API_BASE,
  HARMONIC_EMAIL_JOB_TERMINAL_STATUSES,
  harmonicHeaders,
  normalizeEmailJobCounts,
  normalizeEmailJobResults,
  nullableResponseString,
  requireIdentifier,
  responseRecord,
} from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

export const harmonicGetEmailEnrichmentJobTool: ToolConfig<
  HarmonicGetEmailEnrichmentJobParams,
  HarmonicGetEmailEnrichmentJobResponse
> = {
  id: 'harmonic_get_email_enrichment_job',
  name: 'Harmonic Get Email Enrichment Job',
  description:
    'Check a Harmonic bulk email enrichment job. Per-person results appear once the job is terminal; fetch the emails with Get Person or Batch Get People.',
  version: '1.0.0',
  oauth: { required: true, provider: 'harmonic' },
  errorExtractor: ErrorExtractorId.HARMONIC_ERRORS,

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Harmonic credential resolved by the connected account',
    },
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Job ID returned by Submit Email Enrichment Job',
    },
  },

  request: {
    url: (params) =>
      `${HARMONIC_API_BASE}/email_enrichment/jobs/${encodeURIComponent(
        requireIdentifier(params.jobId, 'jobId')
      )}`,
    method: 'GET',
    headers: (params) => harmonicHeaders(params.accessToken),
  },

  /**
   * Harmonic leaves `results` null until the job reaches a terminal state, and the
   * per-person rows carry a status only — never an email. `succeededPersonUrns` is
   * the hand-off into Batch Get People, where the resolved address arrives in `contact`.
   */
  transformResponse: async (response) => {
    const data = responseRecord(await response.json(), 'email enrichment job')
    const jobId = nullableResponseString(data.job_id)
    const status = nullableResponseString(data.status)
    if (!jobId || !status) {
      throw new Error('Harmonic returned an email enrichment job without an ID or status')
    }

    const results = normalizeEmailJobResults(data.results)
    return {
      success: true,
      output: {
        jobId,
        status,
        isTerminal: HARMONIC_EMAIL_JOB_TERMINAL_STATUSES.has(status),
        counts: normalizeEmailJobCounts(data.counts),
        results,
        succeededPersonUrns: (results ?? [])
          .filter((item) => item.status === 'SUCCESS')
          .map((item) => item.personUrn),
        createdAt: nullableResponseString(data.created_at) ?? '',
        completedAt: nullableResponseString(data.completed_at),
      },
    }
  },

  outputs: {
    jobId: { type: 'string', description: 'Job identifier' },
    status: {
      type: 'string',
      description: 'Job status (PENDING, IN_PROGRESS, COMPLETED, FAILED)',
    },
    isTerminal: {
      type: 'boolean',
      description: 'Whether the job finished, meaning results will no longer change',
    },
    counts: {
      type: 'object',
      description: 'Per-outcome tallies for the job',
      properties: HARMONIC_EMAIL_JOB_COUNTS_OUTPUT_PROPERTIES,
    },
    results: {
      type: 'array',
      nullable: true,
      description: 'Per-person outcomes; null until the job reaches a terminal status',
      items: { type: 'object', properties: HARMONIC_EMAIL_JOB_ITEM_OUTPUT_PROPERTIES },
    },
    succeededPersonUrns: {
      type: 'array',
      description: 'Person URNs whose email was found; pass these to Batch Get People',
      items: { type: 'string', description: 'Harmonic person URN' },
    },
    createdAt: { type: 'string', description: 'Job creation timestamp' },
    completedAt: { type: 'string', nullable: true, description: 'Job completion timestamp' },
  },
}
