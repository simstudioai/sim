import {
  OCI_STREAMING_RESPONSE_OUTPUTS,
  OCI_STREAMING_WORK_REQUEST_OUTPUTS,
  type OciStreamingGetWorkRequestParams,
  type OciStreamingResponse,
} from '@/tools/oci_streaming/types'
import { OCI_STREAMING_AUTH_PARAMS } from '@/tools/oci_streaming/utils'
import type { InternalToolConfig } from '@/tools/types'

export const ociStreamingGetWorkRequestTool: InternalToolConfig<
  OciStreamingGetWorkRequestParams,
  OciStreamingResponse
> = {
  id: 'oci_streaming_get_work_request',
  name: 'OCI Streaming Get Work Request',
  description: 'Get asynchronous Streaming operation status and affected resources.',
  version: '1.0.0',
  params: {
    ...OCI_STREAMING_AUTH_PARAMS,
    workRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Asynchronous work request OCID.',
    },
  },
  operation: {
    input: (params) => ({
      operation: 'get_work_request',
      ociCredential: params.ociCredential,
      ociRegion: params.ociRegion,
      requestId: params.requestId,
      workRequestId: params.workRequestId,
    }),
  },
  outputs: {
    ...OCI_STREAMING_RESPONSE_OUTPUTS,
    ...OCI_STREAMING_WORK_REQUEST_OUTPUTS,
  },
}
