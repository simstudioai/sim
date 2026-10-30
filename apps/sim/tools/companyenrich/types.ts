import type { ToolResponse } from '@/tools/types'

export interface CompanyEnrichParams {
  apiKey: string
  domain: string
}
export interface CompanySearchParams {
  apiKey: string
  query: string
  page?: number
  pageSize?: number
}
export interface CompanySimilarParams {
  apiKey: string
  domain: string
  page?: number
  pageSize?: number
}
interface CompanyRecord {
  id: string
  name: string | null
  domain: string | null
  website: string | null
  description: string | null
  industry: string | null
  employees: string | null
  revenue: string | null
  founded_year: number | null
  technologies: string[]
}
export interface CompanyEnrichResponse extends ToolResponse {
  output: { company: CompanyRecord }
}
export interface CompanySearchResponse extends ToolResponse {
  output: { items: CompanyRecord[]; page: number; totalPages: number; totalItems: number }
}
export interface CompanySimilarResponse extends ToolResponse {
  output: {
    items: CompanyRecord[]
    page: number
    totalPages: number
    totalItems: number
    scores: Record<string, number>
  }
}

export const COMPANY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Company UUID' },
  name: { type: 'string', description: 'Company name', optional: true },
  domain: { type: 'string', description: 'Primary company domain', optional: true },
  website: { type: 'string', description: 'Company website URL', optional: true },
  description: { type: 'string', description: 'Company description', optional: true },
  industry: { type: 'string', description: 'Primary industry', optional: true },
  employees: { type: 'string', description: 'Employee count range', optional: true },
  revenue: { type: 'string', description: 'Annual revenue range in USD', optional: true },
  founded_year: { type: 'number', description: 'Year founded', optional: true },
  technologies: { type: 'array', description: 'Technologies used', items: { type: 'string' } },
} as const
