import type {
  CodaGetCustomDomainProviderParams,
  CodaGetCustomDomainProviderResponse,
} from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  CUSTOM_DOMAIN_PARAM,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  codaPath,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaGetCustomDomainProviderTool: ToolConfig<
  CodaGetCustomDomainProviderParams,
  CodaGetCustomDomainProviderResponse
> = {
  id: 'coda_get_custom_domain_provider',
  name: 'Coda Get Custom Domain Provider',
  description:
    'Look up the DNS provider (GoDaddy, Namecheap, Hover, Network Solutions, Google Domains, or Other) of a custom domain',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams, customDocDomain: CUSTOM_DOMAIN_PARAM },

  request: {
    url: (params) =>
      buildCodaUrl(codaPath('domains', 'provider', [params.customDocDomain, 'customDocDomain'])),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response, params) => {
    const data = (await response.json()) as { provider: string }
    return {
      success: true,
      output: {
        customDocDomain: String(params?.customDocDomain ?? '').trim(),
        provider: data.provider,
      },
    }
  },

  outputs: {
    customDocDomain: { type: 'string', description: 'The custom domain' },
    provider: { type: 'string', description: 'DNS provider of the domain' },
  },
}
