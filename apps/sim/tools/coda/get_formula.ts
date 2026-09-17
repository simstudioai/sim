import type { CodaFormulaResponse, CodaGetFormulaParams } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  mapFormula,
  NAMED_REFERENCE_PROPERTIES,
  type RawCodaNamedReference,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const codaGetFormulaTool: ToolConfig<CodaGetFormulaParams, CodaFormulaResponse> = {
  id: 'coda_get_formula',
  name: 'Coda Get Formula',
  description: 'Get the current computed value of a named formula in a Coda doc',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: {
    ...codaAuthParams,
    docId: DOC_ID_PARAM,
    formulaId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID or name of the formula (IDs are recommended, e.g., "f-fgHijkLm")',
    },
  },

  request: {
    url: (params) =>
      buildCodaUrl(codaDocPath(params.docId, 'formulas', [params.formulaId, 'formulaId'])),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as RawCodaNamedReference & { value?: unknown }
    return { success: true, output: { formula: mapFormula(data) } }
  },

  outputs: {
    formula: {
      type: 'object',
      description: 'Formula details',
      properties: {
        ...NAMED_REFERENCE_PROPERTIES,
        value: {
          type: 'json',
          description: 'Computed value (string, number, boolean, or array of these)',
        },
      },
    },
  },
}
