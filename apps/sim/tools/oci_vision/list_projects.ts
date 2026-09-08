import {
  createOciVisionOperationInput,
  OCI_VISION_LIST_FIELDS,
  ociVisionAuthParams,
  ociVisionListParams,
  ociVisionOAuth,
} from '@/tools/oci_vision/shared'
import {
  OCI_VISION_PROJECT_OUTPUT,
  OCI_VISION_REQUEST_OUTPUT,
  type OciVisionParams,
  type OciVisionResponse,
} from '@/tools/oci_vision/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociVisionListProjectsTool: InternalToolConfig<
  OciVisionParams<'list_projects'>,
  OciVisionResponse<'list_projects'>
> = {
  id: 'oci_vision_list_projects',
  name: 'OCI Vision List Projects',
  description: 'List one bounded page of Vision projects in a compartment.',
  version: '1.0.0',
  oauth: ociVisionOAuth,
  params: { ...ociVisionAuthParams, ...ociVisionListParams },
  operation: { input: (params) => createOciVisionOperationInput(params, OCI_VISION_LIST_FIELDS) },
  outputs: {
    ...OCI_VISION_REQUEST_OUTPUT,
    projects: { type: 'array', items: OCI_VISION_PROJECT_OUTPUT },
    nextPage: {
      type: 'string',
      optional: true,
      description: 'Pass as page to retrieve the next Vision page',
    },
  },
}
