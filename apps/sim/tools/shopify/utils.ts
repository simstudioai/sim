import { isRecordLike } from '@sim/utils/object'
import { SHOPIFY_API_VERSION } from '@/tools/shopify/constants'

interface ShopifyCredentialParams {
  accessToken: string
  shopDomain?: string
  domain?: string
  idToken?: string
}

/** Keeps credential-bearing requests on the connected Shopify store. */
export function getShopifyUrl(params: ShopifyCredentialParams): string {
  const domain = (params.idToken || params.domain || params.shopDomain || '')
    .trim()
    .toLowerCase()
    .replace(/^https:\/\//, '')
    .replace(/\/$/, '')
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(domain)) {
    throw new Error('Invalid Shopify domain: expected a store.myshopify.com hostname')
  }
  return `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`
}

/** Uses the Admin API token header for both OAuth and custom-app credentials. */
export function getShopifyHeaders(params: ShopifyCredentialParams): Record<string, string> {
  if (!params.accessToken) throw new Error('Missing access token for Shopify API request')
  return { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': params.accessToken }
}

/** Bounds one connection page without automatically loading later pages. */
export function getShopifyPageSize(value: number | undefined, maximum = 250): number {
  const size = value ?? 50
  if (!Number.isInteger(size) || size < 1) {
    throw new Error('Page size must be a positive integer')
  }
  return Math.min(size, maximum)
}

/** Parses structured inputs from workflow text fields and direct tool calls. */
function parseShopifyJson<T>(value: T | string | undefined, label: string): T | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error(`${label} must be valid JSON`)
  }
}

/** Validates Shopify's maximum input-array size before sending a mutation. */
export function parseShopifyArray<T>(
  value: T[] | string | undefined,
  label: string
): T[] | undefined {
  const parsed = parseShopifyJson<T[]>(value, label)
  if (parsed === undefined) return undefined
  if (!Array.isArray(parsed) || parsed.length > 250) {
    throw new Error(`${label} must be a JSON array with at most 250 entries`)
  }
  return parsed
}

/** Preserves API input semantics while rejecting non-object JSON. */
export function parseShopifyObject<T extends object>(
  value: T | string | undefined,
  label: string
): T | undefined {
  const parsed = parseShopifyJson<T>(value, label)
  if (parsed !== undefined && !isRecordLike(parsed))
    throw new Error(`${label} must be a JSON object`)
  return parsed
}

/** Reads a selected GraphQL result and rejects HTTP, GraphQL, and missing-resource failures. */
export async function readShopifyResult<T>(response: Response, field: string): Promise<T> {
  const payload: { data?: Record<string, T | null>; errors?: Array<{ message: string }> } =
    await response.json()
  if (!response.ok || payload.errors?.length) {
    throw new Error(
      payload.errors?.map((error) => error.message).join(', ') ||
        `Shopify request failed (${response.status})`
    )
  }
  const result = payload.data?.[field]
  if (result == null) throw new Error(`Shopify ${field} returned no result`)
  return result
}
