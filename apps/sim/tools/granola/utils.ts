/**
 * Base URL for the Granola public API.
 * @see https://docs.granola.ai/api-reference/openapi.json
 */
export const GRANOLA_API_BASE = 'https://public-api.granola.ai/v1'

/**
 * Standard auth headers for every Granola API call. Granola authenticates with
 * a bearer API key (`grn_...`).
 */
export function granolaHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Status-specific guidance for Granola API failures.
 *
 * Granola documents the status codes but not a JSON error body shape, so the
 * raw response text is always appended verbatim rather than being parsed for
 * fields that may not exist.
 */
function granolaStatusHint(status: number, body: string): string | null {
  switch (status) {
    case 401:
      return 'Invalid or expired Granola API key.'
    case 403:
      return 'Access denied. The workspace API access controls may disable a requested scope, or the key may not own this resource.'
    case 404:
      return body.includes('webhook')
        ? 'Not found. The resource may not exist, or the webhooks API is not enabled for this workspace (webhooks require a Business or Enterprise plan).'
        : 'Not found.'
    case 413:
      return 'The transcript is too large to return inline. Use the Get Transcript operation to page through it instead.'
    case 429:
      return 'Rate limited by Granola. Retry after a short delay.'
    default:
      return null
  }
}

/**
 * Read an unsuccessful Granola response and throw a descriptive error.
 * Always throws — the `never` return lets callers use it as an expression.
 */
export async function throwGranolaError(response: Response): Promise<never> {
  const body = await response.text().catch(() => '')
  const hint = granolaStatusHint(response.status, body)
  const detail = [hint, body].filter(Boolean).join(' ')
  throw new Error(`Granola API error (${response.status})${detail ? `: ${detail}` : ''}`)
}

/**
 * Normalize a list-valued parameter into a string array.
 *
 * Block inputs reach tools as user-typed text, so a list can arrive as a real
 * array, a JSON array string, or a comma-separated string. All three are
 * accepted; blank entries are dropped.
 */
export function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    /* An entry can itself still hold a comma-separated list when a single free-text
       value was array-wrapped upstream, so split inside entries too. */
    return value.flatMap((entry) =>
      String(entry)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    )
  }
  if (typeof value !== 'string') return []

  const trimmed = value.trim()
  if (!trimmed) return []

  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.flatMap((entry) =>
          String(entry)
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        )
      }
    } catch {
      /* Fall through to comma-separated parsing. */
    }
  }

  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** The raw webhook endpoint object as returned by the Granola API. */
interface RawGranolaWebhookEndpoint {
  id?: string
  url?: string
  url_redacted?: boolean
  events?: string[]
  folder_ids?: string[]
  scopes?: string[]
  created_by?: { name?: string | null; email?: string } | null
  enabled?: boolean
  created_at?: string
}

/**
 * Map a Granola webhook endpoint onto Sim's camelCase output shape. Shared by
 * the create, list, and update tools, all of which return the same object.
 */
export function mapWebhookEndpoint(raw: RawGranolaWebhookEndpoint) {
  return {
    id: raw.id ?? '',
    url: raw.url ?? '',
    urlRedacted: raw.url_redacted ?? false,
    events: raw.events ?? [],
    folderIds: raw.folder_ids ?? [],
    scopes: raw.scopes ?? [],
    createdByName: raw.created_by?.name ?? null,
    createdByEmail: raw.created_by?.email ?? null,
    enabled: raw.enabled ?? false,
    createdAt: raw.created_at ?? '',
  }
}
