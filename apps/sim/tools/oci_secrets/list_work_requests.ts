import { workSummaryProperties } from '@/tools/oci_secrets/outputs'
import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type {
  OciSecretsListWorkRequestsParams,
  OciSecretsResponse,
} from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsListWorkRequestsTool: InternalToolConfig<
  OciSecretsListWorkRequestsParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_list_work_requests',
  name: 'OCI Secrets List Work Requests',
  description:
    'List work requests associated with a secret. Work requests are retained by Oracle for 12 hours.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    compartmentId: ociSecretsParams.compartmentId,
    secretId: ociSecretsParams.secretId,
    limit: ociSecretsParams.limit,
    page: ociSecretsParams.page,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    status: {
      type: 'number',
      description: 'Oracle HTTP response status; 202 means accepted, not completed',
    },
    opcRequestId: {
      type: 'string',
      description: 'Oracle request ID',
      optional: true,
      nullable: true,
    },
    nextPage: {
      type: 'string',
      description: 'Opaque continuation token for the next page',
      optional: true,
      nullable: true,
    },
    workRequests: {
      type: 'array',
      description: 'Secret work requests in this page',
      items: { type: 'object', properties: workSummaryProperties },
    },
  },
}
