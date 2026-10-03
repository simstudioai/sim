import { selectModelBoundFileInputPaths } from '@/lib/uploads/utils/model-input'
import {
  createOciVisionOperationInput,
  OCI_VISION_FEATURE_FIELDS,
  ociVisionAuthParams,
  ociVisionFeatureParams,
  ociVisionOAuth,
} from '@/tools/oci_vision/shared'
import {
  OCI_VISION_ANALYSIS_OUTPUTS,
  OCI_VISION_REQUEST_OUTPUT,
  type OciVisionParams,
  type OciVisionResponse,
} from '@/tools/oci_vision/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociVisionAnalyzeImageTool: InternalToolConfig<
  OciVisionParams<'analyze_image'>,
  OciVisionResponse<'analyze_image'>
> = {
  id: 'oci_vision_analyze_image',
  name: 'OCI Vision Analyze Image',
  description:
    'Analyze one JPEG or PNG for labels, objects, scene text, and faces. Uses one request attempt; enabled block retries may repeat paid analysis.',
  version: '1.0.0',
  oauth: ociVisionOAuth,
  params: {
    ...ociVisionAuthParams,
    ...ociVisionFeatureParams,
    source: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'file or object_storage',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Authorized uploaded JPEG or PNG, at most 5,000,000 bytes; required for file source',
    },
    namespaceName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'OCI namespace; required for object_storage source',
    },
    bucketName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'OCI bucket; required for object_storage source',
    },
    objectName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exact OCI object name; required for object_storage source',
    },
  },
  operation: {
    modelInput: {
      mode: 'private-provenance',
      inputPaths: (params) =>
        params.source === 'file'
          ? selectModelBoundFileInputPaths(params.file, ['file'], {
              includeInlineBase64: true,
              parseSerializedFile: true,
            })
          : [],
    },
    input: (params) =>
      createOciVisionOperationInput(params, [
        ...OCI_VISION_FEATURE_FIELDS,
        'source',
        'file',
        'namespaceName',
        'bucketName',
        'objectName',
      ]),
  },
  outputs: { ...OCI_VISION_REQUEST_OUTPUT, ...OCI_VISION_ANALYSIS_OUTPUTS },
}
