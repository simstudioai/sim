import { bundleProperties } from '@/tools/oci_secrets/outputs'
import {
  ociSecretsAuthParams,
  ociSecretsBundleSelectionParams,
  ociSecretsParams,
} from '@/tools/oci_secrets/params'
import type {
  OciSecretsGetSecretBundleByNameParams,
  OciSecretsResponse,
} from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsGetSecretBundleByNameTool: InternalToolConfig<
  OciSecretsGetSecretBundleByNameParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_get_secret_bundle_by_name',
  name: 'OCI Secrets Get Secret Bundle by Name',
  description:
    'Retrieve secret content by its name and vault OCID using secret-bundle read permission.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    secretName: ociSecretsParams.secretName,
    vaultId: ociSecretsParams.vaultId,
    ...ociSecretsBundleSelectionParams,
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
    secretBundle: {
      type: 'json',
      description: 'Secret content and version metadata',
      properties: bundleProperties,
    },
    secretValue: {
      type: 'string',
      description: 'UTF-8 secret content, returned only when decodeContent is enabled',
      optional: true,
      nullable: true,
    },
  },
}
