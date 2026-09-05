import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type {
  OciSecretsChangeSecretCompartmentParams,
  OciSecretsResponse,
} from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsChangeSecretCompartmentTool: InternalToolConfig<
  OciSecretsChangeSecretCompartmentParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_change_secret_compartment',
  name: 'OCI Secrets Change Secret Compartment',
  description:
    'Move a secret to another compartment with permissions in the source and destination compartments.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    secretId: ociSecretsParams.secretId,
    compartmentId: ociSecretsParams.compartmentId,
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
    etag: {
      type: 'string',
      description: 'ETag for optimistic concurrency control',
      optional: true,
      nullable: true,
    },
  },
}
