import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  ModalListModelsApiResponse,
  ModalListModelsParams,
  ModalListModelsResponse,
} from '@/tools/modal/types'
import {
  extractModalError,
  MAX_MODAL_RESPONSE_BODY_BYTES,
  MODAL_MODEL_OUTPUT_PROPERTIES,
  MODAL_SHARED_INFERENCE_URL,
  mapModalModel,
  modalOpenAiUrl,
  modalProxyAuthHeaders,
} from '@/tools/modal/utils'
import type { ToolConfig } from '@/tools/types'

export const modalListModelsTool: ToolConfig<ModalListModelsParams, ModalListModelsResponse> = {
  id: 'modal_list_models',
  name: 'Modal List Models',
  description: 'List the model IDs a Modal proxy token can reach on an endpoint',
  version: '1.0.0',

  params: {
    endpointUrl: {
      type: 'string',
      required: false,
      default: MODAL_SHARED_INFERENCE_URL,
      visibility: 'user-or-llm',
      description:
        'Endpoint URL to query. Defaults to https://inference.us-west.modal.direct, which lists every Shared Endpoint the token can reach',
    },
    tokenId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Modal proxy token ID (wk-...)',
    },
    tokenSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Modal proxy token secret (ws-...)',
    },
  },

  request: {
    url: (params) =>
      modalOpenAiUrl(params.endpointUrl?.trim() || MODAL_SHARED_INFERENCE_URL, '/models'),
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      ...modalProxyAuthHeaders(params, { required: true }),
    }),
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      throw new Error(await extractModalError(response, 'Failed to list Modal models'))
    }

    const data = await readResponseJsonWithLimit<ModalListModelsApiResponse>(response, {
      maxBytes: MAX_MODAL_RESPONSE_BODY_BYTES,
      label: 'Modal models response body',
    })
    const models = Array.isArray(data?.data) ? data.data.map(mapModalModel) : []

    return {
      success: true,
      output: {
        models,
        count: models.length,
      },
    }
  },

  outputs: {
    models: {
      type: 'array',
      description: 'Models the token can reach on the endpoint',
      items: { type: 'object', properties: MODAL_MODEL_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of models returned' },
  },
}
