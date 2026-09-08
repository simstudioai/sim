import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type {
  OciSecretsResponse,
  OciSecretsScheduleSecretVersionDeletionParams,
} from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsScheduleSecretVersionDeletionTool: InternalToolConfig<
  OciSecretsScheduleSecretVersionDeletionParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_schedule_secret_version_deletion',
  name: 'OCI Secrets Schedule Secret Version Deletion',
  description:
    'Schedule deletion of a deprecated secret version. Oracle enforces version eligibility and the recovery period.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    secretId: ociSecretsParams.secretId,
    secretVersionNumber: ociSecretsParams.secretVersionNumber,
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
