import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsListWorkRequestErrorsParams,
  OciDevopsResponse,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsListWorkRequestErrorsTool: InternalToolConfig<
  OciDevopsListWorkRequestErrorsParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_list_work_request_errors',
  name: 'OCI DevOps List Work Request Errors',
  description: 'List Work Request Errors in OCI DevOps',
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
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The page token representing the page at which to start retrieving results. This is usually retrieved from a previous list call.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The maximum number of items to return.',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The sort order to use. Use either ascending or descending. Allowed: ASC, DESC.',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The field to sort by. Only one sort order can be provided. Default sort order is descending and is based on the timeAccepted field. Allowed: timeAccepted.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      workRequestId: params.workRequestId,
      page: params.page,
      limit: params.limit,
      sortOrder: params.sortOrder,
      sortBy: params.sortBy,
    }),
  },
  outputs: ociDevopsOutputs,
}
