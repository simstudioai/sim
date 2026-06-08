/**
 * Builds the GraphQL endpoint URL from a Dagster host, tolerating surrounding whitespace and a
 * trailing slash (e.g. `https://myorg.dagster.cloud/prod` → `https://myorg.dagster.cloud/prod/graphql`).
 */
export function dagsterGraphqlUrl(host: string): string {
  return `${host.trim().replace(/\/$/, '')}/graphql`
}

/**
 * Builds the request headers for a Dagster GraphQL call, attaching the Dagster+ API token when one
 * is provided (omitted for OSS / self-hosted instances).
 */
export function dagsterRequestHeaders(params: { apiKey?: string }): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (params.apiKey) headers['Dagster-Cloud-Api-Token'] = params.apiKey.trim()
  return headers
}

/**
 * Splits a slash-delimited asset key string into a Dagster asset key path
 * (e.g. `prefix/my_asset` → `['prefix', 'my_asset']`).
 */
export function parseAssetKeyPath(input: string): string[] {
  return input
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

/**
 * Parses a comma- or newline-separated list of slash-delimited asset keys into the
 * `[AssetKeyInput!]` shape expected by Dagster (`{ path: string[] }[]`).
 */
export function parseAssetSelection(input: string): Array<{ path: string[] }> {
  return input
    .split(/[\n,]/)
    .map((key) => key.trim())
    .filter(Boolean)
    .map((key) => ({ path: parseAssetKeyPath(key) }))
}

/**
 * Parses a Dagster GraphQL JSON body and throws if the HTTP status is not OK or the payload
 * contains top-level GraphQL errors.
 *
 * Field errors should be requested with `... on Error { __typename message }` (or at least
 * `message`) so union failures are not returned as empty objects.
 */
export async function parseDagsterGraphqlResponse<TData extends Record<string, unknown>>(
  response: Response
): Promise<{ data?: TData }> {
  let payload: {
    data?: TData
    errors?: ReadonlyArray<{ message?: string }>
  }
  try {
    payload = (await response.json()) as {
      data?: TData
      errors?: ReadonlyArray<{ message?: string }>
    }
  } catch {
    throw new Error('Invalid JSON response from Dagster')
  }
  if (!response.ok) {
    throw new Error(payload.errors?.[0]?.message || 'Dagster GraphQL request failed')
  }
  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message ?? 'Dagster GraphQL request failed')
  }
  return { data: payload.data }
}

/**
 * Message from a field that includes `... on Error { message }`, or a fallback when the
 * payload is not a GraphQL `Error` type with a string message.
 */
export function dagsterUnionErrorMessage(
  result: { message?: string } | undefined,
  fallback: string
): string {
  return typeof result?.message === 'string' ? result.message : fallback
}
