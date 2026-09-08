import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type {
  OciSecretsResponse,
  OciSecretsScheduleSecretDeletionParams,
} from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsScheduleSecretDeletionTool: InternalToolConfig<
  OciSecretsScheduleSecretDeletionParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_schedule_secret_deletion',
  name: 'OCI Secrets Schedule Secret Deletion',
  description:
    'Schedule secret deletion after the recovery period. A pending deletion prevents secret retrieval; cancel before permanent deletion to recover it.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    secretId: ociSecretsParams.secretId,
    timeOfDeletion: ociSecretsParams.timeOfDeletion,
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
