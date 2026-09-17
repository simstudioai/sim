import type {
  CodaCustomDomain,
  CodaDocParams,
  CodaListCustomDomainsResponse,
} from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  NEXT_PAGE_TOKEN_OUTPUT,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

type RawCustomDomain = Omit<CodaCustomDomain, 'lastVerifiedTimestamp'> & {
  lastVerifiedTimestamp?: string
}

export const codaListCustomDomainsTool: ToolConfig<CodaDocParams, CodaListCustomDomainsResponse> = {
  id: 'coda_list_custom_domains',
  name: 'Coda List Custom Domains',
  description: 'List the custom domains connected to a published Coda doc and their setup status',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams, docId: DOC_ID_PARAM },

  request: {
    url: (params) => buildCodaUrl(codaDocPath(params.docId, 'domains')),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as {
      customDocDomains?: RawCustomDomain[]
      nextPageToken?: string
    }
    return {
      success: true,
      output: {
        customDomains: (data.customDocDomains ?? []).map((domain) => ({
          customDocDomain: domain.customDocDomain,
          hasCertificate: domain.hasCertificate,
          hasDnsDocId: domain.hasDnsDocId,
          setupStatus: domain.setupStatus,
          domainStatus: domain.domainStatus,
          lastVerifiedTimestamp: domain.lastVerifiedTimestamp ?? null,
        })),
        nextPageToken: data.nextPageToken || null,
      },
    }
  },

  outputs: {
    customDomains: {
      type: 'array',
      description: 'Custom domains for the published doc',
      items: {
        type: 'object',
        properties: {
          customDocDomain: { type: 'string', description: 'The custom domain' },
          hasCertificate: { type: 'boolean', description: 'Whether the domain has a certificate' },
          hasDnsDocId: {
            type: 'boolean',
            description: 'Whether the domain DNS points back to this doc',
          },
          setupStatus: { type: 'string', description: 'Setup status (pending, succeeded, failed)' },
          domainStatus: { type: 'string', description: 'connected or notConnected' },
          lastVerifiedTimestamp: {
            type: 'string',
            description: 'When the DNS settings were last checked',
            optional: true,
          },
        },
      },
    },
    nextPageToken: NEXT_PAGE_TOKEN_OUTPUT,
  },
}
