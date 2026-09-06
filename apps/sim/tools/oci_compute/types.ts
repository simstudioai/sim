import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

export const OCI_COMPUTE_SERVICE_ID = 'oci_compute' as const

export interface OciComputeCredentials {
  oauthCredential: string
  region: string
  accessToken?: string
  _context?: { executionId?: string; blockId?: string; invocationId?: string }
}

/** Delivery identity is not authority; trusted credential scope arrives separately in the handler. */
export function ociComputeOperationInput<P extends OciComputeCredentials>(
  params: P,
  fields: readonly (keyof P)[]
) {
  const context = params._context
  const input: Record<string, unknown> = {
    oauthCredential: params.oauthCredential,
    region: params.region,
  }
  for (const field of fields) {
    if (params[field] !== undefined) input[String(field)] = params[field]
  }
  return {
    ...input,
    ...(context?.executionId && context.blockId && context.invocationId
      ? {
          deliveryIdentity: {
            executionId: context.executionId,
            blockId: context.blockId,
            invocationId: context.invocationId,
          },
        }
      : {}),
  }
}

export interface OciComputeListInstancesParams extends OciComputeCredentials {
  compartmentId: string
  limit?: number
  page?: string
  sortBy?: string
  sortOrder?: string
  displayName?: string
  availabilityDomain?: string
  lifecycleState?: string
  capacityReservationId?: string
}

export interface OciComputeGetInstanceParams extends OciComputeCredentials {
  instanceId: string
}

export interface OciComputeLaunchInstanceParams extends OciComputeCredentials {
  compartmentId: string
  availabilityDomain: string
  shape: string
  sourceMode: string
  imageId?: string
  imageFilter?: unknown
  bootVolumeId?: string
  bootVolumeSizeInGBs?: number
  bootVolumeVpusPerGB?: number
  kmsKeyId?: string
  displayName?: string
  freeformTags?: unknown
  definedTags?: unknown
  retryToken?: string
  shapeConfig?: unknown
  createVnicDetails: unknown
  faultDomain?: string
  metadata?: unknown
  extendedMetadata?: unknown
  agentConfig?: unknown
  availabilityConfig?: unknown
  instanceOptions?: unknown
  capacityReservationId?: string
  dedicatedVmHostId?: string
}

export interface OciComputeUpdateInstanceParams extends OciComputeCredentials {
  retryToken?: string
  instanceId: string
  displayName?: string
  freeformTags?: unknown
  definedTags?: unknown
  ifMatch?: string
  shape?: string
  shapeConfig?: unknown
  faultDomain?: string
  metadata?: unknown
  extendedMetadata?: unknown
  agentConfig?: unknown
  availabilityConfig?: unknown
  instanceOptions?: unknown
  capacityReservationId?: string
  dedicatedVmHostId?: string
  timeMaintenanceRebootDue?: string
  updateOperationConstraint?: string
}

export interface OciComputeInstanceActionParams extends OciComputeCredentials {
  retryToken?: string
  instanceId: string
  ifMatch?: string
  action: string
  allowDenseRebootMigration?: boolean
  deleteLocalStorage?: boolean
  timeScheduled?: string
}

export interface OciComputeTerminateInstanceParams extends OciComputeCredentials {
  instanceId: string
  ifMatch?: string
  preserveBootVolume?: boolean
  preserveDataVolumesCreatedAtLaunch?: boolean
}

export interface OciComputeChangeInstanceCompartmentParams extends OciComputeCredentials {
  retryToken?: string
  instanceId: string
  ifMatch?: string
  compartmentId: string
}

export interface OciComputeGetInstanceMaintenanceRebootParams extends OciComputeCredentials {
  instanceId: string
}

export interface OciComputeListImagesParams extends OciComputeCredentials {
  compartmentId: string
  limit?: number
  page?: string
  sortBy?: string
  sortOrder?: string
  displayName?: string
  operatingSystem?: string
  operatingSystemVersion?: string
  shape?: string
  lifecycleState?: string
}

export interface OciComputeGetImageParams extends OciComputeCredentials {
  imageId: string
}

export interface OciComputeCreateImageParams extends OciComputeCredentials {
  instanceId: string
  compartmentId: string
  displayName?: string
  freeformTags?: unknown
  definedTags?: unknown
  retryToken?: string
}

export interface OciComputeUpdateImageParams extends OciComputeCredentials {
  retryToken?: string
  imageId: string
  displayName?: string
  freeformTags?: unknown
  definedTags?: unknown
  ifMatch?: string
}

export interface OciComputeDeleteImageParams extends OciComputeCredentials {
  imageId: string
  ifMatch?: string
}

export interface OciComputeChangeImageCompartmentParams extends OciComputeCredentials {
  retryToken?: string
  imageId: string
  ifMatch?: string
  compartmentId: string
}

export interface OciComputeListShapesParams extends OciComputeCredentials {
  compartmentId: string
  limit?: number
  page?: string
  availabilityDomain?: string
  imageId?: string
  shape?: string
}

export interface OciComputeListImageShapeCompatibilityEntriesParams extends OciComputeCredentials {
  imageId: string
  limit?: number
  page?: string
}

export interface OciComputeGetImageShapeCompatibilityEntryParams extends OciComputeCredentials {
  imageId: string
  shape: string
}

export interface OciComputeCreateComputeCapacityReportParams extends OciComputeCredentials {
  compartmentId: string
  availabilityDomain: string
  retryToken?: string
  shapeAvailabilities: unknown
}

export interface OciComputeListInstanceConfigurationsParams extends OciComputeCredentials {
  compartmentId: string
  limit?: number
  page?: string
  sortBy?: string
  sortOrder?: string
}

export interface OciComputeGetInstanceConfigurationParams extends OciComputeCredentials {
  instanceConfigurationId: string
}

