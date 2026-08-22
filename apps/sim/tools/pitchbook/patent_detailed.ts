import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookProfileParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookPatentDetailedTool: ToolConfig<PitchbookProfileParams, PitchbookResponse> = {
  id: 'pitchbook_patent_detailed',
  name: 'PitchBook Patent Detail',
  description:
    'Retrieve the full record for a single patent: title, status, dates, assignees, inventors, citations, and claim counts',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    pbId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Patent ID, e.g. EP-3167426-B1. Patent IDs come from a patent search.',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO currency code to convert monetary values into, sent as the X-Currency header (e.g. USD, EUR, JPY). Defaults to the currency on the account preferences.',
    },
  },

  request: {
    url: (params) => `${PITCHBOOK_API_BASE}/companies/patents/${params.pbId.trim()}/detailed`,
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch patent detail')
    const data = await response.json()

    return {
      success: true,
      output: {
        patentId: data.patentId ?? null,
        patentTitle: data.patentTitle ?? null,
        status: data.status ?? null,
        publicationDate: data.publicationDate ?? null,
        firstFilingDate: data.firstFilingDate ?? null,
        expirationDate: data.expirationDate ?? null,
        filingAuthorityLocation: data.filingAuthorityLocation ?? null,
        cpcSection: data.cpcSection ?? null,
        cpcClass: data.cpcClass ?? null,
        cpcSubclass: data.cpcSubclass ?? null,
        currentAssigneeNames: data.currentAssigneeNames ?? [],
        originalAssigneeNames: data.originalAssigneeNames ?? [],
        mostRecentLegalStatus: data.mostRecentLegalStatus ?? null,
        mostRecentLegalStatusDate: data.mostRecentLegalStatusDate ?? null,
        applicationDate: data.applicationDate ?? null,
        grantDate: data.grantDate ?? null,
        familyId: data.familyId ?? null,
        inventors: data.inventors ?? [],
        documentForwardCitations: data.documentForwardCitations ?? null,
        documentBackwardCitations: data.documentBackwardCitations ?? null,
        countOfClaims: data.countOfClaims ?? null,
        countOfIndependentClaims: data.countOfIndependentClaims ?? null,
        patentDownloadUrl: data.patentDownloadUrl ?? null,
      },
    }
  },

  outputs: {
    patentId: { type: 'string', description: 'Patent ID', nullable: true },
    patentTitle: { type: 'string', description: 'Patent title', nullable: true },
    status: { type: 'string', description: 'Status', nullable: true },
    publicationDate: {
      type: 'string',
      description: 'Publication date (YYYY-MM-DD)',
      nullable: true,
    },
    firstFilingDate: {
      type: 'string',
      description: 'First filing date (YYYY-MM-DD)',
      nullable: true,
    },
    expirationDate: { type: 'json', description: 'Expiration date (YYYY-MM-DD)', nullable: true },
    filingAuthorityLocation: {
      type: 'string',
      description: 'Filing authority location',
      nullable: true,
    },
    cpcSection: {
      type: 'object',
      description: 'CPC section',
      properties: {
        code: { type: 'string', description: 'PitchBook code' },
        description: { type: 'string', description: 'Human-readable label for the code' },
      },
    },
    cpcClass: {
      type: 'object',
      description: 'CPC class',
      properties: {
        code: { type: 'string', description: 'PitchBook code' },
        description: { type: 'string', description: 'Human-readable label for the code' },
      },
    },
    cpcSubclass: {
      type: 'object',
      description: 'CPC subclass',
      properties: {
        code: { type: 'string', description: 'PitchBook code' },
        description: { type: 'string', description: 'Human-readable label for the code' },
      },
    },
    currentAssigneeNames: {
      type: 'array',
      description: 'Current assignees',
      items: { type: 'string' },
    },
    originalAssigneeNames: {
      type: 'array',
      description: 'Original assignees',
      items: { type: 'json' },
    },
    mostRecentLegalStatus: {
      type: 'string',
      description: 'Most recent legal status',
      nullable: true,
    },
    mostRecentLegalStatusDate: {
      type: 'string',
      description: 'Date of the most recent legal status (YYYY-MM-DD)',
      nullable: true,
    },
    applicationDate: {
      type: 'string',
      description: 'Application date (YYYY-MM-DD)',
      nullable: true,
    },
    grantDate: { type: 'string', description: 'Grant date (YYYY-MM-DD)', nullable: true },
    familyId: { type: 'string', description: 'Patent family ID', nullable: true },
    inventors: {
      type: 'array',
      description: 'Named inventors',
      items: { type: 'string' },
    },
    documentForwardCitations: {
      type: 'number',
      description: 'Number of forward citations',
      nullable: true,
    },
    documentBackwardCitations: {
      type: 'number',
      description: 'Number of backward citations',
      nullable: true,
    },
    countOfClaims: { type: 'number', description: 'Number of claims', nullable: true },
    countOfIndependentClaims: {
      type: 'number',
      description: 'Number of independent claims',
      nullable: true,
    },
    patentDownloadUrl: {
      type: 'string',
      description: 'Link to download the patent document',
      nullable: true,
    },
  },
}
