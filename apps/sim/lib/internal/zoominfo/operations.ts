import { getErrorMessage } from '@sim/utils/errors'
import { requestZoomInfo } from '@/lib/internal/zoominfo/client'
import {
  type ZoomInfoEnrichCompaniesInput,
  type ZoomInfoEnrichContactsInput,
  type ZoomInfoProviderRequest,
  type ZoomInfoSearchCompaniesInput,
  type ZoomInfoSearchContactsInput,
  type ZoomInfoSearchIntentInput,
  type ZoomInfoSearchNewsInput,
  type ZoomInfoToolInput,
  zoomInfoEnrichCompaniesInputSchema,
  zoomInfoEnrichContactsInputSchema,
  zoomInfoSearchCompaniesInputSchema,
  zoomInfoSearchContactsInputSchema,
  zoomInfoSearchIntentInputSchema,
  zoomInfoSearchNewsInputSchema,
} from '@/lib/internal/zoominfo/schema'

const DEFAULT_CONTACT_OUTPUT_FIELDS = [
  'id',
  'firstName',
  'lastName',
  'email',
  'phone',
  'mobilePhone',
  'jobTitle',
  'jobFunction',
  'managementLevel',
  'city',
  'state',
  'country',
  'contactAccuracyScore',
  'validDate',
  'lastUpdatedDate',
  'companyId',
  'companyName',
  'companyWebsite',
  'companyPhone',
]

const DEFAULT_COMPANY_OUTPUT_FIELDS = [
  'id',
  'name',
  'website',
  'domainList',
  'ticker',
  'revenue',
  'revenueRange',
  'employeeCount',
  'employeeRange',
  'primaryIndustry',
  'industries',
  'street',
  'city',
  'state',
  'zipCode',
  'country',
  'phone',
  'foundedYear',
  'companyStatus',
  'socialMediaUrls',
  'logo',
  'description',
]

