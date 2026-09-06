import {
  INSTANCE_OUTPUT_PROPERTIES,
  ociComputeOperationInput,
  type OciComputeLaunchInstanceParams,
  type OciComputeResponse,
} from '@/tools/oci_compute/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociComputeLaunchInstanceTool: InternalToolConfig<
  OciComputeLaunchInstanceParams,
  OciComputeResponse
> = {
  id: 'oci_compute_launch_instance',
  name: 'OCI Compute Launch instance',
  description:
    'Launch a billable Compute instance from an image or existing boot volume and return its provisioning state',
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
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compartment OCID; use the destination for moves, parent for compartment listing, and root for capacity reports',
    },
    availabilityDomain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Exact availability-domain name returned by OCI discovery',
    },
    shape: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Compute shape name; image, capacity, and shape compatibility are validated by OCI',
    },
    sourceMode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Launch from image ID (image), image filter (imageFilter), or existing boot volume (bootVolume)',
    },
    imageId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Image OCID; required for image-ID launches',
    },
    imageFilter: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Image selection criteria: compartmentId, operatingSystem, operatingSystemVersion, definedTagsFilter',
    },
    bootVolumeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Existing boot volume OCID in the instance availability domain; only for bootVolume launches',
    },
    bootVolumeSizeInGBs: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Image-source boot volume size in GB, 50–32768; increases storage charges',
    },
    bootVolumeVpusPerGB: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Image-source boot volume performance: 10, 20, or 30–120 VPUs/GB; affects charges',
    },
    kmsKeyId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Existing Vault key OCID for a newly created image-source boot volume',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Display name; on list operations this is an exact provider filter',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Free-form tags as a string-to-string JSON map',
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
        'Optional 1–64 character retry token. Reuse only for the same logical creation request; otherwise Sim derives an invocation key',
    },
    shapeConfig: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Shape resources: ocpus OR vcpus, memoryInGBs, baselineOcpuUtilization, nvmes; use List Shapes for valid ranges',
    },
    createVnicDetails: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Primary VNIC settings: subnetId (required), displayName, assignPublicIp, assignPrivateDnsRecord, hostnameLabel, privateIp/privateIpId/subnetCidr, nsgIds, skipSourceDestCheck, assignIpv6Ip, ipv6AddressIpv6SubnetCidrPairDetails',
    },
    faultDomain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Fault domain within the selected availability domain',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'String-to-string metadata map; user_data is base64 and ssh_authorized_keys contains SSH public keys. Updates replace the map and must retain immutable launch keys unchanged',
    },
    extendedMetadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Nested metadata map; combined with metadata, at most 32000 bytes. Updates must preserve immutable launch keys',
    },
    agentConfig: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Oracle Cloud Agent settings: isMonitoringDisabled, isManagementDisabled, areAllPluginsDisabled, pluginsConfig [{name, desiredState: ENABLED or DISABLED}]',
    },
    availabilityConfig: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Availability settings: recoveryAction (RESTORE_INSTANCE or STOP_INSTANCE), isLiveMigrationPreferred',
    },
    instanceOptions: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Instance options: areLegacyImdsEndpointsDisabled',
    },
    capacityReservationId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Existing reservation OCID; an empty string opts out on direct launch or removes the reservation on update',
    },
    dedicatedVmHostId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Existing dedicated VM host OCID; placement restrictions and capacity are enforced by OCI',
    },
  },
  operation: {
    input: (params) => ociComputeOperationInput(params, [
      'compartmentId',
      'availabilityDomain',
      'shape',
      'sourceMode',
      'imageId',
      'imageFilter',
      'bootVolumeId',
      'bootVolumeSizeInGBs',
      'bootVolumeVpusPerGB',
      'kmsKeyId',
      'displayName',
      'freeformTags',
      'definedTags',
      'retryToken',
      'shapeConfig',
      'createVnicDetails',
      'faultDomain',
      'metadata',
      'extendedMetadata',
      'agentConfig',
      'availabilityConfig',
      'instanceOptions',
      'capacityReservationId',
      'dedicatedVmHostId',
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

