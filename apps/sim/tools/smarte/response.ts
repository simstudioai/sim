import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import type {
  SmarteCompanyRecord,
  SmarteCurrentExperience,
  SmarteEmailRecord,
  SmarteFundingRecord,
  SmarteMobileRecord,
  SmartePastExperience,
  SmartePersonRecord,
  SmarteTechnographicsRecord,
} from '@/tools/smarte/types'

const PERSON_FIELDS = [
  'recordId',
  'personId',
  'fullName',
  'firstName',
  'middleName',
  'lastName',
  'mobileNumber',
  'directDial',
  'linkedinUrl',
  'enrichmentStatus',
  'smarteTransactionId',
] as const

const CURRENT_EXPERIENCE_FIELDS = [
  'experienceId',
  'dataGrade',
  'email',
  'jobTitle',
  'seniorityLevel',
  'department',
  'subDepartment',
  'jobStartedOn',
  'promotedOn',
  'workAddr',
  'workCity',
  'workState',
  'workArea',
  'workZipcode',
  'workPhone',
  'workCountry',
  'companyId',
  'companyName',
  'companyNameAka',
  'companyStockSymbol',
  'companyStockExchangeCode',
  'companyPhoneNo',
  'companyAddress',
  'companyCity',
  'companyMetroArea',
  'companyState',
  'companyCountry',
  'companyStateIsoCode2',
  'companyZipcode',
  'companyRegion',
  'companyWebsite',
  'companyParentId',
  'companyParentName',
  'companyParentCountry',
  'companyParentCountryIsoCode2',
  'companyParentRegion',
  'companyGlobalParentId',
  'companyGlobalParentName',
  'companyGlobalParentCountry',
  'companyGlobalParentCountryIsoCode2',
  'companyGlobalParentRegion',
  'companyRevRange',
  'companyRevenue',
  'companyGrossProfitInUsd',
  'companyOperatingIncomeInUsd',
  'companyNetIncomeInUsd',
  'companyMarketCapInUsd',
  'companyFiscalYearEndMonth',
  'companyTotalFunding',
  'companyTotalFundingRounds',
  'companyLastFundingRound',
  'companyLastFundingDate',
  'companyEmpCount',
  'companyEmpRange',
  'companyIndustry',
  'companySicCodes',
  'companySicDescription',
  'companyNaicsCodes',
  'companyNaicsDescription',
  'companyIsSubsidiary',
  'companyLegalStatus',
  'companyIsMnc',
  'companyIsHq',
  'companyHqId',
  'companyHqName',
  'companyHqCountry',
  'companyHqCountryIsoCode2',
  'companyFoundingYear',
  'companyLinkedinUrl',
] as const

const PAST_EXPERIENCE_FIELDS = [
  'companyId',
  'companyName',
  'experienceId',
  'jobTitle',
  'seniorityLevel',
  'subDepartment',
  'department',
  'jobStartedOn',
  'promotedOn',
  'jobEndedOn',
] as const

const COMPANY_FIELDS = [
  'recordId',
  'enrichmentStatus',
  'smarteTransactionId',
  'companyId',
  'companyName',
  'companyNameAka',
  'companyWebsite',
  'companyLinkedinUrl',
  'companyPhoneNo',
  'companyAddr',
  'companyCity',
  'companyMetroArea',
  'companyState',
  'companyStateIsoCode2',
  'companyZipcode',
  'companyRegion',
  'companyIndustry',
  'companySicCodes',
  'companySicDescription',
  'companyNaicsCodes',
  'companyNaicsDescription',
  'companyEmpCount',
  'companyEmpRange',
  'companyRevRange',
  'companyRevenue',
  'companyGrossProfitInUsd',
  'companyOperatingIncomeInUsd',
  'companyNetIncomeInUsd',
  'companyMarketCapInUsd',
  'companyFiscalYearEndMonth',
  'companyTotalFunding',
  'companyTotalFundingRounds',
  'companyLastFundingRound',
  'companyLastFundingDate',
  'companyStockSymbol',
  'companyStockExchangeCode',
  'companyFoundingYear',
  'companyLegalStatus',
  'companyIsSubsidiary',
  'companyIsMnc',
  'companyIsHq',
  'companyHqId',
  'companyHqName',
  'companyHqCountry',
  'companyHqCountryIsoCode2',
  'companyParentId',
  'companyParentName',
  'companyParentCountry',
  'companyParentCountryIsoCode2',
  'companyParentRegion',
  'companyGlobalParentId',
  'companyGlobalParentName',
  'companyGlobalParentCountry',
  'companyGlobalParentCountryIsoCode2',
  'companyGlobalParentRegion',
] as const

const EMAIL_FIELDS = ['email', 'smarteTransactionId', 'enrichmentStatus'] as const
const MOBILE_FIELDS = [
  'mobileNumber',
  'directDial',
  'smarteTransactionId',
  'enrichmentStatus',
] as const
const FUNDING_FIELDS = [
  'enrichmentStatus',
  'smarteTransactionId',
  'companyId',
  'companyName',
  'ipoStatus',
  'ipoAmount',
  'ipoValuation',
  'ipoPublicDate',
  'ipoSharePrice',
  'stockSymbol',
  'stockExchangeCode',
  'totalFundingRounds',
  'lastFundingRound',
  'lastFundingDate',
] as const
const TECHNOGRAPHICS_FIELDS = [
  'enrichmentStatus',
  'companyId',
  'companyName',
  'smarteTransactionId',
  'productName',
  'vendorName',
  'categoryName',
] as const

