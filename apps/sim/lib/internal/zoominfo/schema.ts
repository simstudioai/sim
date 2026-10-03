import { isPrivateIpHost } from '@sim/security/ssrf'
import { z } from 'zod'

export const ZOOMINFO_API_BASE = 'https://api.zoominfo.com/gtm'
export const ZOOMINFO_TOKEN_URL = `${ZOOMINFO_API_BASE}/oauth/v1/token`

export const zoomInfoAuthSchema = z.object({
  clientId: z.string().min(1, 'clientId is required'),
  clientSecret: z.string().min(1, 'clientSecret is required'),
})

export const zoomInfoProviderRequestSchema = zoomInfoAuthSchema.extend({
  path: z
    .string()
    .min(1, 'path is required')
    .refine(
      (path) =>
        !path.split(/[/\\]/).some((segment) => segment === '..' || segment === '.') &&
        !path.includes('#') &&
        !/%(?:2[eEfF]|5[cC]|23)/.test(path),
      {
        message:
          'path must not contain ".." or "." segments, "#", or percent-encoded path/fragment characters',
      }
    ),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.unknown().optional(),
})

export type ZoomInfoAuth = z.output<typeof zoomInfoAuthSchema>
export const zoomInfoToolInputSchema = zoomInfoAuthSchema.passthrough()

const optionalToolField = z.unknown().optional()

export const zoomInfoSearchCompaniesInputSchema = zoomInfoAuthSchema.extend({
  companyName: optionalToolField,
  companyWebsite: optionalToolField,
  companyTicker: optionalToolField,
  industryCodes: optionalToolField,
  country: optionalToolField,
  state: optionalToolField,
  metroRegion: optionalToolField,
  revenueMin: optionalToolField,
  revenueMax: optionalToolField,
  employeeRangeMin: optionalToolField,
  employeeRangeMax: optionalToolField,
  excludeDefunctCompanies: optionalToolField,
  page: optionalToolField,
  rpp: optionalToolField,
  sortBy: optionalToolField,
  sortOrder: optionalToolField,
})

export const zoomInfoSearchContactsInputSchema = zoomInfoAuthSchema.extend({
  firstName: optionalToolField,
  lastName: optionalToolField,
  fullName: optionalToolField,
  emailAddress: optionalToolField,
  jobTitle: optionalToolField,
  managementLevel: optionalToolField,
  department: optionalToolField,
  companyId: optionalToolField,
  companyName: optionalToolField,
  contactAccuracyScoreMin: optionalToolField,
  requiredFields: optionalToolField,
  excludePartialProfiles: optionalToolField,
  page: optionalToolField,
  rpp: optionalToolField,
  sortBy: optionalToolField,
  sortOrder: optionalToolField,
})

export const zoomInfoEnrichCompaniesInputSchema = zoomInfoAuthSchema.extend({
  matchCompanyInput: z.unknown(),
  outputFields: optionalToolField,
})

export const zoomInfoEnrichContactsInputSchema = zoomInfoAuthSchema.extend({
  matchPersonInput: z.unknown(),
  outputFields: optionalToolField,
  requiredFields: optionalToolField,
})

export const zoomInfoSearchIntentInputSchema = zoomInfoAuthSchema.extend({
  topics: z.unknown(),
  signalStartDate: optionalToolField,
  signalEndDate: optionalToolField,
  signalScoreMin: optionalToolField,
  signalScoreMax: optionalToolField,
  audienceStrengthMin: optionalToolField,
  audienceStrengthMax: optionalToolField,
  findRecommendedContacts: optionalToolField,
  country: optionalToolField,
  state: optionalToolField,
  industryCodes: optionalToolField,
  page: optionalToolField,
  rpp: optionalToolField,
})

export const zoomInfoSearchNewsInputSchema = zoomInfoAuthSchema.extend({
  categories: optionalToolField,
  url: optionalToolField,
  pageDateMin: optionalToolField,
  pageDateMax: optionalToolField,
  page: optionalToolField,
  rpp: optionalToolField,
})

export type ZoomInfoProviderRequest = z.output<typeof zoomInfoProviderRequestSchema>
export type ZoomInfoToolInput = z.output<typeof zoomInfoToolInputSchema>
export type ZoomInfoSearchCompaniesInput = z.output<typeof zoomInfoSearchCompaniesInputSchema>
export type ZoomInfoSearchContactsInput = z.output<typeof zoomInfoSearchContactsInputSchema>
export type ZoomInfoEnrichCompaniesInput = z.output<typeof zoomInfoEnrichCompaniesInputSchema>
export type ZoomInfoEnrichContactsInput = z.output<typeof zoomInfoEnrichContactsInputSchema>
export type ZoomInfoSearchIntentInput = z.output<typeof zoomInfoSearchIntentInputSchema>
export type ZoomInfoSearchNewsInput = z.output<typeof zoomInfoSearchNewsInputSchema>

const FORBIDDEN_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  '127.0.0.1',
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
  '[::1]',
  '[::]',
])

export function assertSafeZoomInfoUrl(rawUrl: string, label: string): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }
  if (parsed.protocol !== 'https:') throw new Error(`${label} must use https://`)
  const host = parsed.hostname.toLowerCase()
  if (FORBIDDEN_HOSTS.has(host)) throw new Error(`${label} host is not allowed`)
  if (isPrivateIpHost(host))
    throw new Error(`${label} host is not allowed (private/loopback range)`)
  if (host !== 'api.zoominfo.com') {
    throw new Error(`${label} host must be api.zoominfo.com`)
  }
  return parsed
}
