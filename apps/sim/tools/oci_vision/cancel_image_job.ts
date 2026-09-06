import {
  createOciVisionOperationInput,
  ociVisionAuthParams,
  ociVisionJobIdParam,
  ociVisionOAuth,
} from '@/tools/oci_vision/shared'
import {
  OCI_VISION_REQUEST_OUTPUT,
  type OciVisionParams,
  type OciVisionResponse,
} from '@/tools/oci_vision/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociVisionCancelImageJobTool: InternalToolConfig<
  OciVisionParams<'cancel_image_job'>,
  OciVisionResponse<'cancel_image_job'>
> = {
  id: 'oci_vision_cancel_image_job',
  name: 'OCI Vision Cancel Image Job',
  description:
    'Request cancellation of a batch image job. Check status separately; cancellation may leave output files and incurred charges.',
  version: '1.0.0',
  oauth: ociVisionOAuth,
  params: {
    ...ociVisionAuthParams,
    imageJobId: ociVisionJobIdParam,
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional ETag precondition',
    },
  },
  operation: {
    input: (params) => createOciVisionOperationInput(params, ['imageJobId', 'ifMatch']),
  },
  outputs: {
    ...OCI_VISION_REQUEST_OUTPUT,
    imageJobId: { type: 'string', description: 'Image job requested for cancellation' },
    cancellationRequested: {
      type: 'boolean',
      description: 'Oracle accepted the cancellation request; not a terminal-state guarantee',
    },
  },
}
