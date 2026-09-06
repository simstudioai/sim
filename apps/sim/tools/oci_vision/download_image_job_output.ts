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

export const ociVisionDownloadImageJobOutputTool: InternalToolConfig<
  OciVisionParams<'download_image_job_output'>,
  OciVisionResponse<'download_image_job_output'>
> = {
  id: 'oci_vision_download_image_job_output',
  name: 'OCI Vision Download Image Job Output',
  description:
    'Download one object under a job output prefix as a UserFile, at most 50 MiB. Does not parse results, unpack ZIPs, or restore archived objects.',
  version: '1.0.0',
  oauth: ociVisionOAuth,
  params: {
    ...ociVisionAuthParams,
    imageJobId: ociVisionJobIdParam,
    objectName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact object name from List Image Job Outputs, including its prefix',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional object ETag from the listing to guard against replacement',
    },
  },
  operation: {
    input: (params) =>
      createOciVisionOperationInput(params, ['imageJobId', 'objectName', 'ifMatch']),
  },
  outputs: {
    ...OCI_VISION_REQUEST_OUTPUT,
    imageJobId: { type: 'string' },
    objectName: { type: 'string' },
    etag: { type: 'string', optional: true },
    contentType: { type: 'string' },
    size: { type: 'number', description: 'Downloaded bytes' },
    file: { type: 'file', description: 'Downloaded output stored as a Sim UserFile' },
  },
}
