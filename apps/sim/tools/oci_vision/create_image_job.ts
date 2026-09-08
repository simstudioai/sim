import {
  createOciVisionOperationInput,
  OCI_VISION_FEATURE_FIELDS,
  ociVisionAuthParams,
  ociVisionFeatureParams,
  ociVisionOAuth,
} from '@/tools/oci_vision/shared'
import {
  OCI_VISION_JOB_OUTPUT,
  OCI_VISION_REQUEST_OUTPUT,
  type OciVisionParams,
  type OciVisionResponse,
} from '@/tools/oci_vision/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociVisionCreateImageJobTool: InternalToolConfig<
  OciVisionParams<'create_image_job'>,
  OciVisionResponse<'create_image_job'>
> = {
  id: 'oci_vision_create_image_job',
  name: 'OCI Vision Create Image Job',
  description:
    'Submit up to 2000 OCI images for batch analysis and return a job immediately. Reuse a retry token to protect repeated submissions; unkeyed block retries can create duplicate paid jobs.',
  version: '1.0.0',
  oauth: ociVisionOAuth,
  params: {
    ...ociVisionAuthParams,
    ...ociVisionFeatureParams,
    objectLocations: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of {namespaceName,bucketName,objectName}; 1–2000 JPEG/PNG objects, at most 5 MB each; serialized job body at most 500,000 bytes',
    },
    outputNamespaceName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Namespace for batch output files',
    },
    outputBucketName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Bucket for batch output files; OCI must have write access',
    },
    outputPrefix: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Nonempty dedicated output prefix; reusing a prefix can mix files from different jobs',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional job display name',
    },
    isZipOutputEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Request ZIP output; defaults to false',
    },
    retryToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Stable token, at most 64 ASCII characters. Reuse only for the same submission; enables at most two request attempts. Oracle normally retains tokens for 24 hours.',
    },
  },
  operation: {
    input: (params) =>
      createOciVisionOperationInput(params, [
        ...OCI_VISION_FEATURE_FIELDS,
        'objectLocations',
        'outputNamespaceName',
        'outputBucketName',
        'outputPrefix',
        'displayName',
        'isZipOutputEnabled',
        'retryToken',
      ]),
  },
  outputs: { ...OCI_VISION_REQUEST_OUTPUT, job: OCI_VISION_JOB_OUTPUT },
}
