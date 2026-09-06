import {
  INSTANCE_OUTPUT_PROPERTIES,
  type OciComputeLaunchInstanceConfigurationParams,
  type OciComputeResponse,
  ociComputeOperationInput,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeLaunchInstanceConfigurationTool: InternalToolConfig<
  OciComputeLaunchInstanceConfigurationParams,
  OciComputeResponse
> = {
  id: 'oci_compute_launch_instance_configuration',
  name: 'OCI Compute Launch Instance Configuration',
  description:
    'Launch an instance from a configuration with typed deferred-field overrides; may create billable resources',
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
    retryToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Optional 1–64 character retry token. Reuse only for the same logical request within Oracle’s token lifetime; otherwise Sim derives an invocation key or generates one per call',
    },
    instanceDetails: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Typed compute configuration with instanceType "compute". Optional launchDetails fields: compartmentId, availabilityDomain, displayName, shape, shapeConfig (ocpus or vcpus, memoryInGBs, nvmes up to 6, baselineOcpuUtilization), faultDomain, createVnicDetails, sourceDetails, metadata, extendedMetadata, freeformTags, definedTags, agentConfig, availabilityConfig, instanceOptions, capacityReservationId, dedicatedVmHostId. sourceDetails uses sourceType "image" with imageId or instanceSourceImageFilterDetails and bootVolumeSizeInGBs/bootVolumeVpusPerGB/kmsKeyId, or "bootVolume" with bootVolumeId. Optional blockVolumes entries accept volumeId and attachDetails (type "iscsi" with useChap, or "paravirtualized" with isPvEncryptionInTransitEnabled; both support displayName, device, isReadOnly, isShareable). Optional secondaryVnics entries accept displayName, nicIndex, createVnicDetails. Omit deferred template fields; launch overrides supply missing values. No volume creation or unknown fields',
    },
  },
  operation: {
    input: (params) =>
      ociComputeOperationInput(params, [
        'instanceConfigurationId',
        'retryToken',
        'instanceDetails',
      ]),
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP response status' },
    requestId: { type: 'string', description: 'Oracle request ID for correlation', nullable: true },
    etag: { type: 'string', description: 'Resource ETag when returned', nullable: true },
    workRequestId: {
      type: 'string',
      description: 'Work request OCID when returned; use status tools',
      nullable: true,
    },
    retryToken: { type: 'string', description: 'Retry token used for this request' },
    instance: {
      type: 'json',
      description: 'Instance information returned by OCI',
      properties: INSTANCE_OUTPUT_PROPERTIES,
    },
  },
}
