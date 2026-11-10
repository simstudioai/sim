import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecord, toRecordOrNull } from '@sim/utils/object'
import type {
  PiloterrDetectTechnologiesParams,
  PiloterrDetectTechnologiesResponse,
  PiloterrTechnology,
  PiloterrTechnologyCategory,
} from '@/tools/piloterr/types'
import { PILOTERR_TECHNOLOGY_OUTPUT_PROPERTIES } from '@/tools/piloterr/types'
import type { ToolConfig } from '@/tools/types'

/** Reads a `PiloterrTechnologyCategory` from an untyped Piloterr API payload. */
function mapPiloterrTechnologyCategory(value: unknown): PiloterrTechnologyCategory | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    name: toStringOrNull(record.name),
    slug: toStringOrNull(record.slug),
  }
}

/** Reads a `PiloterrTechnology` from an untyped Piloterr API payload. */
function mapPiloterrTechnology(value: unknown): PiloterrTechnology | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    name: toStringOrNull(record.name),
    slug: toStringOrNull(record.slug),
    version: toStringOrNull(record.version),
    website: toStringOrNull(record.website),
    description: toStringOrNull(record.description),
    confidence: toNumberOrNull(record.confidence),
    categories: toArray(record.categories)
      .map(mapPiloterrTechnologyCategory)
      .filter((item): item is PiloterrTechnologyCategory => item !== null),
  }
}

export const piloterrDetectTechnologiesTool: ToolConfig<
  PiloterrDetectTechnologiesParams,
  PiloterrDetectTechnologiesResponse
> = {
  id: 'piloterr_detect_technologies',
  name: 'Piloterr Detect Technologies',
  description:
    'Detect the technologies a website runs, such as its CMS, frameworks, analytics, CDN and hosting.',
  version: '1.0.0',

  params: {
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'URL of the page (e.g., "https://example.com")',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Piloterr API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.piloterr.com/v2/website/technology`)
      url.searchParams.set('query', params.url.trim())
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        technologies: toArray(data.technologies)
          .map(mapPiloterrTechnology)
          .filter((item): item is PiloterrTechnology => item !== null),
      },
    }
  },

  outputs: {
    technologies: {
      type: 'array',
      description: 'Technologies detected on the website',
      optional: true,
      items: { type: 'object', properties: PILOTERR_TECHNOLOGY_OUTPUT_PROPERTIES },
    },
  },
}
