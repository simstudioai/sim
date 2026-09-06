import {
  createOciVisionOperationInput,
  ociVisionAuthParams,
  ociVisionOAuth,
} from '@/tools/oci_vision/shared'
import {
  OCI_VISION_MODEL_OUTPUT,
  OCI_VISION_REQUEST_OUTPUT,
  type OciVisionParams,
  type OciVisionResponse,
} from '@/tools/oci_vision/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociVisionGetModelTool: InternalToolConfig<
  OciVisionParams<'get_model'>,
  OciVisionResponse<'get_model'>
> = {
  id: 'oci_vision_get_model',
  name: 'OCI Vision Get Model',
  description:
    'Read a Vision model type, version, project, and lifecycle state without training or modifying it.',
  version: '1.0.0',
  oauth: ociVisionOAuth,
  params: {
    ...ociVisionAuthParams,
    modelId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Vision model OCID',
    },
  },
  operation: { input: (params) => createOciVisionOperationInput(params, ['modelId']) },
  outputs: { ...OCI_VISION_REQUEST_OUTPUT, model: OCI_VISION_MODEL_OUTPUT },
}
