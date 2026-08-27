import type { ToolOutputProperty } from '@/tools/types'

function optionalString(description: string): ToolOutputProperty {
  return { type: 'string', description, optional: true, nullable: true }
}

const CURRENT_EXPERIENCE_PROPERTIES = {
  experienceId: optionalString('SMARTe experience identifier'),
  dataGrade: optionalString('SMARTe data quality grade'),
  email: optionalString('Work email address'),
  jobTitle: optionalString('Current job title'),
  seniorityLevel: optionalString('Seniority level'),
  department: optionalString('Department'),
  subDepartment: optionalString('Sub-department'),
  jobStartedOn: optionalString('Role start date'),
  promotedOn: optionalString('Most recent promotion date'),
  workAddr: optionalString('Work address'),
  workCity: optionalString('Work city'),
  workState: optionalString('Work state'),
  workArea: optionalString('Work metro area'),
  workZipcode: optionalString('Work postal code'),
  workPhone: optionalString('Work phone number'),
  workCountry: optionalString('Work country'),
  companyId: optionalString('SMARTe company identifier'),
  companyName: optionalString('Company name'),
  companyNameAka: optionalString('Alternate company name'),
  companyStockSymbol: optionalString('Company stock symbol'),
  companyStockExchangeCode: optionalString('Company stock exchange code'),
  companyPhoneNo: optionalString('Company phone number'),
  companyAddress: optionalString('Company address'),
  companyCity: optionalString('Company city'),
  companyMetroArea: optionalString('Company metro area'),
  companyState: optionalString('Company state'),
  companyCountry: optionalString('Company country'),
  companyStateIsoCode2: optionalString('Company state ISO code'),
  companyZipcode: optionalString('Company postal code'),
  companyRegion: optionalString('Company region'),
  companyWebsite: optionalString('Company website'),
  companyParentId: optionalString('Parent company identifier'),
  companyParentName: optionalString('Parent company name'),
  companyParentCountry: optionalString('Parent company country'),
  companyParentCountryIsoCode2: optionalString('Parent company country ISO code'),
  companyParentRegion: optionalString('Parent company region'),
  companyGlobalParentId: optionalString('Global parent company identifier'),
  companyGlobalParentName: optionalString('Global parent company name'),
  companyGlobalParentCountry: optionalString('Global parent company country'),
  companyGlobalParentCountryIsoCode2: optionalString('Global parent company country ISO code'),
  companyGlobalParentRegion: optionalString('Global parent company region'),
  companyRevRange: optionalString('Company revenue range'),
  companyRevenue: optionalString('Company revenue'),
  companyGrossProfitInUsd: optionalString('Company gross profit in USD'),
  companyOperatingIncomeInUsd: optionalString('Company operating income in USD'),
  companyNetIncomeInUsd: optionalString('Company net income in USD'),
  companyMarketCapInUsd: optionalString('Company market capitalization in USD'),
  companyFiscalYearEndMonth: optionalString('Company fiscal year-end month'),
  companyTotalFunding: optionalString('Company total funding'),
  companyTotalFundingRounds: optionalString('Company total funding rounds'),
  companyLastFundingRound: optionalString('Company last funding round'),
  companyLastFundingDate: optionalString('Company last funding date'),
  companyEmpCount: optionalString('Company employee count'),
  companyEmpRange: optionalString('Company employee range'),
  companyIndustry: optionalString('Company industry'),
  companySicCodes: optionalString('Company SIC codes'),
  companySicDescription: optionalString('Company SIC descriptions'),
  companyNaicsCodes: optionalString('Company NAICS codes'),
  companyNaicsDescription: optionalString('Company NAICS descriptions'),
  companyIsSubsidiary: optionalString('Whether the company is a subsidiary'),
  companyLegalStatus: optionalString('Company legal status'),
  companyIsMnc: optionalString('Whether the company is multinational'),
  companyIsHq: optionalString('Whether the company is a headquarters'),
  companyHqId: optionalString('Headquarters identifier'),
  companyHqName: optionalString('Headquarters name'),
  companyHqCountry: optionalString('Headquarters country'),
  companyHqCountryIsoCode2: optionalString('Headquarters country ISO code'),
  companyFoundingYear: optionalString('Company founding year'),
  companyLinkedinUrl: optionalString('Company LinkedIn URL'),
} as const

