import type { CodaCustomDomainParams, CodaCustomDomainResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  CUSTOM_DOMAIN_PARAM,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaAddCustomDomainTool: ToolConfig<CodaCustomDomainParams, CodaCustomDomainResponse> =
  {
    id: 'coda_add_custom_domain',
    name: 'Coda Add Custom Domain',
    description:
      'Connect a custom domain to a published Coda doc. Requires a Coda plan with custom domains.',
    version: '1.0.0',
    oauth: codaOAuth,
    errorExtractor: ErrorExtractorId.CODA_ERRORS,

    params: { ...codaAuthParams, docId: DOC_ID_PARAM, customDocDomain: CUSTOM_DOMAIN_PARAM },

    request: {
      url: (params) => buildCodaUrl(codaDocPath(params.docId, 'domains')),
      method: 'POST',
      retry: CODA_RETRY,
      headers: (params) => codaHeaders(params.accessToken, true),
      body: (params) => ({ customDocDomain: String(params.customDocDomain ?? '').trim() }),
    },

    transformResponse: async (_response, params) => ({
      success: true,
      output: {
        docId: String(params?.docId ?? '').trim(),
        customDocDomain: String(params?.customDocDomain ?? '').trim(),
      },
    }),

    outputs: {
      docId: { type: 'string', description: 'ID of the doc' },
      customDocDomain: { type: 'string', description: 'The custom domain that was added' },
    },
  }
