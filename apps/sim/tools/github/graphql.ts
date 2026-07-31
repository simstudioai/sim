/**
 * Shared plumbing for the GitHub GraphQL tools: the endpoint, its headers, and
 * the two response shapes every query has to handle the same way.
 */

import { isRecord, readGitHubErrorMessage } from '@/tools/github/response-parsers'

export const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql'

/** The largest page GitHub's GraphQL connections accept for a `first` argument. */
export const GITHUB_GRAPHQL_MAX_PAGE_SIZE = 100

export function githubGraphQlHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Reads the `data` payload of a GitHub GraphQL response.
 *
 * GitHub answers a failed query with HTTP 200 and an `errors` array, so an ok
 * response is not a successful query — a caller that only checked the status
 * would read a permission failure as an empty result. Throws on either failure
 * shape rather than returning a partial payload.
 */
export async function readGraphQlData(
  response: Response,
  context: string
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new Error(
      (await readGitHubErrorMessage(response)) ?? `${context} failed (HTTP ${response.status})`
    )
  }

  const payload: unknown = await response.json()
  if (!isRecord(payload)) throw new Error(`${context} must be an object`)

  const errors = payload.errors
  if (Array.isArray(errors) && errors.length > 0) {
    const first: unknown = errors[0]
    const message =
      isRecord(first) && typeof first.message === 'string' && first.message.trim()
        ? first.message
        : 'unknown GraphQL error'
    throw new Error(`${context} returned an error: ${message}`)
  }

  const data = payload.data
  if (!isRecord(data)) throw new Error(`${context}.data must be an object`)
  return data
}

/**
 * Reads a `pageInfo` block, tolerating GitHub's `endCursor: null` on the last
 * page.
 */
export function parsePageInfo(
  value: unknown,
  context: string
): { hasNextPage: boolean; endCursor: string | null } {
  if (!isRecord(value)) throw new Error(`${context} must be an object`)
  const hasNextPage = value.hasNextPage
  if (typeof hasNextPage !== 'boolean') {
    throw new Error(`${context}.hasNextPage must be a boolean`)
  }
  const endCursor = value.endCursor
  if (endCursor !== null && typeof endCursor !== 'string') {
    throw new Error(`${context}.endCursor must be a string or null`)
  }
  return { hasNextPage, endCursor }
}