const PAST_EXPERIENCE_PROPERTIES = {
  companyId: optionalString('SMARTe company identifier'),
  companyName: optionalString('Company name'),
  experienceId: optionalString('SMARTe experience identifier'),
  jobTitle: optionalString('Job title'),
  seniorityLevel: optionalString('Seniority level'),
  subDepartment: optionalString('Sub-department'),
  department: optionalString('Department'),
  jobStartedOn: optionalString('Role start date'),
  promotedOn: optionalString('Promotion date'),
  jobEndedOn: optionalString('Role end date'),
} as const

const PERSON_RECORD_PROPERTIES = {
  recordId: optionalString('Echoed client record identifier'),
  personId: optionalString('Unique SMARTe person identifier'),
  fullName: optionalString('Full name'),
  firstName: optionalString('First name'),
  middleName: optionalString('Middle name'),
  lastName: optionalString('Last name'),
  mobileNumber: optionalString('Mobile phone number'),
  directDial: optionalString('Direct dial number'),
  linkedinUrl: optionalString('LinkedIn profile URL'),
  enrichmentStatus: optionalString('Enrichment status'),
  smarteTransactionId: optionalString('SMARTe transaction identifier'),
  currentExperience: {
    type: 'array',
    description: 'Current roles with associated company context',
    items: { type: 'object', properties: CURRENT_EXPERIENCE_PROPERTIES },
  },
  pastExperience: {
    type: 'array',
    description: 'Historical employment records',
    items: { type: 'object', properties: PAST_EXPERIENCE_PROPERTIES },
  },
} as const

const COMPANY_RECORD_PROPERTIES = {
  recordId: optionalString('Echoed client record identifier'),
  enrichmentStatus: optionalString('Enrichment status'),
  smarteTransactionId: optionalString('SMARTe transaction identifier'),
  companyId: optionalString('Unique SMARTe company identifier'),
  companyName: optionalString('Company name'),
  companyNameAka: optionalString('Alternate company name'),
  companyWebsite: optionalString('Company website'),
  companyLinkedinUrl: optionalString('Company LinkedIn URL'),
  companyPhoneNo: optionalString('Company phone number'),
  companyAddr: optionalString('Company address'),
  companyCity: optionalString('Company city'),
  companyMetroArea: optionalString('Company metro area'),
  companyState: optionalString('Company state'),
  companyStateIsoCode2: optionalString('Company state ISO code'),
  companyZipcode: optionalString('Company postal code'),
  companyRegion: optionalString('Company region'),
  companyIndustry: optionalString('Company industry'),
  companySicCodes: optionalString('Company SIC codes'),
  companySicDescription: optionalString('Company SIC descriptions'),
  companyNaicsCodes: optionalString('Company NAICS codes'),
  companyNaicsDescription: optionalString('Company NAICS descriptions'),
  companyEmpCount: optionalString('Company employee count'),
  companyEmpRange: optionalString('Company employee range'),
  companyRevRange: optionalString('Company revenue range'),
  companyRevenue: optionalString('Company revenue'),
  companyGrossProfitInUsd: optionalString('Company gross profit in USD'),
  companyOperatingIncomeInUsd: optionalString('Company operating income in USD'),
  companyNetIncomeInUsd: optionalString('Company net income in USD'),
  companyMarketCapInUsd: optionalString('Company market capitalization in USD'),
  companyFiscalYearEndMonth: optionalString('Company fiscal year-end month'),
  companyTotalFunding: optionalString('Company total funding'),
  companyTotalFundingRounds: optionalString('Company total funding rounds'),
  companyLastFundingRound: optionalString('Company last funding round'),
  companyLastFundingDate: optionalString('Company last funding date'),
  companyStockSymbol: optionalString('Company stock symbol'),
  companyStockExchangeCode: optionalString('Company stock exchange code'),
  companyFoundingYear: optionalString('Company founding year'),
  companyLegalStatus: optionalString('Company legal status'),
  companyIsSubsidiary: optionalString('Whether the company is a subsidiary'),
  companyIsMnc: optionalString('Whether the company is multinational'),
  companyIsHq: optionalString('Whether the company is a headquarters'),
  companyHqId: optionalString('Headquarters identifier'),
  companyHqName: optionalString('Headquarters name'),
  companyHqCountry: optionalString('Headquarters country'),
  companyHqCountryIsoCode2: optionalString('Headquarters country ISO code'),
  companyParentId: optionalString('Parent company identifier'),
  companyParentName: optionalString('Parent company name'),
  companyParentCountry: optionalString('Parent company country'),
  companyParentCountryIsoCode2: optionalString('Parent company country ISO code'),
  companyParentRegion: optionalString('Parent company region'),
  companyGlobalParentId: optionalString('Global parent company identifier'),
  companyGlobalParentName: optionalString('Global parent company name'),
  companyGlobalParentCountry: optionalString('Global parent company country'),
  companyGlobalParentCountryIsoCode2: optionalString('Global parent company country ISO code'),
  companyGlobalParentRegion: optionalString('Global parent company region'),
} as const

