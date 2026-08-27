import type {
  ZeliqAsyncEnrichmentResponse,
  ZeliqEnrichEmailParams,
  ZeliqEnrichPhoneParams,
} from '@/tools/zeliq/types'

interface ZeliqEmailRequestBody {
  callback_url: string
  linkedin_url?: string
  first_name?: string
  last_name?: string
  company?: string
  domain?: string
}

interface ZeliqPhoneRequestBody {
  callback_url: string
  linkedin_url?: string
  email?: string
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Zeliq ${fieldName} must be a non-empty string`)
  }
  return value.trim()
}

function optionalNonEmptyString(value: unknown, fieldName: string): string | undefined {
  if (value == null) return undefined
  return requireNonEmptyString(value, fieldName)
}

function requireHttpUrl(value: unknown, fieldName: string): string {
  const normalized = requireNonEmptyString(value, fieldName)
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    throw new Error(`Zeliq ${fieldName} must be a valid HTTP or HTTPS URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Zeliq ${fieldName} must be a valid HTTP or HTTPS URL`)
  }
  return normalized
}

function optionalLinkedInUrl(value: unknown): string | undefined {
  if (value == null) return undefined
  const normalized = requireHttpUrl(value, 'linkedinUrl')
  const hostname = new URL(normalized).hostname.toLowerCase()
  if (hostname !== 'linkedin.com' && !hostname.endsWith('.linkedin.com')) {
    throw new Error('Zeliq linkedinUrl must point to linkedin.com')
  }
  return normalized
}

function requireEmail(value: unknown): string {
  const normalized = requireNonEmptyString(value, 'email')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('Zeliq email must be a valid email address')
  }
  return normalized
}

export function buildZeliqHeaders(apiKey: unknown): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': requireNonEmptyString(apiKey, 'apiKey'),
    'x-request-origin': 'sim',
  }
}

export function buildZeliqEmailRequestBody(params: ZeliqEnrichEmailParams): ZeliqEmailRequestBody {
  const callbackUrl = requireHttpUrl(params.callbackUrl, 'callbackUrl')
  const linkedinUrl = optionalLinkedInUrl(params.linkedinUrl)
  const firstName = optionalNonEmptyString(params.firstName, 'firstName')
  const lastName = optionalNonEmptyString(params.lastName, 'lastName')
  const company = optionalNonEmptyString(params.company, 'company')
  const domain = optionalNonEmptyString(params.domain, 'domain')
  const hasPersonDetails = Boolean(firstName || lastName || company || domain)

  if (linkedinUrl && hasPersonDetails) {
    throw new Error(
      'Zeliq email enrichment accepts linkedinUrl or firstName + lastName + company/domain, not both'
    )
  }
  if (linkedinUrl) {
    return { callback_url: callbackUrl, linkedin_url: linkedinUrl }
  }
  if (!firstName || !lastName || (!company && !domain)) {
    throw new Error(
      'Zeliq email enrichment requires linkedinUrl or firstName + lastName + company/domain'
    )
  }

  return {
    callback_url: callbackUrl,
    first_name: firstName,
    last_name: lastName,
    ...(company ? { company } : {}),
    ...(domain ? { domain } : {}),
  }
}

export function buildZeliqPhoneRequestBody(params: ZeliqEnrichPhoneParams): ZeliqPhoneRequestBody {
  const callbackUrl = requireHttpUrl(params.callbackUrl, 'callbackUrl')
  const linkedinUrl = optionalLinkedInUrl(params.linkedinUrl)
  const email = params.email == null ? undefined : requireEmail(params.email)

  if (linkedinUrl && email) {
    throw new Error('Zeliq phone enrichment accepts linkedinUrl or email, not both')
  }
  if (!linkedinUrl && !email) {
    throw new Error('Zeliq phone enrichment requires linkedinUrl or email')
  }

  return {
    callback_url: callbackUrl,
    ...(linkedinUrl ? { linkedin_url: linkedinUrl } : {}),
    ...(email ? { email } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function parseZeliqAsyncResponse(
  response: Response
): Promise<ZeliqAsyncEnrichmentResponse> {
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error(`Zeliq API returned non-JSON data with HTTP ${response.status}`)
  }
  if (!isRecord(data)) {
    throw new Error(`Zeliq API returned an invalid JSON object with HTTP ${response.status}`)
  }

  if (!response.ok) {
    if (typeof data.message !== 'string' || data.message.length === 0) {
      throw new Error(`Zeliq API returned an undocumented error body with HTTP ${response.status}`)
    }
    return {
      success: false,
      error: data.message,
      output: {
        status: response.status,
        message: data.message,
      },
    }
  }

  if (
    response.status !== 202 ||
    data.status !== 202 ||
    typeof data.message !== 'string' ||
    data.message.length === 0 ||
    typeof data.jobId !== 'string' ||
    data.jobId.length === 0
  ) {
    throw new Error('Zeliq API returned an undocumented async acceptance response')
  }

  return {
    success: true,
    output: {
      status: data.status,
      message: data.message,
      jobId: data.jobId,
    },
  }
}
