import { secretProperties } from '@/tools/oci_secrets/outputs'
import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type { OciSecretsGetSecretParams, OciSecretsResponse } from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsGetSecretTool: InternalToolConfig<
  OciSecretsGetSecretParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_get_secret',
  name: 'OCI Secrets Get Secret',
  description:
    'Get secret metadata, rules, rotation and replication configuration without retrieving content.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    secretId: ociSecretsParams.secretId,
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
    secret: {
      type: 'json',
      description: 'Secret metadata, rules and configuration',
      properties: secretProperties,
    },
  },
}
