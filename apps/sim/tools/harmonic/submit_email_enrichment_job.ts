import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  HARMONIC_DROPPED_IDENTIFIER_OUTPUT_PROPERTIES,
  type HarmonicSubmitEmailEnrichmentJobParams,
  type HarmonicSubmitEmailEnrichmentJobResponse,
} from '@/tools/harmonic/types'
import {
  buildEmailEnrichmentJobBody,
  HARMONIC_API_BASE,
  harmonicHeaders,
  normalizeDroppedIdentifiers,
  responseRecord,
} from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

export const harmonicSubmitEmailEnrichmentJobTool: ToolConfig<
  HarmonicSubmitEmailEnrichmentJobParams,
  HarmonicSubmitEmailEnrichmentJobResponse
> = {
  id: 'harmonic_submit_email_enrichment_job',
  name: 'Harmonic Submit Email Enrichment Job',
  description:
    'Queue bulk email enrichment for up to 5,000 people, given either person URNs or LinkedIn profile URLs.',
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
    personUrns: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of Harmonic person URNs, 1-5000; may be a JSON-array string. Mutually exclusive with personLinkedinUrls',
    },
    personLinkedinUrls: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of LinkedIn profile URLs, 1-5000; may be a JSON-array string. Mutually exclusive with personUrns',
    },
  },

  request: {
    url: `${HARMONIC_API_BASE}/email_enrichment/jobs`,
    method: 'POST',
    headers: (params) => harmonicHeaders(params.accessToken, { json: true }),
    body: (params) => buildEmailEnrichmentJobBody(params.personUrns, params.personLinkedinUrls),
  },

  transformResponse: async (response) => {
    const data = responseRecord(await response.json(), 'email enrichment job')
    const jobId = typeof data.job_id === 'string' ? data.job_id.trim() : ''
    const status = typeof data.status === 'string' ? data.status.trim() : ''
    if (!jobId || !status) {
      throw new Error('Harmonic returned an email enrichment job without an ID or status')
    }
    if (typeof data.accepted_count !== 'number' || typeof data.monthly_remaining !== 'number') {
      throw new Error('Harmonic returned an email enrichment job without usable counters')
    }

    return {
      success: true,
      output: {
        jobId,
        status,
        acceptedCount: data.accepted_count,
        monthlyRemaining: data.monthly_remaining,
        createdAt: typeof data.created_at === 'string' ? data.created_at : '',
        dropped: normalizeDroppedIdentifiers(data.dropped),
      },
    }
  },

  outputs: {
    jobId: { type: 'string', description: 'Job identifier to poll with Get Email Enrichment Job' },
    status: {
      type: 'string',
      description: 'Job status (PENDING, IN_PROGRESS, COMPLETED, FAILED)',
    },
    acceptedCount: { type: 'number', description: 'People accepted into the job' },
    monthlyRemaining: {
      type: 'number',
      description: 'Email enrichments left in the team monthly quota',
    },
    createdAt: { type: 'string', description: 'Job creation timestamp' },
    dropped: {
      type: 'array',
      description: 'Identifiers Harmonic dropped before queueing, with the reason for each',
      items: { type: 'object', properties: HARMONIC_DROPPED_IDENTIFIER_OUTPUT_PROPERTIES },
    },
  },
}
