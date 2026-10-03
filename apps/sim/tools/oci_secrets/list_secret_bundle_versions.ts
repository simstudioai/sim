import { bundleVersionProperties } from '@/tools/oci_secrets/outputs'
import { ociSecretsAuthParams, ociSecretsParams } from '@/tools/oci_secrets/params'
import type {
  OciSecretsListSecretBundleVersionsParams,
  OciSecretsResponse,
} from '@/tools/oci_secrets/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociSecretsListSecretBundleVersionsTool: InternalToolConfig<
  OciSecretsListSecretBundleVersionsParams,
  OciSecretsResponse
> = {
  id: 'oci_secrets_list_secret_bundle_versions',
  name: 'OCI Secrets List Secret Bundle Versions',
  description: 'List retrievable secret bundle version metadata through the Secret Retrieval API.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_secrets', credentialKind: 'service-account' },
  params: {
    ...ociSecretsAuthParams,
    secretId: ociSecretsParams.secretId,
    limit: ociSecretsParams.limit,
    page: ociSecretsParams.page,
    sortOrder: ociSecretsParams.sortOrder,
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
    nextPage: {
      type: 'string',
      description: 'Opaque continuation token for the next page',
      optional: true,
      nullable: true,
    },
    secretBundleVersions: {
      type: 'array',
      description: 'Secret bundle version metadata in this page',
      items: { type: 'object', properties: bundleVersionProperties },
    },
  },
}