const EMAIL_RECORD_PROPERTIES = {
  email: optionalString('Enriched work email address'),
  smarteTransactionId: optionalString('SMARTe transaction identifier'),
  enrichmentStatus: optionalString('Enrichment status'),
} as const

const MOBILE_RECORD_PROPERTIES = {
  mobileNumber: optionalString('Enriched mobile phone number'),
  directDial: optionalString('Enriched direct dial number'),
  smarteTransactionId: optionalString('SMARTe transaction identifier'),
  enrichmentStatus: optionalString('Enrichment status'),
} as const

const FUNDING_RECORD_PROPERTIES = {
  enrichmentStatus: optionalString('Enrichment status'),
  smarteTransactionId: optionalString('SMARTe transaction identifier'),
  companyId: optionalString('Unique SMARTe company identifier'),
  companyName: optionalString('Company name'),
  ipoStatus: optionalString('IPO status'),
  ipoAmount: optionalString('IPO amount'),
  ipoValuation: optionalString('IPO valuation'),
  ipoPublicDate: optionalString('IPO public date'),
  ipoSharePrice: optionalString('IPO share price'),
  stockSymbol: optionalString('Stock symbol'),
  stockExchangeCode: optionalString('Stock exchange code'),
  totalFundingRounds: optionalString('Total funding rounds'),
  lastFundingRound: optionalString('Most recent funding round'),
  lastFundingDate: optionalString('Most recent funding date'),
} as const

const TECHNOGRAPHICS_RECORD_PROPERTIES = {
  enrichmentStatus: optionalString('Enrichment status'),
  companyId: optionalString('Unique SMARTe company identifier'),
  companyName: optionalString('Company name'),
  smarteTransactionId: optionalString('SMARTe transaction identifier'),
  productName: optionalString('Technology product name'),
  vendorName: optionalString('Technology vendor name'),
  categoryName: optionalString('Technology category name'),
} as const

function recordsOutput(
  description: string,
  properties: Record<string, ToolOutputProperty>
): ToolOutputProperty {
  return {
    type: 'array',
    description,
    items: { type: 'object', properties },
  }
}

export const SMARTE_PERSON_RECORDS_OUTPUT = recordsOutput(
  'Enriched person records with current and past experience',
  PERSON_RECORD_PROPERTIES
)

export const SMARTE_COMPANY_RECORDS_OUTPUT = recordsOutput(
  'Enriched company records with firmographic, financial, hierarchy, and geographic fields',
  COMPANY_RECORD_PROPERTIES
)

export const SMARTE_EMAIL_RECORDS_OUTPUT = recordsOutput(
  'Enriched work email records',
  EMAIL_RECORD_PROPERTIES
)

export const SMARTE_MOBILE_RECORDS_OUTPUT = recordsOutput(
  'Enriched mobile and direct dial records',
  MOBILE_RECORD_PROPERTIES
)

export const SMARTE_FUNDING_RECORDS_OUTPUT = recordsOutput(
  'Enriched company funding and IPO records',
  FUNDING_RECORD_PROPERTIES
)

export const SMARTE_TECHNOGRAPHICS_RECORDS_OUTPUT = recordsOutput(
  'Enriched company technology stack records',
  TECHNOGRAPHICS_RECORD_PROPERTIES
)

export const SMARTE_CREDITS_DEDUCTED_OUTPUT: ToolOutputProperty = {
  type: 'number',
  description: 'Credits deducted for the request, reported by SMARTe in the response header',
  optional: true,
  nullable: true,
}
