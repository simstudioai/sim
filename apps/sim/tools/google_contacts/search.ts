import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  DEFAULT_PERSON_FIELDS,
  type GoogleContactsSearchParams,
  type GoogleContactsSearchResponse,
  PEOPLE_API_BASE,
  transformPerson,
} from '@/tools/google_contacts/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

const logger = createLogger('GoogleContactsSearch')

/**
 * Minimal read mask for the warmup call. The warmup exists to refresh the
 * server-side cache, not to return data, so the response is discarded — asking
 * for names alone keeps the extra request as cheap as the API allows.
 */
const WARMUP_PERSON_FIELDS = 'names'

/**
 * Builds a `people:searchContacts` URL.
 * @param query - The search query; empty for the cache warmup request
 * @param readMask - Person fields to return
 * @param pageSize - Optional result count (values above 30 are capped by Google)
 */
function buildSearchUrl(query: string, readMask: string, pageSize?: number): string {
  const queryParams = new URLSearchParams()
  queryParams.append('query', query)
  queryParams.append('readMask', readMask)
  if (pageSize) queryParams.append('pageSize', pageSize.toString())
  return `${PEOPLE_API_BASE}/people:searchContacts?${queryParams.toString()}`
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Sends the warmup request Google requires before a search.
 *
 * The People API discovery document says so verbatim on
 * `people.searchContacts`: "**IMPORTANT**: Before searching, clients should
 * send a warmup request with an empty query to update the cache." The guide
 * shows the same thing as a `// Warmup cache` call preceding the real one.
 *
 * Google does not describe what a cold cache returns, and does not publish a
 * cache TTL, so nothing here can decide when the warmup would be skippable —
 * and the tool holds no state between invocations to decide with. It therefore
 * runs on every search, at the cost of one extra read.
 *
 * No fixed delay separates the two requests, and the warmup's round-trip is
 * not offered as a substitute for one: Google's Protocol sample says "Send
 * search request after several seconds", which a ~100–300 ms round-trip plainly
 * is not. The wait is deliberately skipped as a latency trade-off — adding
 * seconds to every search would cost more than an occasionally stale first
 * result. (Google's own Java sample is self-contradictory here: the comment
 * reads "Wait a few seconds" while the call is `Thread.sleep(5)`, five
 * *milliseconds*.)
 *
 * A failed warmup never fails the search; it only means results may be stale.
 * @see https://developers.google.com/people/v1/contacts#search_the_users_contacts
 */
async function warmSearchCache(accessToken: string, signal?: AbortSignal): Promise<void> {
  try {
    const response = await fetch(buildSearchUrl('', WARMUP_PERSON_FIELDS), {
      headers: authHeaders(accessToken),
      signal,
    })
    await response.arrayBuffer().catch(() => undefined)
    if (!response.ok) {
      logger.warn('Contacts search cache warmup failed; results may be stale', {
        status: response.status,
      })
    }
  } catch (error) {
    logger.warn('Contacts search cache warmup failed; results may be stale', {
      error: getErrorMessage(error),
    })
  }
}

async function transformSearchResponse(response: Response): Promise<GoogleContactsSearchResponse> {
  const data = await response.json()

  if (!response.ok) {
    const errorMessage = data.error?.message || 'Failed to search contacts'
    logger.error('Failed to search contacts', { status: response.status, error: errorMessage })
    throw new Error(errorMessage)
  }

  const results = data.results || []
  const contacts = results.map((result: Record<string, any>) =>
    transformPerson(result.person || result)
  )

  return {
    success: true,
    output: {
      content: `Found ${contacts.length} contact${contacts.length !== 1 ? 's' : ''} matching query`,
      metadata: {
        contacts,
      },
    },
  }
}

export const searchTool: ToolConfig<GoogleContactsSearchParams, GoogleContactsSearchResponse> = {
  id: 'google_contacts_search',
  name: 'Google Contacts Search',
  description: 'Search contacts in Google Contacts by name, email, phone, or organization',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-contacts',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Google People API',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query to match against contact names, emails, phones, and organizations',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default 10, max 30)',
    },
  },

  /**
   * Warms the People API search cache before searching, which the declarative
   * single-request path cannot express.
   */
  directExecution: async (params, signal): Promise<ToolResponse> => {
    await warmSearchCache(params.accessToken, signal)

    const response = await fetch(
      buildSearchUrl(params.query, DEFAULT_PERSON_FIELDS, params.pageSize),
      { headers: authHeaders(params.accessToken), signal }
    )
    return transformSearchResponse(response)
  },

  /**
   * Declarative fallback. `directExecution` is the authoritative path; this one
   * searches without the warmup and so may see a stale cache.
   */
  request: {
    url: (params: GoogleContactsSearchParams) =>
      buildSearchUrl(params.query, DEFAULT_PERSON_FIELDS, params.pageSize),
    method: 'GET',
    headers: (params: GoogleContactsSearchParams) => authHeaders(params.accessToken),
  },

  transformResponse: transformSearchResponse,

  outputs: {
    content: { type: 'string', description: 'Summary of search results count' },
    metadata: {
      type: 'json',
      description: 'Search results with matching contacts',
    },
  },
}
