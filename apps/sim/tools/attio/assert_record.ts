import { createLogger } from '@sim/logger'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'
import type { AttioAssertRecordParams, AttioAssertRecordResponse } from './types'
import { RECORD_OUTPUT_PROPERTIES } from './types'

const logger = createLogger('AttioAssertRecord')

/**
 * Normalizes `matchingAttribute` to a non-empty string before it is handed to
 * `URLSearchParams`.
 *
 * The parameter is declared `type: 'string'`, but it is `visibility:
 * 'user-or-llm'` and an LLM can emit an attribute id that looks numeric as a
 * JSON **number**. Calling `.trim()` on the raw value then threw
 * `params.matchingAttribute.trim is not a function` — an unhandled `TypeError`
 * surfaced to the caller instead of a named, actionable error.
 *
 * `null` and `undefined` are rejected *before* coercion, because
 * `String(null)` is the truthy `'null'`: coercing first would send a request
 * matching on an attribute literally named `"null"` rather than reporting the
 * missing value. This mirrors `toGuardedString` in `@/tools/url-path`, which
 * solves the same problem for the path zone but is module-private there; the
 * few lines are duplicated rather than widening that shared module's surface
 * for a single call site.
 *
 * No charset check is applied. Attio documents the value as "the ID or slug of
 * the attribute" and publishes no pattern for a slug, so any allowlist would be
 * a guess that silently rejects legitimate attributes. Correct encoding — not
 * validation — is what confines the value to the query zone.
 */
function requiredQueryValue(value: unknown, paramName: string): string {
  if (value === null || value === undefined) {
    throw new Error(`${paramName} is required`)
  }

  const trimmed = String(value).trim()

  if (!trimmed) {
    throw new Error(`${paramName} is required`)
  }

  return trimmed
}

export const attioAssertRecordTool: ToolConfig<AttioAssertRecordParams, AttioAssertRecordResponse> =
  {
    id: 'attio_assert_record',
    name: 'Attio Assert Record',
    description:
      'Upsert a record in Attio — creates it if no match is found, updates it if a match exists',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'attio',
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'The OAuth access token for the Attio API',
      },
      objectType: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The object type slug (e.g. people, companies)',
      },
      matchingAttribute: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'The attribute slug to match on for upsert (e.g. email_addresses for people, domains for companies)',
      },
      values: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'JSON object of attribute values (e.g. {"email_addresses":[{"email_address":"test@example.com"}]})',
      },
    },

    request: {
      url: (params) => {
        const objectType = safeUrlPathSegment(params.objectType, 'objectType')
        const searchParams = new URLSearchParams()
        searchParams.set(
          'matching_attribute',
          requiredQueryValue(params.matchingAttribute, 'matchingAttribute')
        )
        return `https://api.attio.com/v2/objects/${objectType}/records?${searchParams.toString()}`
      },
      method: 'PUT',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
      body: (params) => {
        let values: Record<string, unknown>
        try {
          values = typeof params.values === 'string' ? JSON.parse(params.values) : params.values
        } catch {
          throw new Error('Invalid JSON provided for record values')
        }
        return { data: { values } }
      },
    },

    transformResponse: async (response) => {
      const data = await response.json()
      if (!response.ok) {
        logger.error('Attio API request failed', { data, status: response.status })
        throw new Error(data.message || 'Failed to assert record')
      }
      const record = data.data
      return {
        success: true,
        output: {
          record,
          recordId: record.id?.record_id ?? null,
          webUrl: record.web_url ?? null,
        },
      }
    },

    outputs: {
      record: {
        type: 'object',
        description: 'The upserted record',
        properties: RECORD_OUTPUT_PROPERTIES,
      },
      recordId: { type: 'string', description: 'The record ID' },
      webUrl: { type: 'string', description: 'URL to view the record in Attio' },
    },
  }
