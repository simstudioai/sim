import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  HARMONIC_CONTACT_OUTPUT_PROPERTIES,
  type HarmonicEnrichPersonParams,
  type HarmonicEnrichPersonResponse,
} from '@/tools/harmonic/types'
import {
  buildEnrichPersonUrl,
  harmonicHeaders,
  normalizeOptionalPerson,
  nullableResponseString,
  responseRecord,
} from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

export const harmonicEnrichPersonTool: ToolConfig<
  HarmonicEnrichPersonParams,
  HarmonicEnrichPersonResponse
> = {
  id: 'harmonic_enrich_person',
  name: 'Harmonic Enrich Person',
  description:
    'Resolve a LinkedIn profile URL or email address into a normalized Harmonic contact, queueing enrichment when the person is not yet in Harmonic.',
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
    linkedinUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'LinkedIn profile URL, e.g. https://www.linkedin.com/in/example',
    },
    email: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email address used as a fallback when the LinkedIn URL is absent or unmatched',
    },
  },

  request: {
    url: (params) => buildEnrichPersonUrl(params.linkedinUrl, params.email),
    method: 'POST',
    headers: (params) => harmonicHeaders(params.accessToken),
  },

  /**
   * Harmonic answers 200 for a fresh record and 201 when it queued a background
   * refresh; both bodies are a person, so both are projected the same way.
   *
   * A 404 means the person is not in Harmonic yet and enrichment was scheduled.
   * The shared executor rejects every non-2xx before `transformResponse` runs, so
   * that case never reaches this projection; the Harmonic error extractor lifts
   * both the message and the scheduled `enrichment_urn` out of the 404 envelope so
   * the job stays pollable with Get Enrichment Status.
   */
  transformResponse: async (response) => {
    const payload = await response.json()
    const contact = normalizeOptionalPerson(payload)
    if (!contact) {
      return {
        success: true,
        output: {
          contact: null,
          enrichmentUrn: null,
          mergedPersonUrn: null,
          requestedEntityUrn: null,
          found: false,
          enrichmentQueued: false,
        },
      }
    }

    const data = responseRecord(payload, 'person enrichment')
    return {
      success: true,
      output: {
        contact,
        enrichmentUrn: nullableResponseString(data.enrichment_urn),
        mergedPersonUrn: nullableResponseString(data.merged_person_urn),
        requestedEntityUrn: nullableResponseString(data.requested_entity_urn),
        found: true,
        enrichmentQueued: response.status === 201,
      },
    }
  },

  outputs: {
    contact: {
      type: 'object',
      nullable: true,
      description: 'Normalized Harmonic contact, or null when the person is not yet in Harmonic',
      properties: HARMONIC_CONTACT_OUTPUT_PROPERTIES,
    },
    enrichmentUrn: {
      type: 'string',
      nullable: true,
      description:
        'Enrichment URN to poll with Get Enrichment Status when Harmonic queued a refresh',
    },
    mergedPersonUrn: {
      type: 'string',
      nullable: true,
      description: 'URN this person was merged into, when Harmonic deduplicated the record',
    },
    requestedEntityUrn: {
      type: 'string',
      nullable: true,
      description: 'Person URN Harmonic matched the request to',
    },
    found: { type: 'boolean', description: 'Whether Harmonic returned a person profile' },
    enrichmentQueued: {
      type: 'boolean',
      description: 'Whether Harmonic queued a background refresh (HTTP 201) for this person',
    },
  },
}
