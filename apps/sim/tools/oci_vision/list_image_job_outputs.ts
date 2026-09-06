import {
  createOciVisionOperationInput,
  ociVisionAuthParams,
  ociVisionJobIdParam,
  ociVisionOAuth,
} from '@/tools/oci_vision/shared'
import {
  OCI_VISION_LOCATION_OUTPUT,
  OCI_VISION_OBJECT_OUTPUT,
  OCI_VISION_REQUEST_OUTPUT,
  type OciVisionParams,
  type OciVisionResponse,
} from '@/tools/oci_vision/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociVisionListImageJobOutputsTool: InternalToolConfig<
  OciVisionParams<'list_image_job_outputs'>,
  OciVisionResponse<'list_image_job_outputs'>
> = {
  id: 'oci_vision_list_image_job_outputs',
  name: 'OCI Vision List Image Job Outputs',
  description:
    'List one page of objects under a job output prefix. Reused prefixes can contain other jobs’ files; results are not parsed.',
  version: '1.0.0',
  oauth: ociVisionOAuth,
  params: {
    ...ociVisionAuthParams,
    imageJobId: ociVisionJobIdParam,
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Objects per page, 1–100; defaults to 10',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Object Storage nextStartWith from the preceding page; distinct from Vision page tokens',
    },
  },
  operation: {
    input: (params) => createOciVisionOperationInput(params, ['imageJobId', 'limit', 'start']),
  },
  outputs: {
    ...OCI_VISION_REQUEST_OUTPUT,
    imageJobId: { type: 'string' },
    outputLocation: OCI_VISION_LOCATION_OUTPUT,
    objects: { type: 'array', items: OCI_VISION_OBJECT_OUTPUT },
    nextStartWith: {
      type: 'string',
      optional: true,
      description: 'Pass as start to retrieve the next object page',
    },
  },
}
