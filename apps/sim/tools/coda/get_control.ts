import type { CodaControlResponse, CodaGetControlParams } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  mapControl,
  NAMED_REFERENCE_PROPERTIES,
  type RawCodaNamedReference,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaGetControlTool: ToolConfig<CodaGetControlParams, CodaControlResponse> = {
  id: 'coda_get_control',
  name: 'Coda Get Control',
  description: 'Get the type and current value of a control in a Coda doc',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    controlId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID or name of the control (IDs are recommended, e.g., "ctrl-cDefGhij")',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'controls', [params.controlId, 'controlId'])),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as RawCodaNamedReference & {
      controlType?: string
      value?: unknown
    }
    return { success: true, output: { control: mapControl(data) } }
  },

  outputs: {
    control: {
      type: 'object',
      description: 'Control details',
      properties: {
        ...NAMED_REFERENCE_PROPERTIES,
        controlType: {
          type: 'string',
          description:
            'Control type (aiBlock, button, checkbox, datePicker, dateRangePicker, dateTimePicker, lookup, multiselect, select, scale, slider, reaction, textbox, timePicker)',
          optional: true,
        },
        value: {
          type: 'json',
          description: 'Current value (string, number, boolean, or array of these)',
        },
      },
    },
  },
}
