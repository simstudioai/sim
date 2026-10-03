import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsGetWorkRequestParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsGetWorkRequestTool: InternalToolConfig<
  OciDevopsGetWorkRequestParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_get_work_request',
  name: 'OCI DevOps Get Work Request',
  description: 'Get Work Request in OCI DevOps',
  version: '1.0.0',
  params: {
    oauthCredential: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OCI API-key service-account credential ID',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OCI region; defaults to the credential region',
    },
    workRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the asynchronous work request.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      workRequestId: params.workRequestId,
    }),
  },
  outputs: ociDevopsOutputs,
}
