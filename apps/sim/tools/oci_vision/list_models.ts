import {
  createOciVisionOperationInput,
  OCI_VISION_LIST_FIELDS,
  ociVisionAuthParams,
  ociVisionListParams,
  ociVisionOAuth,
} from '@/tools/oci_vision/shared'
import {
  OCI_VISION_MODEL_OUTPUT,
  OCI_VISION_REQUEST_OUTPUT,
  type OciVisionParams,
  type OciVisionResponse,
} from '@/tools/oci_vision/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociVisionListModelsTool: InternalToolConfig<
  OciVisionParams<'list_models'>,
  OciVisionResponse<'list_models'>
> = {
  id: 'oci_vision_list_models',
  name: 'OCI Vision List Models',
  description: 'List one bounded page of existing Vision models, optionally within a project.',
  version: '1.0.0',
  oauth: ociVisionOAuth,
  params: {
    ...ociVisionAuthParams,
    ...ociVisionListParams,
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional Vision project OCID filter',
    },
  },
  operation: {
    input: (params) =>
      createOciVisionOperationInput(params, [...OCI_VISION_LIST_FIELDS, 'projectId']),
  },
  outputs: {
    ...OCI_VISION_REQUEST_OUTPUT,
    models: { type: 'array', items: OCI_VISION_MODEL_OUTPUT },
    nextPage: {
      type: 'string',
      optional: true,
      description: 'Pass as page to retrieve the next Vision page',
    },
  },
}
