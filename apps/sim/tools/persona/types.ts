import type { ToolResponse } from '@/tools/types'

interface PersonaBaseParams {
  apiKey: string
}

/**
 * Flattened representation of a Persona Inquiry resource.
 */
export interface PersonaInquiry {
  id: string
  status: string | null
  referenceId: string | null
  note: string | null
  tags: string[]
  fields: Record<string, unknown> | null
  createdAt: string | null
  startedAt: string | null
  completedAt: string | null
  failedAt: string | null
  expiredAt: string | null
  decisionedAt: string | null
}

/**
 * Flattened representation of a Persona Account resource.
 */
export interface PersonaAccount {
  id: string
  referenceId: string | null
  accountTypeName: string | null
  accountStatus: string | null
  tags: string[]
  fields: Record<string, unknown> | null
  createdAt: string | null
  updatedAt: string | null
}

/**
 * Flattened representation of a Persona Case resource.
 */
export interface PersonaCase {
  id: string
  status: string | null
  name: string | null
  resolution: string | null
  assigneeId: string | null
  tags: string[]
  fields: Record<string, unknown> | null
  createdAt: string | null
  assignedAt: string | null
  resolvedAt: string | null
}

/**
 * Flattened representation of a Persona Report resource. The `attributes`
 * payload varies by report type, so the full attributes are preserved.
 */
export interface PersonaReport {
  id: string
  type: string
  status: string | null
  hasMatch: boolean | null
  tags: string[]
  createdAt: string | null
  completedAt: string | null
  attributes: Record<string, unknown>
}

/**
 * Flattened representation of a Persona Verification resource. The
 * `attributes` payload varies by verification type, so the full attributes
 * are preserved.
 */
export interface PersonaVerification {
  id: string
  type: string
  status: string | null
  checks: Array<Record<string, unknown>>
  countryCode: string | null
  createdAt: string | null
  submittedAt: string | null
  completedAt: string | null
  attributes: Record<string, unknown>
}

/**
 * Flattened representation of a Persona Document resource. The `attributes`
 * payload varies by document type, so the full attributes are preserved.
 */
export interface PersonaDocument {
  id: string
  type: string
  status: string | null
  kind: string | null
  files: Array<{ filename: string | null; url: string | null; byteSize: number | null }>
  createdAt: string | null
  processedAt: string | null
  attributes: Record<string, unknown>
}

/**
 * Flattened representation of a Persona Account Importer resource.
 */
export interface PersonaImporter {
  id: string
  status: string | null
  successfulCount: number
  errorCount: number
  duplicateCount: number
  createdAt: string | null
  completedAt: string | null
}

/**
 * Flattened representation of a Persona Inquiry Template resource.
 */
export interface PersonaInquiryTemplate {
  id: string
  name: string | null
  status: string | null
}

export interface PersonaCreateInquiryParams extends PersonaBaseParams {
  inquiryTemplateId: string
  accountId?: string
  referenceId?: string
  fields?: Record<string, unknown> | string
  note?: string
  redirectUri?: string
}

export interface PersonaGetInquiryParams extends PersonaBaseParams {
  inquiryId: string
}

export interface PersonaListInquiriesParams extends PersonaBaseParams {
  status?: string
  accountId?: string
  referenceId?: string
  createdAtStart?: string
  createdAtEnd?: string
  pageSize?: number
  pageAfter?: string
}

export interface PersonaUpdateInquiryParams extends PersonaBaseParams {
  inquiryId: string
  note?: string
  fields?: Record<string, unknown> | string
  tags?: string[] | string
  redirectUri?: string
}

export interface PersonaApproveInquiryParams extends PersonaBaseParams {
  inquiryId: string
}

export interface PersonaMarkInquiryForReviewParams extends PersonaBaseParams {
  inquiryId: string
}

export interface PersonaResumeInquiryParams extends PersonaBaseParams {
  inquiryId: string
}

export interface PersonaExpireInquiryParams extends PersonaBaseParams {
  inquiryId: string
}

export interface PersonaRedactInquiryParams extends PersonaBaseParams {
  inquiryId: string
}

export interface PersonaDeclineInquiryParams extends PersonaBaseParams {
  inquiryId: string
}

export interface PersonaGenerateInquiryLinkParams extends PersonaBaseParams {
  inquiryId: string
  expiresInSeconds?: number
}

export interface PersonaPrintInquiryPdfParams extends PersonaBaseParams {
  inquiryId: string
}

