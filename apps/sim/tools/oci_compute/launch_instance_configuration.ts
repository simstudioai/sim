import {
  INSTANCE_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
  type OciComputeLaunchInstanceConfigurationParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeLaunchInstanceConfigurationTool: InternalToolConfig<
  OciComputeLaunchInstanceConfigurationParams,
  OciComputeResponse
> = {
  id: 'oci_compute_launch_instance_configuration',
  name: 'OCI Compute Launch instance configuration',
  description:
    'Launch an instance from a configuration with typed deferred-field overrides; may create billable resources',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_compute', credentialKind: 'service-account' },
  params: {
    oauthCredential: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Authorized OCI signing-key credential ID',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'OCI region, such as us-ashburn-1; must remain in the credential realm',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description:
        'System-injected credential identity; never used as a bearer token',
    },
    instanceConfigurationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Instance configuration OCID',
    },
    retryToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Optional 1–64 character retry token. Reuse only for the same logical creation request; otherwise Sim derives an invocation key',
    },
    instanceDetails: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Typed compute configuration: {instanceType: "compute", launchDetails: {...}, blockVolumes: [{volumeId, attachDetails: {type: "iscsi" or "paravirtualized", ...}}], secondaryVnics: [{createVnicDetails, displayName, nicIndex}]}. Deferred launch fields may be omitted. Volume creation and arbitrary provider fields are not accepted',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, [
      'instanceConfigurationId',
      'retryToken',
      'instanceDetails',
    ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    workRequestId: { type: 'string', description: 'Work request OCID when returned; use status tools', nullable: true },
    retryToken: { type: 'string', description: 'Retry token used for this creation request' },
    instance: {
      type: 'json',
      description: 'Instance information returned by OCI',
      properties: INSTANCE_OUTPUT_PROPERTIES,
    },
  },
}

