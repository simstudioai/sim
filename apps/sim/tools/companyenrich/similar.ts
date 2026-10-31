import { companyenrichRequest, responseData } from '@/tools/companyenrich/request'
import type { CompanyEnrichParams, CompanyEnrichResponse } from '@/tools/companyenrich/types'
import { COMPANY_OUTPUT_PROPERTIES } from '@/tools/companyenrich/types'
import { parsePage, parseScores } from '@/tools/companyenrich/utils'
import type { ToolConfig } from '@/tools/types'

export const companyenrichSimilarTool: ToolConfig<CompanyEnrichParams, CompanyEnrichResponse> = {
  id: 'companyenrich_similar',
  name: 'CompanyEnrich Find Similar Companies',
  description:
    'Find Similar Companies with CompanyEnrich. One request per execution; data requests can consume credits.',
  version: '1.1.0',
  errorExtractor: 'companyenrich-errors',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'CompanyEnrich API key without the Bearer prefix',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Company domain. For lookalikes, domains takes precedence over this legacy single seed.',
    },
    domains: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Array of 1\u201310 seed domains for lookalikes or 1\u201350 domains for batch enrichment.',
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
    waitForEnrichment: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Wait for enrichment on supported company endpoints.',
    },
  },
  request: companyenrichRequest('post_companies_similar'),
  transformResponse: async (response) => {
    const data = await responseData(response)
    return { success: true, output: { ...parsePage(data), scores: parseScores(data), data } }
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
    scores: { type: 'json', description: 'Similarity scores keyed by company UUID' },
  },
}
