import { workProperties } from '@/tools/oci_secrets/outputs'
import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type { OciSecretsGetWorkRequestParams, OciSecretsResponse } from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsGetWorkRequestTool: InternalToolConfig<
  OciSecretsGetWorkRequestParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_get_work_request',
  name: 'OCI Secrets Get Work Request',
  description: 'Read the status and progress of a secret work request.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    workRequestId: ociSecretsParams.workRequestId,
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
    workRequest: {
      type: 'json',
      description: 'Work request status and resources',
      properties: workProperties,
    },
  },
}
