import type { ToolResponse } from '@/tools/types'

export interface CompanyEnrichParams {
  apiKey: string
  domain?: string
  domains?: string[]
  query?: string
  semanticQuery?: string
  page?: number
  pageSize?: number
  id?: string
  email?: string
  filters?: Record<string, unknown>
  properties?: Record<string, unknown>
  expand?: string[]
  waitForEnrichment?: boolean
  apiOperation?: string
  body?: Record<string, unknown>
  queryParameters?: Record<string, unknown>
  pathParameters?: Record<string, unknown>
  allow_beta?: boolean
}
export interface CompanyEnrichResponse extends ToolResponse {
  output: Record<string, unknown>
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
