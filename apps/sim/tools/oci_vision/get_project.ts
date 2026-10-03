import {
  createOciVisionOperationInput,
  ociVisionAuthParams,
  ociVisionOAuth,
} from '@/tools/oci_vision/shared'
import {
  OCI_VISION_PROJECT_OUTPUT,
  OCI_VISION_REQUEST_OUTPUT,
  type OciVisionParams,
  type OciVisionResponse,
} from '@/tools/oci_vision/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociVisionGetProjectTool: InternalToolConfig<
  OciVisionParams<'get_project'>,
  OciVisionResponse<'get_project'>
> = {
  id: 'oci_vision_get_project',
  name: 'OCI Vision Get Project',
  description: 'Read selected metadata and lifecycle state for a Vision project.',
  version: '1.0.0',
  oauth: ociVisionOAuth,
  params: {
    ...ociVisionAuthParams,
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Vision project OCID',
    },
  },
  operation: { input: (params) => createOciVisionOperationInput(params, ['projectId']) },
  outputs: { ...OCI_VISION_REQUEST_OUTPUT, project: OCI_VISION_PROJECT_OUTPUT },
}