type NormalizedStringFields<Keys extends readonly string[]> = {
  [Key in Keys[number]]: string | null
}

function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`SMARTe ${context} must be an object`)
  }
  return value as Record<string, unknown>
}

function normalizeStringFields<const Keys extends readonly string[]>(
  value: unknown,
  fields: Keys,
  context: string
): NormalizedStringFields<Keys> {
  const record = requireRecord(value, context)
  const normalized: Record<string, string | null> = {}
  for (const field of fields) {
    const fieldValue = record[field]
    if (fieldValue !== undefined && fieldValue !== null && typeof fieldValue !== 'string') {
      throw new Error(`SMARTe ${context}.${field} must be a string`)
    }
    normalized[field] = fieldValue ?? null
  }
  return normalized as NormalizedStringFields<Keys>
}

function normalizeArray<T>(
  value: unknown,
  context: string,
  normalizeItem: (item: unknown, index: number) => T
): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`SMARTe ${context} response must be an array`)
  }
  return value.map(normalizeItem)
}

function normalizeOptionalArray<T>(
  value: unknown,
  context: string,
  normalizeItem: (item: unknown, index: number) => T
): T[] {
  if (value === undefined || value === null) return []
  return normalizeArray(value, context, normalizeItem)
}

function normalizeCurrentExperience(value: unknown, index: number): SmarteCurrentExperience {
  return normalizeStringFields(value, CURRENT_EXPERIENCE_FIELDS, `currentExperience[${index}]`)
}

function normalizePastExperience(value: unknown, index: number): SmartePastExperience {
  return normalizeStringFields(value, PAST_EXPERIENCE_FIELDS, `pastExperience[${index}]`)
}

export function normalizePersonRecords(value: unknown): SmartePersonRecord[] {
  return normalizeArray(value, 'person', (item, index) => {
    const record = requireRecord(item, `person[${index}]`)
    return {
      ...normalizeStringFields(record, PERSON_FIELDS, `person[${index}]`),
      currentExperience: normalizeOptionalArray(
        record.currentExperience,
        `person[${index}].currentExperience`,
        normalizeCurrentExperience
      ),
      pastExperience: normalizeOptionalArray(
        record.pastExperience,
        `person[${index}].pastExperience`,
        normalizePastExperience
      ),
    }
  })
}

export function normalizeCompanyRecords(value: unknown): SmarteCompanyRecord[] {
  return normalizeArray(value, 'company', (item, index) =>
    normalizeStringFields(item, COMPANY_FIELDS, `company[${index}]`)
  )
}

export function normalizeEmailRecords(value: unknown): SmarteEmailRecord[] {
  return normalizeArray(value, 'email', (item, index) =>
    normalizeStringFields(item, EMAIL_FIELDS, `email[${index}]`)
  )
}

export function normalizeMobileRecords(value: unknown): SmarteMobileRecord[] {
  return normalizeArray(value, 'mobile', (item, index) =>
    normalizeStringFields(item, MOBILE_FIELDS, `mobile[${index}]`)
  )
}

export function normalizeFundingRecords(value: unknown): SmarteFundingRecord[] {
  return normalizeArray(value, 'funding', (item, index) =>
    normalizeStringFields(item, FUNDING_FIELDS, `funding[${index}]`)
  )
}

export function normalizeTechnographicsRecords(value: unknown): SmarteTechnographicsRecord[] {
  return normalizeArray(value, 'technographics', (item, index) =>
    normalizeStringFields(item, TECHNOGRAPHICS_FIELDS, `technographics[${index}]`)
  )
}

export function readCreditsDeducted(response: Response): number | null {
  const rawCredits = response.headers.get('credits-deducted')
  if (rawCredits === null) return null
  if (rawCredits.trim() === '') {
    throw new Error('SMARTe response credits-deducted header is empty')
  }
  const credits = Number(rawCredits)
  if (!Number.isFinite(credits) || credits < 0) {
    throw new Error('SMARTe response credits-deducted header must be a non-negative number')
  }
  return credits
}

export async function parseSmarteResponse<T>(
  response: Response,
  endpoint: string,
  normalizeRecords: (value: unknown) => T[]
): Promise<{ records: T[]; creditsDeducted: number | null }> {
  const body = await readResponseTextWithLimit(response, {
    maxBytes: response.ok ? MAX_INLINE_MATERIALIZATION_BYTES : DEFAULT_MAX_ERROR_BODY_BYTES,
    label: response.ok ? `SMARTe ${endpoint} response` : `SMARTe ${endpoint} error response`,
  })
  if (!response.ok) {
    throw new Error(
      `SMARTe ${endpoint} request failed with ${response.status} ${response.statusText}: ${body}`
    )
  }

  const creditsDeducted = readCreditsDeducted(response)
  let data: unknown
  try {
    data = JSON.parse(body)
  } catch {
    throw new Error(`SMARTe ${endpoint} response returned malformed JSON`)
  }
  return {
    records: normalizeRecords(data),
    creditsDeducted,
  }
}
