import {
  INSTANCE_POOL_OUTPUT_PROPERTIES,
  type OciComputeCreateInstancePoolParams,
  type OciComputeResponse,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeCreateInstancePoolTool: InternalToolConfig<
  OciComputeCreateInstancePoolParams,
  OciComputeResponse
> = {
  id: 'oci_compute_create_instance_pool',
  name: 'OCI Compute Create Instance Pool',
  description:
    'Create a pool from an instance configuration and placement settings; provisions billable instances',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci_compute', credentialKind: 'service-account' },
  params: {
    oauthCredential: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Authorized OCI signing-key credential ID',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OCI region, such as us-ashburn-1; must remain in the credential realm',
    },
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'System-injected credential identity; never used as a bearer token',
    },
    instanceConfigurationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Instance configuration OCID',
    },
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compartment OCID; use the destination for moves, parent for compartment listing, and root for capacity reports',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name; on list operations this is an exact provider filter',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Free-form tags as a string-to-string JSON map',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Defined string tags grouped by namespace, for example {Operations: {CostCenter: "42"}}',
    },
    retryToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Optional 1–64 character retry token. Reuse only for the same logical request within Oracle’s token lifetime; otherwise Sim derives an invocation key or generates one per call',
    },
    size: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Desired pool size; increasing creates billable resources and decreasing terminates members',
    },
    placementConfigurations: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Placements [{availabilityDomain, faultDomains, primaryVnicSubnets: {subnetId, isAssignIpv6Ip, ipv6AddressIpv6SubnetCidrPairDetails}, secondaryVnicSubnets: [{subnetId, displayName, ...}]}]; one placement per AD',
    },
    instanceDisplayNameFormatter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Display-name formatter for future pool instances; empty string clears it on update',
    },
    instanceHostnameFormatter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Hostname formatter for future pool instances; empty string clears it on update',
    },
  },
  operation: {
    input: (params) =>
      ociComputeOperationInput(params, [
        'instanceConfigurationId',
        'compartmentId',
        'displayName',
        'freeformTags',
        'definedTags',
        'retryToken',
        'size',
        'placementConfigurations',
        'instanceDisplayNameFormatter',
        'instanceHostnameFormatter',
      ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    retryToken: { type: 'string', description: 'Retry token used for this request' },
    instancePool: {
      type: 'json',
      description: 'Instance Pool information returned by OCI',
      properties: INSTANCE_POOL_OUTPUT_PROPERTIES,
    },
  },
}
