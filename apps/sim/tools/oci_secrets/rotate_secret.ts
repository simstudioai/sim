import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type { OciSecretsResponse, OciSecretsRotateSecretParams } from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsRotateSecretTool: InternalToolConfig<
  OciSecretsRotateSecretParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_rotate_secret',
  name: 'OCI Secrets Rotate Secret',
  description:
    'Start asynchronous rotation using the configured target system and return the work request ID for monitoring.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    secretId: ociSecretsParams.secretId,
    ifMatch: ociSecretsParams.ifMatch,
    retryToken: ociSecretsParams.retryToken,
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
    workRequestId: {
      type: 'string',
      description: 'Work request OCID to monitor the accepted rotation',
      optional: true,
      nullable: true,
    },
  },
}
