import type {
  CodaResolveBrowserLinkParams,
  CodaResolveBrowserLinkResponse,
} from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  requiredTrimmed,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaResolveBrowserLinkTool: ToolConfig<
  CodaResolveBrowserLinkParams,
  CodaResolveBrowserLinkResponse
> = {
  id: 'coda_resolve_browser_link',
  name: 'Coda Resolve Browser Link',
  description:
    'Resolve a Coda browser URL (doc, page, table, row, etc.) into its resource type and ID for use in other Coda operations',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    url: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Coda browser link, e.g., https://coda.io/d/_dAbCDeFGH/Launch-Status_sumnO',
    },
    degradeGracefully: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'If the linked object was deleted, resolve the nearest existing parent (up to the doc) instead of failing',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl('/resolveBrowserLink', {
        url: requiredTrimmed(params.url, 'url'),
        degradeGracefully: params.degradeGracefully,
      }),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as {
      browserLink?: string
      resource: { type: string; id: string; name?: string; href: string }
    }
    return {
      success: true,
      output: {
        browserLink: data.browserLink ?? null,
        resource: {
          type: data.resource.type,
          id: data.resource.id,
          name: data.resource.name ?? null,
          href: data.resource.href,
        },
      },
    }
  },

  outputs: {
    browserLink: {
      type: 'string',
      description: 'Canonical browser link to the resource',
      nullable: true,
    },
    resource: {
      type: 'object',
      description: 'The resolved resource',
      properties: {
        type: {
          type: 'string',
          description: 'Resource type (doc, page, table, row, column, formula, control, etc.)',
        },
        id: { type: 'string', description: 'Resource ID' },
        name: { type: 'string', description: 'Resource name', nullable: true },
        href: { type: 'string', description: 'API link to the resource' },
      },
    },
  },
}
