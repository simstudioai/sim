import type { CodaPublishDocParams, CodaRequestIdResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  optionalTrimmed,
  parseStringList,
  REQUEST_ID_OUTPUT,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaPublishDocTool: ToolConfig<CodaPublishDocParams, CodaRequestIdResponse> = {
  id: 'coda_publish_doc',
  name: 'Coda Publish Doc',
  description:
    'Publish a Coda doc or update its publishing settings: URL slug, discoverability, categories, and interaction mode. The doc owner needs a Coda maker profile.',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    slug: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL slug for the published doc (e.g., "my-doc")',
    },
    discoverable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the published doc is discoverable in the gallery',
    },
    categoryNames: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Category names to apply, as an array or comma-separated list (see List Doc Categories)',
    },
    mode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Interaction mode for viewers: "view", "play", or "edit"',
    },
  },

  request: {
    url: (params) => buildCodaUrl(codaDocPath(params.docId, 'publish')),
    method: 'PUT',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken, true),
    body: (params) => {
      const categoryNames = parseStringList(params.categoryNames, 'categoryNames')
      return {
        ...(optionalTrimmed(params.slug) ? { slug: optionalTrimmed(params.slug) } : {}),
        ...(typeof params.discoverable === 'boolean' ? { discoverable: params.discoverable } : {}),
        ...(categoryNames.length > 0 ? { categoryNames } : {}),
        ...(params.mode ? { mode: params.mode } : {}),
      }
    },
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as { requestId: string }
    return { success: true, output: { requestId: data.requestId } }
  },

  outputs: {
    requestId: REQUEST_ID_OUTPUT,
  },
}
