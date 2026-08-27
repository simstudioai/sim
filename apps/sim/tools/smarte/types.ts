import type { ToolResponse } from '@/tools/types'

export interface SmarteBaseParams {
  apiKey: string
}

export interface SmartePersonIdentifiers {
  recordId?: string
  experienceId?: string
  firstName?: string
  lastName?: string
  fullName?: string
  email?: string
  jobTitle?: string
  linkedinUrl?: string
  companyId?: string
  companyName?: string
  companyWebsite?: string
  companyLinkedinUrl?: string
}

export interface SmarteCompanyIdentifiers {
  companyId?: string
  companyName?: string
  companyWebsite?: string
  companyLinkedinUrl?: string
}

export interface SmarteEnrichPersonParams extends SmarteBaseParams, SmartePersonIdentifiers {
  firstName: string
  lastName: string
  fullName: string
  email: string
  jobTitle: string
  linkedinUrl: string
}

export interface SmarteEnrichCompanyParams extends SmarteBaseParams {
  recordId?: string
  companyId: string
  companyName: string
  companyWebsite: string
  companyLinkedinUrl: string
}

export interface SmarteEnrichEmailParams extends SmarteBaseParams, SmartePersonIdentifiers {}

export interface SmarteEnrichMobileParams extends SmarteBaseParams, SmartePersonIdentifiers {}

export interface SmarteEnrichFundingParams extends SmarteBaseParams, SmarteCompanyIdentifiers {}

export interface SmarteEnrichTechnographicsParams
  extends SmarteBaseParams,
    SmarteCompanyIdentifiers {
  product?: string
  vendor?: string
  category?: string
}

export interface SmarteCurrentExperience {
  experienceId: string | null
  dataGrade: string | null
  email: string | null
  jobTitle: string | null
  seniorityLevel: string | null
  department: string | null
  subDepartment: string | null
  jobStartedOn: string | null
  promotedOn: string | null
  workAddr: string | null
  workCity: string | null
  workState: string | null
  workArea: string | null
  workZipcode: string | null
  workPhone: string | null
  workCountry: string | null
  companyId: string | null
  companyName: string | null
  companyNameAka: string | null
  companyStockSymbol: string | null
  companyStockExchangeCode: string | null
  companyPhoneNo: string | null
  companyAddress: string | null
  companyCity: string | null
  companyMetroArea: string | null
  companyState: string | null
  companyCountry: string | null
  companyStateIsoCode2: string | null
  companyZipcode: string | null
  companyRegion: string | null
  companyWebsite: string | null
  companyParentId: string | null
  companyParentName: string | null
  companyParentCountry: string | null
  companyParentCountryIsoCode2: string | null
  companyParentRegion: string | null
  companyGlobalParentId: string | null
  companyGlobalParentName: string | null
  companyGlobalParentCountry: string | null
  companyGlobalParentCountryIsoCode2: string | null
  companyGlobalParentRegion: string | null
  companyRevRange: string | null
  companyRevenue: string | null
  companyGrossProfitInUsd: string | null
  companyOperatingIncomeInUsd: string | null
  companyNetIncomeInUsd: string | null
  companyMarketCapInUsd: string | null
  companyFiscalYearEndMonth: string | null
  companyTotalFunding: string | null
  companyTotalFundingRounds: string | null
  companyLastFundingRound: string | null
  companyLastFundingDate: string | null
  companyEmpCount: string | null
  companyEmpRange: string | null
  companyIndustry: string | null
  companySicCodes: string | null
  companySicDescription: string | null
  companyNaicsCodes: string | null
  companyNaicsDescription: string | null
  companyIsSubsidiary: string | null
  companyLegalStatus: string | null
  companyIsMnc: string | null
  companyIsHq: string | null
  companyHqId: string | null
  companyHqName: string | null
  companyHqCountry: string | null
  companyHqCountryIsoCode2: string | null
  companyFoundingYear: string | null
  companyLinkedinUrl: string | null
}

export interface SmartePastExperience {
  companyId: string | null
  companyName: string | null
  experienceId: string | null
  jobTitle: string | null
  seniorityLevel: string | null
  subDepartment: string | null
  department: string | null
  jobStartedOn: string | null
  promotedOn: string | null
  jobEndedOn: string | null
}

