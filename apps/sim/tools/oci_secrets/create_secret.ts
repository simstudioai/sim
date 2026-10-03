import { secretProperties } from '@/tools/oci_secrets/outputs'
import {
  ociSecretsAuthParams,
  ociSecretsConfigurationParams,
  ociSecretsParams,
} from '@/tools/oci_secrets/params'
import type { OciSecretsCreateSecretParams, OciSecretsResponse } from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsCreateSecretTool: InternalToolConfig<
  OciSecretsCreateSecretParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_create_secret',
  name: 'OCI Secrets Create Secret',
  description:
    'Create a secret with supplied base64 content or automatic generation. Requires secret creation, vault use and encryption key permissions.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    compartmentId: ociSecretsParams.compartmentId,
    secretName: ociSecretsParams.secretName,
    vaultId: ociSecretsParams.vaultId,
    keyId: ociSecretsParams.keyId,
    ...ociSecretsConfigurationParams,
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
    secret: {
      type: 'json',
      description: 'Secret metadata, rules and configuration',
      properties: secretProperties,
    },
  },
}