export interface OciComputeCreateInstanceConfigurationParams extends OciComputeCredentials {
  compartmentId: string
  displayName?: string
  freeformTags?: unknown
  definedTags?: unknown
  retryToken?: string
  configurationSource: string
  instanceId?: string
  instanceDetails?: unknown
}

export interface OciComputeUpdateInstanceConfigurationParams extends OciComputeCredentials {
  retryToken?: string
  instanceConfigurationId: string
  displayName?: string
  freeformTags?: unknown
  definedTags?: unknown
  ifMatch?: string
}

export interface OciComputeDeleteInstanceConfigurationParams extends OciComputeCredentials {
  instanceConfigurationId: string
  ifMatch?: string
}

export interface OciComputeLaunchInstanceConfigurationParams extends OciComputeCredentials {
  instanceConfigurationId: string
  retryToken?: string
  instanceDetails?: unknown
}

export interface OciComputeChangeInstanceConfigurationCompartmentParams
  extends OciComputeCredentials {
  retryToken?: string
  instanceConfigurationId: string
  ifMatch?: string
  compartmentId: string
}

export interface OciComputeListInstancePoolsParams extends OciComputeCredentials {
  compartmentId: string
  limit?: number
  page?: string
  sortBy?: string
  sortOrder?: string
  displayName?: string
  lifecycleState?: string
}

export interface OciComputeGetInstancePoolParams extends OciComputeCredentials {
  instancePoolId: string
}

export interface OciComputeCreateInstancePoolParams extends OciComputeCredentials {
  instanceConfigurationId: string
  compartmentId: string
  displayName?: string
  freeformTags?: unknown
  definedTags?: unknown
  retryToken?: string
  size: number
  placementConfigurations: unknown
  instanceDisplayNameFormatter?: string
  instanceHostnameFormatter?: string
}

export interface OciComputeUpdateInstancePoolParams extends OciComputeCredentials {
  retryToken?: string
  instancePoolId: string
  displayName?: string
  freeformTags?: unknown
  definedTags?: unknown
  ifMatch?: string
  instanceConfigurationId?: string
  size?: number
  placementConfigurations?: unknown
  instanceDisplayNameFormatter?: string
  instanceHostnameFormatter?: string
}

export interface OciComputeInstancePoolActionParams extends OciComputeCredentials {
  retryToken?: string
  instancePoolId: string
  ifMatch?: string
  action: string
}

export interface OciComputeTerminateInstancePoolParams extends OciComputeCredentials {
  instancePoolId: string
  ifMatch?: string
}

export interface OciComputeChangeInstancePoolCompartmentParams extends OciComputeCredentials {
  retryToken?: string
  instancePoolId: string
  ifMatch?: string
  compartmentId: string
}

export interface OciComputeListInstancePoolInstancesParams extends OciComputeCredentials {
  instancePoolId: string
  compartmentId: string
  limit?: number
  page?: string
  sortBy?: string
  sortOrder?: string
  displayName?: string
}

export interface OciComputeGetInstancePoolInstanceParams extends OciComputeCredentials {
  instancePoolId: string
  instanceId: string
}

export interface OciComputeAttachInstancePoolInstanceParams extends OciComputeCredentials {
  retryToken?: string
  instancePoolId: string
  instanceId: string
}

export interface OciComputeDetachInstancePoolInstanceParams extends OciComputeCredentials {
  retryToken?: string
  instancePoolId: string
  instanceId: string
  isAutoTerminate?: boolean
  isDecrementSize?: boolean
}

export interface OciComputeListAvailabilityDomainsParams extends OciComputeCredentials {
  compartmentId: string
}

export interface OciComputeListFaultDomainsParams extends OciComputeCredentials {
  compartmentId: string
  availabilityDomain: string
}

export interface OciComputeListCompartmentsParams extends OciComputeCredentials {
  compartmentId: string
  limit?: number
  page?: string
  name?: string
  lifecycleState?: string
  accessLevel?: string
  compartmentIdInSubtree?: boolean
}

export interface OciComputeGetCompartmentParams extends OciComputeCredentials {
  compartmentId: string
}

export interface OciComputeListSubnetsParams extends OciComputeCredentials {
  compartmentId: string
  limit?: number
  page?: string
  sortBy?: string
  sortOrder?: string
  displayName?: string
  vcnId?: string
  lifecycleState?: string
}

export interface OciComputeGetSubnetParams extends OciComputeCredentials {
  subnetId: string
}

export interface OciComputeListVnicAttachmentsParams extends OciComputeCredentials {
  compartmentId: string
  limit?: number
  page?: string
  instanceId: string
  availabilityDomain?: string
}

export interface OciComputeGetVnicParams extends OciComputeCredentials {
  vnicId: string
}

export interface OciComputeListBootVolumeAttachmentsParams extends OciComputeCredentials {
  compartmentId: string
  limit?: number
  page?: string
  instanceId: string
  availabilityDomain: string
}

export interface OciComputeListVolumeAttachmentsParams extends OciComputeCredentials {
  compartmentId: string
  limit?: number
  page?: string
  instanceId: string
  availabilityDomain?: string
}

export interface OciComputeListWorkRequestsParams extends OciComputeCredentials {
  compartmentId: string
  limit?: number
  page?: string
  resourceId?: string
}

export interface OciComputeGetWorkRequestParams extends OciComputeCredentials {
  workRequestId: string
}

export interface OciComputeListWorkRequestErrorsParams extends OciComputeCredentials {
  workRequestId: string
  limit?: number
  page?: string
}

export interface OciComputeListWorkRequestLogsParams extends OciComputeCredentials {
  workRequestId: string
  limit?: number
  page?: string
}

