import { logProperties } from '@/tools/oci_secrets/outputs'
import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type {
  OciSecretsListWorkRequestLogsParams,
  OciSecretsResponse,
} from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsListWorkRequestLogsTool: InternalToolConfig<
  OciSecretsListWorkRequestLogsParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_list_work_request_logs',
  name: 'OCI Secrets List Work Request Logs',
  description: 'List activity log entries for a secret work request.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    workRequestId: ociSecretsParams.workRequestId,
    limit: ociSecretsParams.limit,
    page: ociSecretsParams.page,
    sortOrder: ociSecretsParams.sortOrder,
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
    logs: {
      type: 'array',
      description: 'Work request log entries in this page',
      items: { type: 'object', properties: logProperties },
    },
  },
}