export interface SmartePersonRecord {
  recordId: string | null
  personId: string | null
  fullName: string | null
  firstName: string | null
  middleName: string | null
  lastName: string | null
  mobileNumber: string | null
  directDial: string | null
  linkedinUrl: string | null
  enrichmentStatus: string | null
  smarteTransactionId: string | null
  currentExperience: SmarteCurrentExperience[]
  pastExperience: SmartePastExperience[]
}

export interface SmarteCompanyRecord {
  recordId: string | null
  enrichmentStatus: string | null
  smarteTransactionId: string | null
  companyId: string | null
  companyName: string | null
  companyNameAka: string | null
  companyWebsite: string | null
  companyLinkedinUrl: string | null
  companyPhoneNo: string | null
  companyAddr: string | null
  companyCity: string | null
  companyMetroArea: string | null
  companyState: string | null
  companyStateIsoCode2: string | null
  companyZipcode: string | null
  companyRegion: string | null
  companyIndustry: string | null
  companySicCodes: string | null
  companySicDescription: string | null
  companyNaicsCodes: string | null
  companyNaicsDescription: string | null
  companyEmpCount: string | null
  companyEmpRange: string | null
  companyRevRange: string | null
  companyRevenue: string | null
  companyGrossProfitInUsd: string | null
  companyOperatingIncomeInUsd: string | null
  companyNetIncomeInUsd: string | null
  companyMarketCapInUsd: string | null
  companyFiscalYearEndMonth: string | null
  companyTotalFunding: string | null
  companyTotalFundingRounds: string | null
  companyLastFundingRound: string | null
  companyLastFundingDate: string | null
  companyStockSymbol: string | null
  companyStockExchangeCode: string | null
  companyFoundingYear: string | null
  companyLegalStatus: string | null
  companyIsSubsidiary: string | null
  companyIsMnc: string | null
  companyIsHq: string | null
  companyHqId: string | null
  companyHqName: string | null
  companyHqCountry: string | null
  companyHqCountryIsoCode2: string | null
  companyParentId: string | null
  companyParentName: string | null
  companyParentCountry: string | null
  companyParentCountryIsoCode2: string | null
  companyParentRegion: string | null
  companyGlobalParentId: string | null
  companyGlobalParentName: string | null
  companyGlobalParentCountry: string | null
  companyGlobalParentCountryIsoCode2: string | null
  companyGlobalParentRegion: string | null
}

export interface SmarteEmailRecord {
  email: string | null
  smarteTransactionId: string | null
  enrichmentStatus: string | null
}

export interface SmarteMobileRecord {
  mobileNumber: string | null
  directDial: string | null
  smarteTransactionId: string | null
  enrichmentStatus: string | null
}

export interface SmarteFundingRecord {
  enrichmentStatus: string | null
  smarteTransactionId: string | null
  companyId: string | null
  companyName: string | null
  ipoStatus: string | null
  ipoAmount: string | null
  ipoValuation: string | null
  ipoPublicDate: string | null
  ipoSharePrice: string | null
  stockSymbol: string | null
  stockExchangeCode: string | null
  totalFundingRounds: string | null
  lastFundingRound: string | null
  lastFundingDate: string | null
}

export interface SmarteTechnographicsRecord {
  enrichmentStatus: string | null
  companyId: string | null
  companyName: string | null
  smarteTransactionId: string | null
  productName: string | null
  vendorName: string | null
  categoryName: string | null
}

interface SmarteEnrichmentResponse<T> extends ToolResponse {
  output: {
    records: T[]
    creditsDeducted: number | null
  }
}

export interface SmarteEnrichPersonResponse extends SmarteEnrichmentResponse<SmartePersonRecord> {}

export interface SmarteEnrichCompanyResponse
  extends SmarteEnrichmentResponse<SmarteCompanyRecord> {}

export interface SmarteEnrichEmailResponse extends SmarteEnrichmentResponse<SmarteEmailRecord> {}

export interface SmarteEnrichMobileResponse extends SmarteEnrichmentResponse<SmarteMobileRecord> {}

export interface SmarteEnrichFundingResponse
  extends SmarteEnrichmentResponse<SmarteFundingRecord> {}

export interface SmarteEnrichTechnographicsResponse
  extends SmarteEnrichmentResponse<SmarteTechnographicsRecord> {}

export type SmarteResponse =
  | SmarteEnrichPersonResponse
  | SmarteEnrichCompanyResponse
  | SmarteEnrichEmailResponse
  | SmarteEnrichMobileResponse
  | SmarteEnrichFundingResponse
  | SmarteEnrichTechnographicsResponse
