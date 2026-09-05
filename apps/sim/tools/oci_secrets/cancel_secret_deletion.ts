import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type {
  OciSecretsCancelSecretDeletionParams,
  OciSecretsResponse,
} from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsCancelSecretDeletionTool: InternalToolConfig<
  OciSecretsCancelSecretDeletionParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_cancel_secret_deletion',
  name: 'OCI Secrets Cancel Secret Deletion',
  description: 'Cancel a scheduled secret deletion before permanent deletion.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    secretId: ociSecretsParams.secretId,
    ifMatch: ociSecretsParams.ifMatch,
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
    etag: {
      type: 'string',
      description: 'ETag for optimistic concurrency control',
      optional: true,
      nullable: true,
    },
  },
}
