import { secretProperties } from '@/tools/oci_secrets/outputs'
import {
  ociSecretsAuthParams,
  ociSecretsConfigurationParams,
  ociSecretsParams,
} from '@/tools/oci_secrets/params'
import type { OciSecretsResponse, OciSecretsUpdateSecretParams } from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsUpdateSecretTool: InternalToolConfig<
  OciSecretsUpdateSecretParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_update_secret',
  name: 'OCI Secrets Update Secret',
  description:
    'Update secret configuration, create a content version or promote an existing version. Content, promotion and rule changes must be separate requests.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    secretId: ociSecretsParams.secretId,
    ...ociSecretsConfigurationParams,
    currentVersionNumber: ociSecretsParams.currentVersionNumber,
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
    secret: {
      type: 'json',
      description: 'Secret metadata, rules and configuration',
      properties: secretProperties,
    },
  },
}