function parseJsonField<T>(value: unknown, fieldName: string): T {
  if (typeof value !== 'string') return value as T
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${fieldName} is required`)
  try {
    return JSON.parse(trimmed) as T
  } catch (error) {
    throw new Error(`${fieldName} must be valid JSON: ${getErrorMessage(error)}`)
  }
}

function parseCsvOrJson(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.map(String)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (!Array.isArray(parsed)) throw new Error(`${fieldName} JSON must be an array of strings`)
      return parsed.map(String)
    } catch (error) {
      throw new Error(`${fieldName} must be valid JSON: ${getErrorMessage(error)}`)
    }
  }
  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function toCsvStringOrUndefined(value: unknown, fieldName: string): string | undefined {
  const values = parseCsvOrJson(value, fieldName)
  return values && values.length > 0 ? values.join(',') : undefined
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function authInput(input: { clientId: string; clientSecret: string }) {
  return { clientId: input.clientId, clientSecret: input.clientSecret }
}

function paginationQuery(page: unknown, rpp: unknown): Record<string, number> | undefined {
  const query: Record<string, number> = {}
  const pageNumber = toNumberOrUndefined(page)
  const pageSize = toNumberOrUndefined(rpp)
  if (pageNumber !== undefined) query['page[number]'] = pageNumber
  if (pageSize !== undefined) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new Error('rpp must be an integer between 1 and 100')
    }
    query['page[size]'] = pageSize
  }
  return Object.keys(query).length > 0 ? query : undefined
}

function buildSearchCompanies(input: ZoomInfoSearchCompaniesInput): ZoomInfoProviderRequest {
  const attributes: Record<string, unknown> = {}
  if (input.companyName) attributes.companyName = input.companyName
  if (input.companyWebsite) attributes.companyWebsite = input.companyWebsite
  const companyTicker = parseCsvOrJson(input.companyTicker, 'companyTicker')
  if (companyTicker) attributes.companyTicker = companyTicker
  const industryCodes = toCsvStringOrUndefined(input.industryCodes, 'industryCodes')
  if (industryCodes) attributes.industryCodes = industryCodes
  if (input.country) attributes.country = input.country
  if (input.state) attributes.state = input.state
  if (input.metroRegion) attributes.metroRegion = input.metroRegion
  const revenueMin = toNumberOrUndefined(input.revenueMin)
  if (revenueMin !== undefined) attributes.revenueMin = revenueMin
  const revenueMax = toNumberOrUndefined(input.revenueMax)
  if (revenueMax !== undefined) attributes.revenueMax = revenueMax
  const employeeRangeMin = toNumberOrUndefined(input.employeeRangeMin)
  if (employeeRangeMin !== undefined) attributes.employeeRangeMin = String(employeeRangeMin)
  const employeeRangeMax = toNumberOrUndefined(input.employeeRangeMax)
  if (employeeRangeMax !== undefined) attributes.employeeRangeMax = String(employeeRangeMax)
  if (input.excludeDefunctCompanies !== undefined) {
    attributes.excludeDefunctCompanies = input.excludeDefunctCompanies
  }
  const query: Record<string, string | number> = paginationQuery(input.page, input.rpp) ?? {}
  if (input.sortBy) query.sort = `${input.sortOrder === 'desc' ? '-' : ''}${input.sortBy}`
  return {
    ...authInput(input),
    path: '/data/v1/companies/search',
    method: 'POST',
    query: Object.keys(query).length > 0 ? query : undefined,
    body: { data: { type: 'CompanySearch', attributes } },
  }
}

function buildSearchContacts(input: ZoomInfoSearchContactsInput): ZoomInfoProviderRequest {
  const attributes: Record<string, unknown> = {}
  if (input.firstName) attributes.firstName = input.firstName
  if (input.lastName) attributes.lastName = input.lastName
  if (input.fullName) attributes.fullName = input.fullName
  if (input.emailAddress) attributes.emailAddress = input.emailAddress
  if (input.jobTitle) attributes.jobTitle = input.jobTitle
  const managementLevel = toCsvStringOrUndefined(input.managementLevel, 'managementLevel')
  if (managementLevel) attributes.managementLevel = managementLevel
  const department = toCsvStringOrUndefined(input.department, 'department')
  if (department) attributes.department = department
  if (input.companyId) attributes.companyId = input.companyId
  if (input.companyName) attributes.companyName = input.companyName
  const minimumScore = toNumberOrUndefined(input.contactAccuracyScoreMin)
  if (minimumScore !== undefined) attributes.contactAccuracyScoreMin = String(minimumScore)
  const requiredFields = toCsvStringOrUndefined(input.requiredFields, 'requiredFields')
  if (requiredFields) attributes.requiredFields = requiredFields
  if (input.excludePartialProfiles !== undefined) {
    attributes.excludePartialProfiles = input.excludePartialProfiles
  }
  const query: Record<string, string | number> = paginationQuery(input.page, input.rpp) ?? {}
  if (input.sortBy) query.sort = `${input.sortOrder === 'desc' ? '-' : ''}${input.sortBy}`
  return {
    ...authInput(input),
    path: '/data/v1/contacts/search',
    method: 'POST',
    query: Object.keys(query).length > 0 ? query : undefined,
    body: { data: { type: 'ContactSearch', attributes } },
  }
}

function buildEnrichCompanies(input: ZoomInfoEnrichCompaniesInput): ZoomInfoProviderRequest {
  const matchCompanyInput = parseJsonField<unknown>(input.matchCompanyInput, 'matchCompanyInput')
  if (!Array.isArray(matchCompanyInput) || matchCompanyInput.length === 0) {
    throw new Error('matchCompanyInput must be a non-empty JSON array')
  }
  if (matchCompanyInput.length > 25) {
    throw new Error('matchCompanyInput supports a maximum of 25 entries per request')
  }
  return {
    ...authInput(input),
    path: '/data/v1/companies/enrich',
    method: 'POST',
    body: {
      data: {
        type: 'CompanyEnrich',
        attributes: {
          matchCompanyInput,
          outputFields:
            parseCsvOrJson(input.outputFields, 'outputFields') ?? DEFAULT_COMPANY_OUTPUT_FIELDS,
        },
      },
    },
  }
}

function buildEnrichContacts(input: ZoomInfoEnrichContactsInput): ZoomInfoProviderRequest {
  const matchPersonInput = parseJsonField<unknown>(input.matchPersonInput, 'matchPersonInput')
  if (!Array.isArray(matchPersonInput) || matchPersonInput.length === 0) {
    throw new Error('matchPersonInput must be a non-empty JSON array')
  }
  if (matchPersonInput.length > 25) {
    throw new Error('matchPersonInput supports a maximum of 25 entries per request')
  }
  const attributes: Record<string, unknown> = {
    matchPersonInput,
    outputFields:
      parseCsvOrJson(input.outputFields, 'outputFields') ?? DEFAULT_CONTACT_OUTPUT_FIELDS,
  }
  const requiredFields = parseCsvOrJson(input.requiredFields, 'requiredFields')
  if (requiredFields) attributes.requiredFields = requiredFields
  return {
    ...authInput(input),
    path: '/data/v1/contacts/enrich',
    method: 'POST',
    body: { data: { type: 'ContactEnrich', attributes } },
  }
}

function buildSearchIntent(input: ZoomInfoSearchIntentInput): ZoomInfoProviderRequest {
  const topics = parseCsvOrJson(input.topics, 'topics')
  if (!topics || topics.length === 0) throw new Error('topics is required')
  if (topics.length > 50) throw new Error('topics supports a maximum of 50 entries per request')
  const attributes: Record<string, unknown> = { topics }
  if (input.signalStartDate) attributes.signalStartDate = input.signalStartDate
  if (input.signalEndDate) attributes.signalEndDate = input.signalEndDate
  const scoreMin = toNumberOrUndefined(input.signalScoreMin)
  if (scoreMin !== undefined) attributes.signalScoreMin = scoreMin
  const scoreMax = toNumberOrUndefined(input.signalScoreMax)
  if (scoreMax !== undefined) attributes.signalScoreMax = scoreMax
  if (input.audienceStrengthMin) attributes.audienceStrengthMin = input.audienceStrengthMin
  if (input.audienceStrengthMax) attributes.audienceStrengthMax = input.audienceStrengthMax
  if (input.findRecommendedContacts !== undefined) {
    attributes.findRecommendedContacts = input.findRecommendedContacts
  }
  if (input.country) attributes.country = input.country
  if (input.state) attributes.state = input.state
  const industryCodes = toCsvStringOrUndefined(input.industryCodes, 'industryCodes')
  if (industryCodes) attributes.industryCodes = industryCodes
  return {
    ...authInput(input),
    path: '/data/v1/intent/search',
    method: 'POST',
    query: paginationQuery(input.page, input.rpp),
    body: { data: { type: 'IntentSearch', attributes } },
  }
}

function buildSearchNews(input: ZoomInfoSearchNewsInput): ZoomInfoProviderRequest {
  const attributes: Record<string, unknown> = {}
  const categories = parseCsvOrJson(input.categories, 'categories')
  if (categories) attributes.categories = categories
  const urls = parseCsvOrJson(input.url, 'url')
  if (urls) attributes.url = urls
  if (input.pageDateMin) attributes.pageDateMin = input.pageDateMin
  if (input.pageDateMax) attributes.pageDateMax = input.pageDateMax
  if (Object.keys(attributes).length === 0) {
    throw new Error('Provide at least one of: categories, url, pageDateMin, pageDateMax')
  }
  return {
    ...authInput(input),
    path: '/data/v1/news/search',
    method: 'POST',
    query: paginationQuery(input.page, input.rpp),
    body: { data: { type: 'NewsSearch', attributes } },
  }
}

function buildProviderRequest(toolId: string, input: ZoomInfoToolInput): ZoomInfoProviderRequest {
  switch (toolId) {
    case 'zoominfo_search_companies':
      return buildSearchCompanies(zoomInfoSearchCompaniesInputSchema.parse(input))
    case 'zoominfo_search_contacts':
      return buildSearchContacts(zoomInfoSearchContactsInputSchema.parse(input))
    case 'zoominfo_enrich_companies':
      return buildEnrichCompanies(zoomInfoEnrichCompaniesInputSchema.parse(input))
    case 'zoominfo_enrich_contacts':
      return buildEnrichContacts(zoomInfoEnrichContactsInputSchema.parse(input))
    case 'zoominfo_search_intent':
      return buildSearchIntent(zoomInfoSearchIntentInputSchema.parse(input))
    case 'zoominfo_search_news':
      return buildSearchNews(zoomInfoSearchNewsInputSchema.parse(input))
    default:
      throw new Error(`Unsupported ZoomInfo tool: ${toolId}`)
  }
}

export async function executeZoomInfoOperation(
  toolId: string,
  input: ZoomInfoToolInput,
  requestId: string,
  signal?: AbortSignal
) {
  return requestZoomInfo(buildProviderRequest(toolId, input), requestId, signal)
}
