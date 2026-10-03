import type { ProviderRequest } from '@/providers/types'

/** OpenAI-compatible `json_schema` response format sent to chat-completions providers. */
export interface JsonSchemaResponseFormat {
  type: 'json_schema'
  json_schema: {
    name: string
    schema: Record<string, unknown>
    strict?: boolean
  }
}

/**
 * Builds the OpenAI-compatible `json_schema` response format from a request's `responseFormat`.
 * Strict mode is on unless the caller set `strict: false`; `includeStrict: false` leaves the
 * `strict` flag out of the payload entirely.
 */
export function buildJsonSchemaResponseFormat(
  responseFormat: NonNullable<ProviderRequest['responseFormat']>,
  { includeStrict = true }: { includeStrict?: boolean } = {}
): JsonSchemaResponseFormat {
  return {
    type: 'json_schema',
    json_schema: {
      name: responseFormat.name || 'response_schema',
      schema: responseFormat.schema || responseFormat,
      ...(includeStrict ? { strict: responseFormat.strict !== false } : {}),
    },
  }
}
