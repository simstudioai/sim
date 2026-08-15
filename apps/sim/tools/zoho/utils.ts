/**
 * Zoho data centers Sim supports.
 *
 * Zoho is multi-DC: a user's account lives in exactly one region, and every API
 * host is region-scoped. Zoho's guidance is to never hardcode a single region —
 * the token response carries an `api_domain` naming the caller's CRM host.
 * Sim cannot persist that value (the shared Better Auth `account` table has no
 * column for provider-specific token fields), so the region is selected on the
 * block instead and resolved to hosts here.
 *
 * Only regions whose CRM *and* Desk hosts are confirmed in Zoho's own
 * documentation are listed. CA and SA are deliberately absent: Zoho's accounts
 * docs give `accounts.zohocloud.ca` while the Desk SDK uses `accounts.zoho.ca`,
 * and neither source states their CRM API host.
 *
 * @see https://www.zoho.com/crm/developer/docs/api/v8/multi-dc.html
 */
export const ZOHO_DATA_CENTERS = {
  us: { crm: 'https://www.zohoapis.com', desk: 'https://desk.zoho.com' },
  eu: { crm: 'https://www.zohoapis.eu', desk: 'https://desk.zoho.eu' },
  in: { crm: 'https://www.zohoapis.in', desk: 'https://desk.zoho.in' },
  au: { crm: 'https://www.zohoapis.com.au', desk: 'https://desk.zoho.com.au' },
  jp: { crm: 'https://www.zohoapis.jp', desk: 'https://desk.zoho.jp' },
} as const

export type ZohoDataCenter = keyof typeof ZOHO_DATA_CENTERS

/** Zoho CRM API version pinned across every CRM tool. */
export const ZOHO_CRM_API_VERSION = 'v8'

/**
 * Parses a JSON object supplied either as an object (from the LLM) or as a JSON
 * string (from a block input), and rejects anything that is not a plain object.
 */
export function parseJsonObject(
  value: unknown,
  label: string
): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === '') return undefined
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`${label} must be valid JSON.`)
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

/**
 * Appends only the defined entries of `params` to a URL's query string, so unset
 * optional params never surface as empty values Zoho would reject.
 */
export function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}