export interface PersonaCreateAccountParams extends PersonaBaseParams {
  accountTypeId?: string
  referenceId?: string
  countryCode?: string
  fields?: Record<string, unknown> | string
  tags?: string[] | string
}

export interface PersonaGetAccountParams extends PersonaBaseParams {
  accountId: string
}

export interface PersonaUpdateAccountParams extends PersonaBaseParams {
  accountId: string
  referenceId?: string
  countryCode?: string
  fields?: Record<string, unknown> | string
  tags?: string[] | string
}

export interface PersonaRedactAccountParams extends PersonaBaseParams {
  accountId: string
}

export interface PersonaListAccountsParams extends PersonaBaseParams {
  referenceId?: string
  pageSize?: number
  pageAfter?: string
}

export interface PersonaImportAccountsParams extends PersonaBaseParams {
  file: Record<string, unknown>
}

export interface PersonaListCasesParams extends PersonaBaseParams {
  status?: string
  accountId?: string
  referenceId?: string
  pageSize?: number
  pageAfter?: string
}

export interface PersonaGetCaseParams extends PersonaBaseParams {
  caseId: string
}

export interface PersonaCreateReportParams extends PersonaBaseParams {
  reportType: string
  reportTemplateId: string
  term?: string
  nameFirst?: string
  nameMiddle?: string
  nameLast?: string
  birthdate?: string
  countryCode?: string
  accountId?: string
}

export interface PersonaGetReportParams extends PersonaBaseParams {
  reportId: string
}

export interface PersonaListReportsParams extends PersonaBaseParams {
  accountId?: string
  referenceId?: string
  pageSize?: number
  pageAfter?: string
}

export interface PersonaListInquiryTemplatesParams extends PersonaBaseParams {
  pageSize?: number
  pageAfter?: string
}

export interface PersonaGetVerificationParams extends PersonaBaseParams {
  verificationId: string
}

export interface PersonaGetDocumentParams extends PersonaBaseParams {
  documentId: string
}

export interface PersonaInquiryResponse extends ToolResponse {
  output: {
    inquiry: PersonaInquiry
  }
}

export interface PersonaListInquiriesResponse extends ToolResponse {
  output: {
    inquiries: PersonaInquiry[]
    nextCursor: string | null
  }
}

export interface PersonaResumeInquiryResponse extends ToolResponse {
  output: {
    inquiry: PersonaInquiry
    sessionToken: string
  }
}

export interface PersonaGenerateInquiryLinkResponse extends ToolResponse {
  output: {
    inquiry: PersonaInquiry
    oneTimeLink: string
    oneTimeLinkShort: string
  }
}

export interface PersonaPrintInquiryPdfResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: string
      size: number
    }
  }
}

export interface PersonaAccountResponse extends ToolResponse {
  output: {
    account: PersonaAccount
  }
}

export interface PersonaListAccountsResponse extends ToolResponse {
  output: {
    accounts: PersonaAccount[]
    nextCursor: string | null
  }
}

export interface PersonaImportAccountsResponse extends ToolResponse {
  output: {
    importer: PersonaImporter
  }
}

export interface PersonaCaseResponse extends ToolResponse {
  output: {
    case: PersonaCase
  }
}

export interface PersonaListCasesResponse extends ToolResponse {
  output: {
    cases: PersonaCase[]
    nextCursor: string | null
  }
}

export interface PersonaReportResponse extends ToolResponse {
  output: {
    report: PersonaReport
  }
}

export interface PersonaListReportsResponse extends ToolResponse {
  output: {
    reports: PersonaReport[]
    nextCursor: string | null
  }
}

export interface PersonaListInquiryTemplatesResponse extends ToolResponse {
  output: {
    inquiryTemplates: PersonaInquiryTemplate[]
    nextCursor: string | null
  }
}

export interface PersonaVerificationResponse extends ToolResponse {
  output: {
    verification: PersonaVerification
  }
}

export interface PersonaDocumentResponse extends ToolResponse {
  output: {
    document: PersonaDocument
  }
}

export type PersonaResponse =
  | PersonaInquiryResponse
  | PersonaListInquiriesResponse
  | PersonaResumeInquiryResponse
  | PersonaGenerateInquiryLinkResponse
  | PersonaListReportsResponse
  | PersonaListInquiryTemplatesResponse
  | PersonaPrintInquiryPdfResponse
  | PersonaAccountResponse
  | PersonaListAccountsResponse
  | PersonaImportAccountsResponse
  | PersonaCaseResponse
  | PersonaListCasesResponse
  | PersonaReportResponse
  | PersonaVerificationResponse
  | PersonaDocumentResponse
