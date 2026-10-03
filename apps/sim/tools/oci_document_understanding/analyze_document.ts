import { selectModelBoundFileInputPaths } from '@/lib/uploads/utils/model-input'
import {
  documentAnalysisParams,
  documentAuthParams,
  documentOAuth,
  documentOperationInput,
  documentProjectionParams,
} from '@/tools/oci_document_understanding/shared'
import {
  DOCUMENT_ANALYSIS_OUTPUT,
  DOCUMENT_REQUEST_ID_OUTPUT,
  type OciDocumentParams,
  type OciDocumentResponse,
} from '@/tools/oci_document_understanding/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDocumentAnalyzeDocumentTool: InternalToolConfig<
  OciDocumentParams,
  OciDocumentResponse
> = {
  id: 'oci_document_understanding_analyze_document',
  name: 'OCI Document Understanding Analyze Document',
  description:
    'Analyze text, tables, fields and classifications in one JPEG, PNG, PDF or TIFF document of at most 8 MB and five pages. The OCI transport makes one attempt. Disable block/workflow retries to avoid duplicate paid analysis.',
  version: '1.0.0',
  oauth: documentOAuth,
  params: { ...documentAuthParams, ...documentAnalysisParams, ...documentProjectionParams },
  operation: {
    modelInput: {
      mode: 'private-provenance',
      inputPaths: (params) =>
        selectModelBoundFileInputPaths(params.file, ['file'], { includeInlineBase64: true }),
    },
    input: (params) =>
      documentOperationInput(params, [
        'source',
        'file',
        'objects',
        'pageRange',
        'features',
        'compartmentId',
        'documentType',
        'language',
        'pageNumbers',
        'maxPages',
        'maxOutputBytes',
        'includeWords',
        'includeGeometry',
      ]),
  },
  outputs: { ...DOCUMENT_REQUEST_ID_OUTPUT, analysis: DOCUMENT_ANALYSIS_OUTPUT },
}
