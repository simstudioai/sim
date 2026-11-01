import { companyenrichRequest, responseData } from '@/tools/companyenrich/request'
import type { CompanyEnrichParams, CompanyEnrichResponse } from '@/tools/companyenrich/types'
import { COMPANY_OUTPUT_PROPERTIES } from '@/tools/companyenrich/types'
import { parsePage } from '@/tools/companyenrich/utils'
import type { ToolConfig } from '@/tools/types'

export const companyenrichSearchTool: ToolConfig<CompanyEnrichParams, CompanyEnrichResponse> = {
  id: 'companyenrich_search',
  name: 'CompanyEnrich Search Companies',
  description:
    'Search Companies with CompanyEnrich. One request per execution; data requests can consume credits.',
  version: '1.1.0',
  errorExtractor: 'companyenrich-errors',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CompanyEnrich API key without the Bearer prefix',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Literal company name/domain query, up to 250 characters.',
    },
    semanticQuery: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Natural-language company description, up to 500 characters.',
    },
    filters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented request-body filters, including nested fields. Explicit inputs take precedence; unknown fields are forwarded to the API.',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'One-based page number (default 1). One page per execution.',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Results per page, 1\u2013100 (default 10). Additional pages can consume credits.',
    },
    expand: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Expansion array: ["workforce"] for companies (can spend extra credits) or ["education"] for people.',
    },
  },
  request: companyenrichRequest('post_companies_search'),
  transformResponse: async (response) => {
    const data = await responseData(response)
    return { success: true, output: { ...parsePage(data), data } }
  },
  outputs: {
    items: {
      type: 'array',
      description: 'Company profiles, including all provider fields.',
      items: { type: 'object', properties: COMPANY_OUTPUT_PROPERTIES },
    },
    page: { type: 'number', description: 'Current page' },
    totalPages: { type: 'number', description: 'Total pages' },
    totalItems: { type: 'number', description: 'Total matching companies' },
    data: {
      type: 'json',
      description: 'Complete unmodified API page with metadata, scores and future fields.',
    },
  },
}
