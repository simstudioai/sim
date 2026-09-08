import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsDeleteDeployEnvironmentParams,
  OciDevopsResponse,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsDeleteDeployEnvironmentTool: InternalToolConfig<
  OciDevopsDeleteDeployEnvironmentParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_delete_deploy_environment',
  name: 'OCI DevOps Delete Deploy Environment',
  description: 'Delete Deploy Environment in OCI DevOps',
  version: '1.0.0',
  params: {
    oauthCredential: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OCI API-key service-account credential ID',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OCI region; defaults to the credential region',
    },
    deployEnvironmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique environment identifier.',
    },
    ifMatch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ETag from a preceding read. Mismatches fail without overwriting concurrent changes.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      deployEnvironmentId: params.deployEnvironmentId,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