export interface OciComputeInstance {
  id: string | null
  compartmentId: string | null
  displayName: string | null
  timeCreated: string | null
  freeformTags: Record<string, unknown> | null
  definedTags: Record<string, unknown> | null
  lifecycleState: string | null
  availabilityDomain: string | null
  faultDomain: string | null
  region: string | null
  shape: string | null
  capacityReservationId: string | null
  dedicatedVmHostId: string | null
  instanceConfigurationId: string | null
  timeMaintenanceRebootDue: string | null
  shapeConfig: {
    ocpus: number | null
    memoryInGBs: number | null
    vcpus: number | null
    networkingBandwidthInGbps: number | null
    maxVnicAttachments: number | null
  } | null
  sourceDetails: {
    sourceType: string | null
    imageId: string | null
    bootVolumeId: string | null
    bootVolumeSizeInGBs: number | null
  } | null
}

export const INSTANCE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  displayName: { type: 'string', description: 'display Name', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  freeformTags: { type: 'json', description: 'Resource free-form string tags', nullable: true },
  definedTags: {
    type: 'json',
    description: 'Resource defined tags grouped by namespace',
    nullable: true,
  },
  lifecycleState: {
    type: 'string',
    description: 'Current resource lifecycle state',
    nullable: true,
  },
  availabilityDomain: { type: 'string', description: 'availability Domain', nullable: true },
  faultDomain: { type: 'string', description: 'fault Domain', nullable: true },
  region: { type: 'string', description: 'region', nullable: true },
  shape: { type: 'string', description: 'shape', nullable: true },
  capacityReservationId: {
    type: 'string',
    description: 'capacity Reservation Id',
    nullable: true,
  },
  dedicatedVmHostId: { type: 'string', description: 'dedicated Vm Host Id', nullable: true },
  instanceConfigurationId: {
    type: 'string',
    description: 'instance Configuration Id',
    nullable: true,
  },
  timeMaintenanceRebootDue: {
    type: 'string',
    description: 'time Maintenance Reboot Due',
    nullable: true,
  },
  shapeConfig: {
    type: 'json',
    description: 'Allocated shape resources',
    properties: {
      ocpus: { type: 'number', description: 'Allocated OCPUs', nullable: true },
      memoryInGBs: { type: 'number', description: 'Allocated memory in GB', nullable: true },
      vcpus: { type: 'number', description: 'Allocated vCPUs', nullable: true },
      networkingBandwidthInGbps: {
        type: 'number',
        description: 'Networking bandwidth in Gbps',
        nullable: true,
      },
      maxVnicAttachments: {
        type: 'number',
        description: 'Maximum attached VNICs',
        nullable: true,
      },
    },
    nullable: true,
  },
  sourceDetails: {
    type: 'json',
    description: 'Instance launch source',
    properties: {
      sourceType: { type: 'string', description: 'image or bootVolume', nullable: true },
      imageId: { type: 'string', description: 'Source image OCID', nullable: true },
      bootVolumeId: { type: 'string', description: 'Source boot volume OCID', nullable: true },
      bootVolumeSizeInGBs: {
        type: 'number',
        description: 'Boot volume size in GB',
        nullable: true,
      },
    },
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeImage {
  id: string | null
  compartmentId: string | null
  displayName: string | null
  timeCreated: string | null
  freeformTags: Record<string, unknown> | null
  definedTags: Record<string, unknown> | null
  lifecycleState: string | null
  operatingSystem: string | null
  operatingSystemVersion: string | null
  baseImageId: string | null
  launchMode: string | null
  sizeInMBs: number | null
  billableSizeInGBs: number | null
  createImageAllowed: boolean | null
}

export const IMAGE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  displayName: { type: 'string', description: 'display Name', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  freeformTags: { type: 'json', description: 'Resource free-form string tags', nullable: true },
  definedTags: {
    type: 'json',
    description: 'Resource defined tags grouped by namespace',
    nullable: true,
  },
  lifecycleState: {
    type: 'string',
    description: 'Current resource lifecycle state',
    nullable: true,
  },
  operatingSystem: { type: 'string', description: 'operating System', nullable: true },
  operatingSystemVersion: {
    type: 'string',
    description: 'operating System Version',
    nullable: true,
  },
  baseImageId: { type: 'string', description: 'base Image Id', nullable: true },
  launchMode: { type: 'string', description: 'launch Mode', nullable: true },
  sizeInMBs: { type: 'number', description: 'Image size in MB', nullable: true },
  billableSizeInGBs: {
    type: 'number',
    description: 'Billable image storage in GB',
    nullable: true,
  },
  createImageAllowed: {
    type: 'boolean',
    description: 'Whether new images can be captured from instances using this image',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeShape {
  shape: string | null
  availabilityDomain: string | null
  processorDescription: string | null
  billingType: string | null
  ocpus: number | null
  memoryInGBs: number | null
  gpus: number | null
  localDisks: number | null
  localDisksTotalSizeInGBs: number | null
  networkingBandwidthInGbps: number | null
  maxVnicAttachments: number | null
  isFlexible: boolean | null
  isBilledForStoppedInstance: boolean | null
  ocpuOptions: {
    min: number | null
    max: number | null
  } | null
  memoryOptions: {
    minInGBs: number | null
    maxInGBs: number | null
    minPerOcpuInGBs: number | null
    maxPerOcpuInGBs: number | null
    defaultPerOcpuInGBs: number | null
  } | null
}

export const SHAPE_OUTPUT_PROPERTIES = {
  shape: { type: 'string', description: 'shape', nullable: true },
  availabilityDomain: { type: 'string', description: 'availability Domain', nullable: true },
  processorDescription: {
    type: 'string',
    description: 'processor Description',
    nullable: true,
  },
  billingType: { type: 'string', description: 'billing Type', nullable: true },
  ocpus: { type: 'number', description: 'Default OCPUs', nullable: true },
  memoryInGBs: { type: 'number', description: 'Default memory in GB', nullable: true },
  gpus: { type: 'number', description: 'GPUs', nullable: true },
  localDisks: { type: 'number', description: 'Local disks', nullable: true },
  localDisksTotalSizeInGBs: {
    type: 'number',
    description: 'Local storage in GB',
    nullable: true,
  },
  networkingBandwidthInGbps: {
    type: 'number',
    description: 'Network bandwidth in Gbps',
    nullable: true,
  },
  maxVnicAttachments: {
    type: 'number',
    description: 'Maximum VNIC attachments',
    nullable: true,
  },
  isFlexible: {
    type: 'boolean',
    description: 'Supports flexible resource sizing',
    nullable: true,
  },
  isBilledForStoppedInstance: {
    type: 'boolean',
    description: 'Compute charges continue while stopped',
    nullable: true,
  },
  ocpuOptions: {
    type: 'json',
    description: 'Flexible OCPU limits',
    properties: {
      min: { type: 'number', description: 'Minimum OCPUs', nullable: true },
      max: { type: 'number', description: 'Maximum OCPUs', nullable: true },
    },
    nullable: true,
  },
  memoryOptions: {
    type: 'json',
    description: 'Flexible memory limits',
    properties: {
      minInGBs: { type: 'number', description: 'Minimum memory', nullable: true },
      maxInGBs: { type: 'number', description: 'Maximum memory', nullable: true },
      minPerOcpuInGBs: {
        type: 'number',
        description: 'Minimum memory per OCPU',
        nullable: true,
      },
      maxPerOcpuInGBs: {
        type: 'number',
        description: 'Maximum memory per OCPU',
        nullable: true,
      },
      defaultPerOcpuInGBs: {
        type: 'number',
        description: 'Default memory per OCPU',
        nullable: true,
      },
    },
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeCompatibilityEntry {
  imageId: string | null
  shape: string | null
  memoryConstraints: {
    minInGBs: number | null
    maxInGBs: number | null
  } | null
  ocpuConstraints: {
    min: number | null
    max: number | null
  } | null
}

export const COMPATIBILITY_ENTRY_OUTPUT_PROPERTIES = {
  imageId: { type: 'string', description: 'image Id', nullable: true },
  shape: { type: 'string', description: 'shape', nullable: true },
  memoryConstraints: {
    type: 'json',
    description: 'Compatible memory range',
    properties: {
      minInGBs: { type: 'number', description: 'Minimum memory', nullable: true },
      maxInGBs: { type: 'number', description: 'Maximum memory', nullable: true },
    },
    nullable: true,
  },
  ocpuConstraints: {
    type: 'json',
    description: 'Compatible OCPU range',
    properties: {
      min: { type: 'number', description: 'Minimum OCPUs', nullable: true },
      max: { type: 'number', description: 'Maximum OCPUs', nullable: true },
    },
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeInstanceConfiguration {
  id: string | null
  compartmentId: string | null
  displayName: string | null
  timeCreated: string | null
  freeformTags: Record<string, unknown> | null
  definedTags: Record<string, unknown> | null
  deferredFields: string[]
  instanceDetails: {
    instanceType: string | null
    launchDetails: {
      compartmentId: string | null
      availabilityDomain: string | null
      displayName: string | null
      shape: string | null
      faultDomain: string | null
      capacityReservationId: string | null
      dedicatedVmHostId: string | null
      shapeConfig: {
        ocpus: number | null
        memoryInGBs: number | null
        vcpus: number | null
        nvmes: number | null
        baselineOcpuUtilization: string | null
      } | null
      sourceDetails: {
        sourceType: string | null
        imageId: string | null
        bootVolumeId: string | null
        bootVolumeSizeInGBs: number | null
      } | null
      createVnicDetails: {
        subnetId: string | null
        displayName: string | null
        hostnameLabel: string | null
        privateIp: string | null
        privateIpId: string | null
        subnetCidr: string | null
        assignPublicIp: boolean | null
        nsgIds: string[]
      } | null
    } | null
    blockVolumes: Array<{
      volumeId: string | null
      attachDetails: {
        type: string | null
        isReadOnly: boolean | null
        isShareable: boolean | null
      } | null
    }>
    secondaryVnics: Array<{
      displayName: string | null
      nicIndex: number | null
      createVnicDetails: {
        subnetId: string | null
        displayName: string | null
        hostnameLabel: string | null
        privateIp: string | null
        privateIpId: string | null
        subnetCidr: string | null
        assignPublicIp: boolean | null
        nsgIds: string[]
      } | null
    }>
  } | null
}

export const INSTANCE_CONFIGURATION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  displayName: { type: 'string', description: 'display Name', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  freeformTags: { type: 'json', description: 'Resource free-form string tags', nullable: true },
  definedTags: {
    type: 'json',
    description: 'Resource defined tags grouped by namespace',
    nullable: true,
  },
  deferredFields: {
    type: 'array',
    description: 'Fields that must be supplied at launch',
    items: { type: 'string' },
  },
  instanceDetails: {
    type: 'json',
    description: 'Selected configuration settings',
    properties: {
      instanceType: {
        type: 'string',
        description: 'Instance configuration type',
        nullable: true,
      },
      launchDetails: {
        type: 'json',
        description: 'Launch settings; omitted values can be deferred',
        properties: {
          compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
          availabilityDomain: {
            type: 'string',
            description: 'availability Domain',
            nullable: true,
          },
          displayName: { type: 'string', description: 'display Name', nullable: true },
          shape: { type: 'string', description: 'shape', nullable: true },
          faultDomain: { type: 'string', description: 'fault Domain', nullable: true },
          capacityReservationId: {
            type: 'string',
            description: 'capacity Reservation Id',
            nullable: true,
          },
          dedicatedVmHostId: {
            type: 'string',
            description: 'dedicated Vm Host Id',
            nullable: true,
          },
          shapeConfig: {
            type: 'json',
            description: 'Configured shape resources',
            properties: {
              ocpus: { type: 'number', description: 'Allocated OCPUs', nullable: true },
              memoryInGBs: {
                type: 'number',
                description: 'Allocated memory in GB',
                nullable: true,
              },
              vcpus: { type: 'number', description: 'Allocated vCPUs', nullable: true },
              nvmes: { type: 'number', description: 'Configured NVMe count', nullable: true },
              baselineOcpuUtilization: {
                type: 'string',
                description: 'Burstable OCPU baseline',
                nullable: true,
              },
            },
            nullable: true,
          },
          sourceDetails: {
            type: 'json',
            description: 'Configured launch source',
            properties: {
              sourceType: {
                type: 'string',
                description: 'image or bootVolume',
                nullable: true,
              },
              imageId: { type: 'string', description: 'Source image OCID', nullable: true },
              bootVolumeId: {
                type: 'string',
                description: 'Source boot volume OCID',
                nullable: true,
              },
              bootVolumeSizeInGBs: {
                type: 'number',
                description: 'Boot volume size in GB',
                nullable: true,
              },
            },
            nullable: true,
          },
          createVnicDetails: {
            type: 'json',
            description: 'Configured primary VNIC',
            properties: {
              subnetId: { type: 'string', description: 'subnet Id', nullable: true },
              displayName: { type: 'string', description: 'display Name', nullable: true },
              hostnameLabel: { type: 'string', description: 'hostname Label', nullable: true },
              privateIp: { type: 'string', description: 'private Ip', nullable: true },
              privateIpId: { type: 'string', description: 'private Ip Id', nullable: true },
              subnetCidr: { type: 'string', description: 'subnet Cidr', nullable: true },
              assignPublicIp: {
                type: 'boolean',
                description: 'Assign a public IP',
                nullable: true,
              },
              nsgIds: {
                type: 'array',
                description: 'Network security group OCIDs',
                items: { type: 'string' },
              },
            },
            nullable: true,
          },
        },
        nullable: true,
      },
      blockVolumes: {
        type: 'array',
        description: 'Existing data volume attachments',
        items: {
          type: 'object',
          properties: {
            volumeId: { type: 'string', description: 'Existing volume OCID', nullable: true },
            attachDetails: {
              type: 'json',
              description: 'Volume attachment settings',
              properties: {
                type: {
                  type: 'string',
                  description: 'iscsi or paravirtualized',
                  nullable: true,
                },
                isReadOnly: {
                  type: 'boolean',
                  description: 'Read-only attachment',
                  nullable: true,
                },
                isShareable: {
                  type: 'boolean',
                  description: 'Shareable attachment',
                  nullable: true,
                },
              },
              nullable: true,
            },
          },
        },
      },
      secondaryVnics: {
        type: 'array',
        description: 'Secondary VNIC configuration',
        items: {
          type: 'object',
          properties: {
            displayName: { type: 'string', description: 'VNIC display name', nullable: true },
            nicIndex: { type: 'number', description: 'Physical NIC index', nullable: true },
            createVnicDetails: {
              type: 'json',
              description: 'VNIC settings',
              properties: {
                subnetId: { type: 'string', description: 'subnet Id', nullable: true },
                displayName: { type: 'string', description: 'display Name', nullable: true },
                hostnameLabel: {
                  type: 'string',
                  description: 'hostname Label',
                  nullable: true,
                },
                privateIp: { type: 'string', description: 'private Ip', nullable: true },
                privateIpId: { type: 'string', description: 'private Ip Id', nullable: true },
                subnetCidr: { type: 'string', description: 'subnet Cidr', nullable: true },
                assignPublicIp: {
                  type: 'boolean',
                  description: 'Assign a public IP',
                  nullable: true,
                },
                nsgIds: {
                  type: 'array',
                  description: 'Network security group OCIDs',
                  items: { type: 'string' },
                },
              },
              nullable: true,
            },
          },
        },
      },
    },
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeInstanceConfigurationSummary {
  id: string | null
  compartmentId: string | null
  displayName: string | null
  timeCreated: string | null
  freeformTags: Record<string, unknown> | null
  definedTags: Record<string, unknown> | null
}

export const INSTANCE_CONFIGURATION_SUMMARY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  displayName: { type: 'string', description: 'display Name', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  freeformTags: { type: 'json', description: 'Resource free-form string tags', nullable: true },
  definedTags: {
    type: 'json',
    description: 'Resource defined tags grouped by namespace',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeInstancePool {
  id: string | null
  compartmentId: string | null
  displayName: string | null
  timeCreated: string | null
  freeformTags: Record<string, unknown> | null
  definedTags: Record<string, unknown> | null
  lifecycleState: string | null
  instanceConfigurationId: string | null
  size: number | null
  instanceDisplayNameFormatter: string | null
  instanceHostnameFormatter: string | null
  placementConfigurations: Array<{
    availabilityDomain: string | null
    faultDomains: string[]
    primarySubnetId: string | null
    primaryVnicSubnets: {
      subnetId: string | null
      isAssignIpv6Ip: boolean | null
    } | null
  }>
}

export const INSTANCE_POOL_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  displayName: { type: 'string', description: 'display Name', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  freeformTags: { type: 'json', description: 'Resource free-form string tags', nullable: true },
  definedTags: {
    type: 'json',
    description: 'Resource defined tags grouped by namespace',
    nullable: true,
  },
  lifecycleState: {
    type: 'string',
    description: 'Current resource lifecycle state',
    nullable: true,
  },
  instanceConfigurationId: {
    type: 'string',
    description: 'Configuration used for future pool instances',
    nullable: true,
  },
  size: { type: 'number', description: 'Desired pool size', nullable: true },
  instanceDisplayNameFormatter: {
    type: 'string',
    description: 'Future instance display-name formatter',
    nullable: true,
  },
  instanceHostnameFormatter: {
    type: 'string',
    description: 'Future instance hostname formatter',
    nullable: true,
  },
  placementConfigurations: {
    type: 'array',
    description: 'Pool placement configuration',
    items: {
      type: 'object',
      properties: {
        availabilityDomain: {
          type: 'string',
          description: 'Placement availability domain',
          nullable: true,
        },
        faultDomains: {
          type: 'array',
          description: 'Placement fault domains',
          items: { type: 'string' },
        },
        primarySubnetId: {
          type: 'string',
          description: 'Legacy primary subnet OCID',
          nullable: true,
        },
        primaryVnicSubnets: {
          type: 'json',
          description: 'Primary VNIC subnet placement',
          properties: {
            subnetId: { type: 'string', description: 'Subnet OCID', nullable: true },
            isAssignIpv6Ip: { type: 'boolean', description: 'Assign IPv6', nullable: true },
          },
          nullable: true,
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeInstancePoolSummary {
  id: string | null
  compartmentId: string | null
  displayName: string | null
  timeCreated: string | null
  freeformTags: Record<string, unknown> | null
  definedTags: Record<string, unknown> | null
  lifecycleState: string | null
  instanceConfigurationId: string | null
  size: number | null
  availabilityDomains: string[]
}

export const INSTANCE_POOL_SUMMARY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  displayName: { type: 'string', description: 'display Name', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  freeformTags: { type: 'json', description: 'Resource free-form string tags', nullable: true },
  definedTags: {
    type: 'json',
    description: 'Resource defined tags grouped by namespace',
    nullable: true,
  },
  lifecycleState: {
    type: 'string',
    description: 'Current resource lifecycle state',
    nullable: true,
  },
  instanceConfigurationId: {
    type: 'string',
    description: 'Configuration OCID',
    nullable: true,
  },
  size: { type: 'number', description: 'Desired pool size', nullable: true },
  availabilityDomains: { type: 'array', description: 'Pool availability domains', items: { type: 'string' } },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputePoolInstance {
  id: string | null
  compartmentId: string | null
  displayName: string | null
  timeCreated: string | null
  availabilityDomain: string | null
  faultDomain: string | null
  region: string | null
  shape: string | null
  state: string | null
  instanceConfigurationId: string | null
  instancePoolId: string | null
  lifecycleState: string | null
}

export const POOL_INSTANCE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  displayName: { type: 'string', description: 'display Name', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  availabilityDomain: { type: 'string', description: 'availability Domain', nullable: true },
  faultDomain: { type: 'string', description: 'fault Domain', nullable: true },
  region: { type: 'string', description: 'region', nullable: true },
  shape: { type: 'string', description: 'shape', nullable: true },
  state: { type: 'string', description: 'state', nullable: true },
  instanceConfigurationId: {
    type: 'string',
    description: 'instance Configuration Id',
    nullable: true,
  },
  instancePoolId: { type: 'string', description: 'Pool OCID', nullable: true },
  lifecycleState: {
    type: 'string',
    description: 'Pool membership lifecycle state',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputePoolInstanceSummary {
  id: string | null
  compartmentId: string | null
  displayName: string | null
  timeCreated: string | null
  availabilityDomain: string | null
  faultDomain: string | null
  region: string | null
  shape: string | null
  state: string | null
  instanceConfigurationId: string | null
}

export const POOL_INSTANCE_SUMMARY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  displayName: { type: 'string', description: 'display Name', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  availabilityDomain: { type: 'string', description: 'availability Domain', nullable: true },
  faultDomain: { type: 'string', description: 'fault Domain', nullable: true },
  region: { type: 'string', description: 'region', nullable: true },
  shape: { type: 'string', description: 'shape', nullable: true },
  state: { type: 'string', description: 'state', nullable: true },
  instanceConfigurationId: {
    type: 'string',
    description: 'instance Configuration Id',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeCompartment {
  id: string | null
  compartmentId: string | null
  timeCreated: string | null
  freeformTags: Record<string, unknown> | null
  definedTags: Record<string, unknown> | null
  lifecycleState: string | null
  name: string | null
  description: string | null
  isAccessible: boolean | null
}

export const COMPARTMENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  freeformTags: { type: 'json', description: 'Resource free-form string tags', nullable: true },
  definedTags: {
    type: 'json',
    description: 'Resource defined tags grouped by namespace',
    nullable: true,
  },
  lifecycleState: {
    type: 'string',
    description: 'Current resource lifecycle state',
    nullable: true,
  },
  name: { type: 'string', description: 'name', nullable: true },
  description: { type: 'string', description: 'description', nullable: true },
  isAccessible: {
    type: 'boolean',
    description: 'Whether the compartment is accessible',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeAvailabilityDomain {
  id: string | null
  compartmentId: string | null
  name: string | null
}

export const AVAILABILITY_DOMAIN_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  name: { type: 'string', description: 'name', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeFaultDomain {
  id: string | null
  compartmentId: string | null
  name: string | null
  availabilityDomain: string | null
}

export const FAULT_DOMAIN_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  name: { type: 'string', description: 'name', nullable: true },
  availabilityDomain: { type: 'string', description: 'availability Domain', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeSubnet {
  id: string | null
  compartmentId: string | null
  displayName: string | null
  timeCreated: string | null
  freeformTags: Record<string, unknown> | null
  definedTags: Record<string, unknown> | null
  lifecycleState: string | null
  availabilityDomain: string | null
  vcnId: string | null
  cidrBlock: string | null
  dnsLabel: string | null
  routeTableId: string | null
  dhcpOptionsId: string | null
  prohibitPublicIpOnVnic: boolean | null
  securityListIds: string[]
  ipv6CidrBlocks: string[]
}

export const SUBNET_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  displayName: { type: 'string', description: 'display Name', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  freeformTags: { type: 'json', description: 'Resource free-form string tags', nullable: true },
  definedTags: {
    type: 'json',
    description: 'Resource defined tags grouped by namespace',
    nullable: true,
  },
  lifecycleState: {
    type: 'string',
    description: 'Current resource lifecycle state',
    nullable: true,
  },
  availabilityDomain: { type: 'string', description: 'availability Domain', nullable: true },
  vcnId: { type: 'string', description: 'vcn Id', nullable: true },
  cidrBlock: { type: 'string', description: 'cidr Block', nullable: true },
  dnsLabel: { type: 'string', description: 'dns Label', nullable: true },
  routeTableId: { type: 'string', description: 'route Table Id', nullable: true },
  dhcpOptionsId: { type: 'string', description: 'dhcp Options Id', nullable: true },
  prohibitPublicIpOnVnic: {
    type: 'boolean',
    description: 'Public IP assignment is prohibited',
    nullable: true,
  },
  securityListIds: { type: 'array', description: 'Security list OCIDs', items: { type: 'string' } },
  ipv6CidrBlocks: { type: 'array', description: 'IPv6 CIDRs', items: { type: 'string' } },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeVnic {
  id: string | null
  compartmentId: string | null
  displayName: string | null
  timeCreated: string | null
  freeformTags: Record<string, unknown> | null
  definedTags: Record<string, unknown> | null
  lifecycleState: string | null
  availabilityDomain: string | null
  subnetId: string | null
  hostnameLabel: string | null
  privateIp: string | null
  publicIp: string | null
  macAddress: string | null
  isPrimary: boolean | null
  nsgIds: string[]
  ipv6Addresses: string[]
}

export const VNIC_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  displayName: { type: 'string', description: 'display Name', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  freeformTags: { type: 'json', description: 'Resource free-form string tags', nullable: true },
  definedTags: {
    type: 'json',
    description: 'Resource defined tags grouped by namespace',
    nullable: true,
  },
  lifecycleState: {
    type: 'string',
    description: 'Current resource lifecycle state',
    nullable: true,
  },
  availabilityDomain: { type: 'string', description: 'availability Domain', nullable: true },
  subnetId: { type: 'string', description: 'subnet Id', nullable: true },
  hostnameLabel: { type: 'string', description: 'hostname Label', nullable: true },
  privateIp: { type: 'string', description: 'private Ip', nullable: true },
  publicIp: { type: 'string', description: 'public Ip', nullable: true },
  macAddress: { type: 'string', description: 'mac Address', nullable: true },
  isPrimary: { type: 'boolean', description: 'Primary VNIC', nullable: true },
  nsgIds: {
    type: 'array',
    description: 'Network security group OCIDs',
    items: { type: 'string' },
  },
  ipv6Addresses: { type: 'array', description: 'Assigned IPv6 addresses', items: { type: 'string' } },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeVnicAttachment {
  id: string | null
  compartmentId: string | null
  displayName: string | null
  timeCreated: string | null
  availabilityDomain: string | null
  instanceId: string | null
  lifecycleState: string | null
  subnetId: string | null
  vnicId: string | null
  nicIndex: number | null
}

export const VNIC_ATTACHMENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  displayName: { type: 'string', description: 'display Name', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  availabilityDomain: { type: 'string', description: 'availability Domain', nullable: true },
  instanceId: { type: 'string', description: 'instance Id', nullable: true },
  lifecycleState: { type: 'string', description: 'lifecycle State', nullable: true },
  subnetId: { type: 'string', description: 'subnet Id', nullable: true },
  vnicId: { type: 'string', description: 'vnic Id', nullable: true },
  nicIndex: { type: 'number', description: 'Physical NIC index', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeBootVolumeAttachment {
  id: string | null
  compartmentId: string | null
  displayName: string | null
  timeCreated: string | null
  availabilityDomain: string | null
  instanceId: string | null
  lifecycleState: string | null
  bootVolumeId: string | null
  isPvEncryptionInTransitEnabled: boolean | null
}

export const BOOT_VOLUME_ATTACHMENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  displayName: { type: 'string', description: 'display Name', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  availabilityDomain: { type: 'string', description: 'availability Domain', nullable: true },
  instanceId: { type: 'string', description: 'instance Id', nullable: true },
  lifecycleState: { type: 'string', description: 'lifecycle State', nullable: true },
  bootVolumeId: { type: 'string', description: 'boot Volume Id', nullable: true },
  isPvEncryptionInTransitEnabled: {
    type: 'boolean',
    description: 'Encryption in transit is enabled',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeVolumeAttachment {
  id: string | null
  compartmentId: string | null
  displayName: string | null
  timeCreated: string | null
  availabilityDomain: string | null
  instanceId: string | null
  lifecycleState: string | null
  volumeId: string | null
  attachmentType: string | null
  device: string | null
  isReadOnly: boolean | null
  isShareable: boolean | null
  isVolumeCreatedDuringLaunch: boolean | null
}

export const VOLUME_ATTACHMENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  displayName: { type: 'string', description: 'display Name', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  availabilityDomain: { type: 'string', description: 'availability Domain', nullable: true },
  instanceId: { type: 'string', description: 'instance Id', nullable: true },
  lifecycleState: { type: 'string', description: 'lifecycle State', nullable: true },
  volumeId: { type: 'string', description: 'volume Id', nullable: true },
  attachmentType: { type: 'string', description: 'attachment Type', nullable: true },
  device: { type: 'string', description: 'device', nullable: true },
  isReadOnly: { type: 'boolean', description: 'Read-only attachment', nullable: true },
  isShareable: { type: 'boolean', description: 'Shareable attachment', nullable: true },
  isVolumeCreatedDuringLaunch: {
    type: 'boolean',
    description: 'Volume was created during launch',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeWorkRequest {
  id: string | null
  compartmentId: string | null
  operationType: string | null
  status: string | null
  timeAccepted: string | null
  timeStarted: string | null
  timeFinished: string | null
  percentComplete: number | null
  resources: Array<{
    actionType: string | null
    entityType: string | null
    identifier: string | null
    entityUri: string | null
  }>
}

export const WORK_REQUEST_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'id', nullable: true },
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  operationType: { type: 'string', description: 'operation Type', nullable: true },
  status: { type: 'string', description: 'status', nullable: true },
  timeAccepted: { type: 'string', description: 'time Accepted', nullable: true },
  timeStarted: { type: 'string', description: 'time Started', nullable: true },
  timeFinished: { type: 'string', description: 'time Finished', nullable: true },
  percentComplete: {
    type: 'number',
    description: 'Operation progress percentage',
    nullable: true,
  },
  resources: {
    type: 'array',
    description: 'Resources affected by the operation',
    items: {
      type: 'object',
      properties: {
        actionType: { type: 'string', description: 'action Type', nullable: true },
        entityType: { type: 'string', description: 'entity Type', nullable: true },
        identifier: { type: 'string', description: 'identifier', nullable: true },
        entityUri: { type: 'string', description: 'entity Uri', nullable: true },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeWorkRequestError {
  code: string | null
  message: string | null
  timestamp: string | null
}

export type OciComputeWorkRequestSummary = Omit<OciComputeWorkRequest, 'resources'>

export const WORK_REQUEST_SUMMARY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Work request OCID', nullable: true },
  compartmentId: { type: 'string', description: 'Compartment OCID', nullable: true },
  operationType: { type: 'string', description: 'Operation type', nullable: true },
  status: { type: 'string', description: 'Current work request status', nullable: true },
  timeAccepted: { type: 'string', description: 'Acceptance time', nullable: true },
  timeStarted: { type: 'string', description: 'Start time', nullable: true },
  timeFinished: { type: 'string', description: 'Completion time', nullable: true },
  percentComplete: { type: 'number', description: 'Progress percentage', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export const WORK_REQUEST_ERROR_OUTPUT_PROPERTIES = {
  code: { type: 'string', description: 'code', nullable: true },
  message: { type: 'string', description: 'message', nullable: true },
  timestamp: { type: 'string', description: 'timestamp', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeWorkRequestLog {
  message: string | null
  timestamp: string | null
}

export const WORK_REQUEST_LOG_OUTPUT_PROPERTIES = {
  message: { type: 'string', description: 'message', nullable: true },
  timestamp: { type: 'string', description: 'timestamp', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeMaintenanceReboot {
  timeMaintenanceRebootDueMax: string | null
}

export const MAINTENANCE_REBOOT_OUTPUT_PROPERTIES = {
  timeMaintenanceRebootDueMax: {
    type: 'string',
    description: 'Latest permitted maintenance reboot timestamp',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeCapacityReport {
  compartmentId: string | null
  availabilityDomain: string | null
  timeCreated: string | null
  shapeAvailabilities: Array<{
    instanceShape: string | null
    faultDomain: string | null
    availabilityStatus: string | null
    availableCount: number | null
    instanceShapeConfig: {
      ocpus: number | null
      memoryInGBs: number | null
    } | null
  }>
}

export const CAPACITY_REPORT_OUTPUT_PROPERTIES = {
  compartmentId: { type: 'string', description: 'compartment Id', nullable: true },
  availabilityDomain: { type: 'string', description: 'availability Domain', nullable: true },
  timeCreated: { type: 'string', description: 'time Created', nullable: true },
  shapeAvailabilities: {
    type: 'array',
    description: 'Capacity snapshot; does not reserve resources',
    items: {
      type: 'object',
      properties: {
        instanceShape: { type: 'string', description: 'instance Shape', nullable: true },
        faultDomain: { type: 'string', description: 'fault Domain', nullable: true },
        availabilityStatus: {
          type: 'string',
          description: 'availability Status',
          nullable: true,
        },
        availableCount: {
          type: 'number',
          description: 'Available instance count',
          nullable: true,
        },
        instanceShapeConfig: {
          type: 'json',
          description: 'Requested shape resources',
          properties: {
            ocpus: { type: 'number', description: 'OCPUs', nullable: true },
            memoryInGBs: { type: 'number', description: 'Memory in GB', nullable: true },
          },
          nullable: true,
        },
      },
    },
  },
} as const satisfies Record<string, ToolOutputProperty>

export interface OciComputeResponse extends ToolResponse {
  output: {
    status: number
    requestId: string | null
    etag?: string | null
    nextPage?: string | null
    workRequestId?: string | null
    retryToken?: string
    location?: string | null
    outcome?: 'rejected' | 'unknown'
    instances?: OciComputeInstance[]
    images?: OciComputeImage[]
    shapes?: OciComputeShape[]
    compatibilityEntries?: OciComputeCompatibilityEntry[]
    instanceConfigurations?: OciComputeInstanceConfigurationSummary[]
    instancePools?: OciComputeInstancePoolSummary[]
    poolInstances?: OciComputePoolInstanceSummary[]
    compartments?: OciComputeCompartment[]
    availabilityDomains?: OciComputeAvailabilityDomain[]
    faultDomains?: OciComputeFaultDomain[]
    subnets?: OciComputeSubnet[]
    vnicAttachments?: OciComputeVnicAttachment[]
    bootVolumeAttachments?: OciComputeBootVolumeAttachment[]
    volumeAttachments?: OciComputeVolumeAttachment[]
    workRequests?: OciComputeWorkRequestSummary[]
    workRequestErrors?: OciComputeWorkRequestError[]
    workRequestLogs?: OciComputeWorkRequestLog[]
    instance?: OciComputeInstance
    image?: OciComputeImage
    shape?: OciComputeShape
    compatibilityEntry?: OciComputeCompatibilityEntry
    instanceConfiguration?: OciComputeInstanceConfiguration
    instancePool?: OciComputeInstancePool
    poolInstance?: OciComputePoolInstance
    compartment?: OciComputeCompartment
    availabilityDomain?: OciComputeAvailabilityDomain
    faultDomain?: OciComputeFaultDomain
    subnet?: OciComputeSubnet
    vnic?: OciComputeVnic
    vnicAttachment?: OciComputeVnicAttachment
    bootVolumeAttachment?: OciComputeBootVolumeAttachment
    volumeAttachment?: OciComputeVolumeAttachment
    workRequest?: OciComputeWorkRequest
    workRequestError?: OciComputeWorkRequestError
    workRequestLog?: OciComputeWorkRequestLog
    maintenanceReboot?: OciComputeMaintenanceReboot
    capacityReport?: OciComputeCapacityReport
  }
}
