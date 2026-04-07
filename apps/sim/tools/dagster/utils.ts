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
