import {
  createOciVisionOperationInput,
  ociVisionAuthParams,
  ociVisionJobIdParam,
  ociVisionOAuth,
} from '@/tools/oci_vision/shared'
import {
  OCI_VISION_JOB_OUTPUT,
  OCI_VISION_REQUEST_OUTPUT,
  type OciVisionParams,
  type OciVisionResponse,
} from '@/tools/oci_vision/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociVisionGetImageJobTool: InternalToolConfig<
  OciVisionParams<'get_image_job'>,
  OciVisionResponse<'get_image_job'>
> = {
  id: 'oci_vision_get_image_job',
  name: 'OCI Vision Get Image Job',
  description:
    'Read an image job status once. FAILED and CANCELED remain valid status results; no automatic polling or resubmission.',
  version: '1.0.0',
  oauth: ociVisionOAuth,
  params: { ...ociVisionAuthParams, imageJobId: ociVisionJobIdParam },
  operation: { input: (params) => createOciVisionOperationInput(params, ['imageJobId']) },
  outputs: {
    ...OCI_VISION_REQUEST_OUTPUT,
    job: OCI_VISION_JOB_OUTPUT,
    etag: { type: 'string', optional: true, description: 'Job ETag for an If-Match cancellation' },
  },
}
