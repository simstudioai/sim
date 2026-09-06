import { z } from 'zod'
import { OCI_REGION_IDS } from '@/lib/internal/oci/endpoints'

const id = z.string().trim().min(1).max(255)
const name = z.string().trim().min(1).max(255)
const tags = z.record(z.string().max(255), z.string().max(256))
const definedTags = z.record(z.string().max(255), tags)
const metadata = z.record(z.string().max(255), z.string().max(32_000))
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ])
)

/** JSON editors and agent calls share the same strict, named object schemas. */
function json<S extends z.ZodTypeAny>(schema: S) {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }, schema)
}

const shapeConfig = z
  .object({
    ocpus: z.number().positive().optional(),
    vcpus: z.number().int().positive().multipleOf(2).optional(),
    memoryInGBs: z.number().positive().optional(),
    baselineOcpuUtilization: z.enum(['BASELINE_1_8', 'BASELINE_1_2', 'BASELINE_1_1']).optional(),
    nvmes: z.number().int().min(1).max(7).optional(),
  })
  .strict()
  .refine((value) => value.ocpus === undefined || value.vcpus === undefined, {
    message: 'Specify ocpus or vcpus, not both',
  })

const ipv6Pair = z
  .object({
    ipv6Address: z.string().max(46).optional(),
    ipv6SubnetCidr: z.string().max(64).optional(),
  })
  .strict()
const vnic = z
  .object({
    subnetId: id.optional(),
    displayName: name.optional(),
    assignPublicIp: z.boolean().optional(),
    assignPrivateDnsRecord: z.boolean().optional(),
    hostnameLabel: z.string().min(1).max(63).optional(),
    privateIp: z.string().max(46).optional(),
    privateIpId: id.optional(),
    subnetCidr: z.string().max(18).optional(),
    nsgIds: z.array(id).max(5).optional(),
    skipSourceDestCheck: z.boolean().optional(),
    assignIpv6Ip: z.boolean().optional(),
    ipv6AddressIpv6SubnetCidrPairDetails: z.array(ipv6Pair).max(16).optional(),
  })
  .strict()

const imageFilter = z
  .object({
    compartmentId: id,
    operatingSystem: name.optional(),
    operatingSystemVersion: name.optional(),
    definedTagsFilter: definedTags.optional(),
  })
  .strict()
const imageSourceFields = {
  imageId: id.optional(),
  instanceSourceImageFilterDetails: imageFilter.optional(),
  bootVolumeSizeInGBs: z.number().int().min(50).max(32768).optional(),
  bootVolumeVpusPerGB: z
    .number()
    .int()
    .refine(
      (n) => n === 10 || n === 20 || (n >= 30 && n <= 120),
      'Unsupported boot volume performance'
    )
    .optional(),
  kmsKeyId: id.optional(),
}
const configurationSource = z
  .discriminatedUnion('sourceType', [
    z
      .object({
        sourceType: z.literal('image'),
        ...imageSourceFields,
        instanceSourceImageFilterDetails: imageFilter.partial().optional(),
      })
      .strict(),
    z.object({ sourceType: z.literal('bootVolume'), bootVolumeId: id.optional() }).strict(),
  ])
  .refine(
    (source) =>
      source.sourceType !== 'image' || !source.imageId || !source.instanceSourceImageFilterDetails,
    {
      message: 'Specify an image ID or image filter, not both',
    }
  )

const agentConfig = z
  .object({
    isMonitoringDisabled: z.boolean().optional(),
    isManagementDisabled: z.boolean().optional(),
    areAllPluginsDisabled: z.boolean().optional(),
    pluginsConfig: z
      .array(z.object({ name, desiredState: z.enum(['ENABLED', 'DISABLED']) }).strict())
      .max(50)
      .optional(),
  })
  .strict()
const availabilityConfig = z
  .object({
    recoveryAction: z.enum(['RESTORE_INSTANCE', 'STOP_INSTANCE']).optional(),
    isLiveMigrationPreferred: z.boolean().optional(),
  })
  .strict()
const instanceOptions = z
  .object({ areLegacyImdsEndpointsDisabled: z.boolean().optional() })
  .strict()

const launchFields = {
  compartmentId: id.optional(),
  availabilityDomain: name.optional(),
  displayName: name.optional(),
  shape: name.optional(),
  shapeConfig: shapeConfig
    .refine(
      (value) => value.nvmes === undefined || value.nvmes <= 6,
      'Configuration NVMe count must not exceed 6'
    )
    .optional(),
  faultDomain: name.optional(),
  createVnicDetails: vnic.optional(),
  sourceDetails: configurationSource.optional(),
  metadata: metadata.optional(),
  extendedMetadata: z.record(z.string(), jsonValue).optional(),
  freeformTags: tags.optional(),
  definedTags: definedTags.optional(),
  agentConfig: agentConfig.optional(),
  availabilityConfig: availabilityConfig.optional(),
  instanceOptions: instanceOptions.optional(),
  capacityReservationId: id.optional(),
  dedicatedVmHostId: id.optional(),
}
const attachmentFields = {
  displayName: name.optional(),
  device: z.string().min(3).max(100).optional(),
  isReadOnly: z.boolean().optional(),
  isShareable: z.boolean().optional(),
}
const attachVolume = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('iscsi'), ...attachmentFields, useChap: z.boolean().optional() })
    .strict(),
  z
    .object({
      type: z.literal('paravirtualized'),
      ...attachmentFields,
      isPvEncryptionInTransitEnabled: z.boolean().optional(),
    })
    .strict(),
])
export const configurationDetailsSchema = z
  .object({
    instanceType: z.literal('compute'),
    launchDetails: z.object(launchFields).strict().optional(),
    blockVolumes: z
      .array(z.object({ volumeId: id.optional(), attachDetails: attachVolume.optional() }).strict())
      .max(32)
      .optional(),
    secondaryVnics: z
      .array(
        z
          .object({
            displayName: name.optional(),
            nicIndex: z.number().int().min(0).max(31).optional(),
            createVnicDetails: vnic.optional(),
          })
          .strict()
      )
      .max(32)
      .optional(),
  })
  .strict()

const placementSubnet = z
  .object({
    subnetId: id,
    isAssignIpv6Ip: z.boolean().optional(),
    ipv6AddressIpv6SubnetCidrPairDetails: z
      .array(
        z
          .object({
            ipv6SubnetCidr: z.string().max(64).optional(),
          })
          .strict()
      )
      .max(16)
      .optional(),
  })
  .strict()
const placement = z
  .object({
    availabilityDomain: name,
    faultDomains: z
      .array(name)
      .max(3)
      .refine((values) => new Set(values).size === values.length, 'Fault domains must be unique')
      .optional(),
    primaryVnicSubnets: placementSubnet,
    secondaryVnicSubnets: z
      .array(placementSubnet.extend({ displayName: name }))
      .max(32)
      .optional(),
  })
  .strict()

const common = z.object({
  oauthCredential: id,
  region: name.refine((region) => OCI_REGION_IDS.includes(region), 'Unrecognized OCI region'),
  deliveryIdentity: z.object({ executionId: name, blockId: name, invocationId: name }).strict().optional(),
}).strict()
const paging = { limit: z.number().int().min(1).max(100).default(50), page: z.string().min(1).max(4096).optional() }
const sorting = { sortBy: z.enum(['TIMECREATED', 'DISPLAYNAME']).optional(), sortOrder: z.enum(['ASC', 'DESC']).optional() }
const listing = { compartmentId: id, ...paging }
const namedListing = { ...listing, ...sorting, displayName: name.optional() }
const match = { ifMatch: z.string().min(1).max(1024).optional() }
const token = { retryToken: z.string().min(1).max(64).regex(/^[\x21-\x7e]+$/, 'Retry token must use printable ASCII').optional() }
const resourceTags = { displayName: name.optional(), freeformTags: json(tags).optional(), definedTags: json(definedTags).optional() }
const instance = { instanceId: id }
const image = { imageId: id }
const configuration = { instanceConfigurationId: id }
const pool = { instancePoolId: id }
const workRequest = { workRequestId: id }
const source = {
  sourceMode: z.enum(['image', 'imageFilter', 'bootVolume']),
  imageId: id.optional(),
  imageFilter: json(imageFilter).optional(),
  bootVolumeId: id.optional(),
  bootVolumeSizeInGBs: imageSourceFields.bootVolumeSizeInGBs,
  bootVolumeVpusPerGB: imageSourceFields.bootVolumeVpusPerGB,
  kmsKeyId: id.optional(),
}

/** Only documented fields belonging to the selected operation are accepted. */
export const ociComputeSchemas = {
  list_instances: common.extend({ ...namedListing, availabilityDomain: name.optional(), lifecycleState: name.optional(), capacityReservationId: id.optional() }),
  get_instance: common.extend(instance),
  launch_instance: common.extend({
    compartmentId: id, availabilityDomain: name, shape: name, ...source, ...resourceTags, ...token,
    shapeConfig: json(shapeConfig).optional(), createVnicDetails: json(vnic.extend({ subnetId: id })),
    faultDomain: name.optional(), metadata: json(metadata).optional(), extendedMetadata: json(z.record(z.string(), jsonValue)).optional(),
    agentConfig: json(agentConfig).optional(), availabilityConfig: json(availabilityConfig).optional(), instanceOptions: json(instanceOptions).optional(),
    capacityReservationId: z.string().trim().max(255).optional(), dedicatedVmHostId: id.optional(),
  }).superRefine((value, context) => {
    const sourceKey = value.sourceMode === 'image' ? 'imageId' : value.sourceMode === 'imageFilter' ? 'imageFilter' : 'bootVolumeId'
    if (!value[sourceKey]) context.addIssue({ code: 'custom', path: [sourceKey], message: `${sourceKey} is required for this launch source` })
    for (const key of ['imageId', 'imageFilter', 'bootVolumeId'] as const) {
      if (key !== sourceKey && value[key] !== undefined) context.addIssue({ code: 'custom', path: [key], message: `${key} does not belong to this launch source` })
    }
    if (value.sourceMode === 'bootVolume' && [value.bootVolumeSizeInGBs, value.bootVolumeVpusPerGB, value.kmsKeyId].some((v) => v !== undefined)) {
      context.addIssue({ code: 'custom', path: ['sourceMode'], message: 'Boot-volume sources cannot use image boot-volume creation options' })
    }
    if (value.capacityReservationId && value.dedicatedVmHostId) context.addIssue({ code: 'custom', path: ['capacityReservationId'], message: 'Choose capacity reservation or dedicated host placement' })
  }),
  update_instance: common.extend({ ...token,
    ...instance, ...resourceTags, ...match,
    shape: name.optional(), shapeConfig: json(shapeConfig).optional(), faultDomain: name.optional(),
    metadata: json(metadata).optional(), extendedMetadata: json(z.record(z.string(), jsonValue)).optional(),
    agentConfig: json(agentConfig).optional(), availabilityConfig: json(availabilityConfig).optional(), instanceOptions: json(instanceOptions).optional(),
    capacityReservationId: z.string().trim().max(255).optional(), dedicatedVmHostId: id.optional(),
    timeMaintenanceRebootDue: z.string().datetime({ offset: true }).optional(),
    updateOperationConstraint: z.enum(['ALLOW_DOWNTIME', 'AVOID_DOWNTIME']).default('AVOID_DOWNTIME'),
  }),
  instance_action: common.extend({ ...token,
    ...instance, ...match, action: z.enum(['START', 'STOP', 'SOFTSTOP', 'RESET', 'SOFTRESET', 'REBOOTMIGRATE']),
    allowDenseRebootMigration: z.boolean().optional(), deleteLocalStorage: z.boolean().optional(), timeScheduled: z.string().datetime({ offset: true }).optional(),
  }).superRefine((value, context) => {
    if (value.allowDenseRebootMigration !== undefined && !['RESET', 'SOFTRESET'].includes(value.action)) context.addIssue({ code: 'custom', path: ['allowDenseRebootMigration'], message: 'Dense reboot migration is only supported for RESET and SOFTRESET' })
    if ((value.deleteLocalStorage !== undefined || value.timeScheduled !== undefined) && value.action !== 'REBOOTMIGRATE') context.addIssue({ code: 'custom', path: ['action'], message: 'Local-storage deletion and scheduling require REBOOTMIGRATE' })
  }),
  terminate_instance: common.extend({ ...instance, ...match, preserveBootVolume: z.boolean().default(true), preserveDataVolumesCreatedAtLaunch: z.boolean().default(true) }),
  change_instance_compartment: common.extend({ ...token, ...instance, ...match, compartmentId: id }),
  get_instance_maintenance_reboot: common.extend(instance),
  list_images: common.extend({ ...namedListing, operatingSystem: name.optional(), operatingSystemVersion: name.optional(), shape: name.optional(), lifecycleState: name.optional() }),
  get_image: common.extend(image),
  create_image: common.extend({ ...instance, compartmentId: id, ...resourceTags, ...token }),
  update_image: common.extend({ ...token, ...image, ...resourceTags, ...match }),
  delete_image: common.extend({ ...image, ...match }),
  change_image_compartment: common.extend({ ...token, ...image, ...match, compartmentId: id }),
  list_shapes: common.extend({ ...listing, availabilityDomain: name.optional(), imageId: id.optional(), shape: name.optional() }),
  list_image_shape_compatibility_entries: common.extend({ ...image, ...paging }),
  get_image_shape_compatibility_entry: common.extend({ ...image, shape: name }),
  create_compute_capacity_report: common.extend({ compartmentId: id, availabilityDomain: name, ...token, shapeAvailabilities: json(z.array(z.object({ instanceShape: name, instanceShapeConfig: z.object({ ocpus: z.number().positive().optional(), memoryInGBs: z.number().positive().optional() }).strict().optional(), faultDomain: name.optional() }).strict()).min(1).max(100)) }),
  list_instance_configurations: common.extend({ ...listing, ...sorting }),
  get_instance_configuration: common.extend(configuration),
  create_instance_configuration: common.extend({ compartmentId: id, ...resourceTags, ...token, configurationSource: z.enum(['NONE', 'INSTANCE']), instanceId: id.optional(), instanceDetails: json(configurationDetailsSchema).optional() }).superRefine((value, context) => {
    if (value.configurationSource === 'INSTANCE' ? !value.instanceId || value.instanceDetails !== undefined : !value.instanceDetails || value.instanceId !== undefined) context.addIssue({ code: 'custom', path: ['configurationSource'], message: 'INSTANCE requires only instanceId; NONE requires only instanceDetails' })
  }),
  update_instance_configuration: common.extend({ ...token, ...configuration, ...resourceTags, ...match }),
  delete_instance_configuration: common.extend({ ...configuration, ...match }),
  launch_instance_configuration: common.extend({ ...configuration, ...token, instanceDetails: json(configurationDetailsSchema).default({ instanceType: 'compute' }) }),
  change_instance_configuration_compartment: common.extend({ ...token, ...configuration, ...match, compartmentId: id }),
  list_instance_pools: common.extend({ ...namedListing, lifecycleState: name.optional() }),
  get_instance_pool: common.extend(pool),
  create_instance_pool: common.extend({ ...configuration, compartmentId: id, ...resourceTags, ...token, size: z.number().int().min(0), placementConfigurations: json(z.array(placement).min(1).max(20)), instanceDisplayNameFormatter: name.optional(), instanceHostnameFormatter: name.optional() }),
  update_instance_pool: common.extend({ ...token, ...pool, ...resourceTags, ...match, instanceConfigurationId: id.optional(), size: z.number().int().min(0).optional(), placementConfigurations: json(z.array(placement).min(1).max(20)).optional(), instanceDisplayNameFormatter: z.string().max(255).optional(), instanceHostnameFormatter: z.string().max(255).optional() }),
  instance_pool_action: common.extend({ ...token, ...pool, ...match, action: z.enum(['START', 'STOP', 'SOFTSTOP', 'RESET', 'SOFTRESET']) }),
  terminate_instance_pool: common.extend({ ...pool, ...match }),
  change_instance_pool_compartment: common.extend({ ...token, ...pool, ...match, compartmentId: id }),
  list_instance_pool_instances: common.extend({ ...pool, ...namedListing }),
  get_instance_pool_instance: common.extend({ ...pool, ...instance }),
  attach_instance_pool_instance: common.extend({ ...token, ...pool, ...instance }),
  detach_instance_pool_instance: common.extend({ ...token, ...pool, ...instance, isAutoTerminate: z.boolean().default(false), isDecrementSize: z.boolean().default(true) }),
  list_availability_domains: common.extend({ compartmentId: id }),
  list_fault_domains: common.extend({ compartmentId: id, availabilityDomain: name }),
  list_compartments: common.extend({ ...paging, compartmentId: id, name: name.optional(), lifecycleState: z.enum(['ACTIVE', 'DELETED']).optional(), accessLevel: z.enum(['ACCESSIBLE', 'ANY']).default('ACCESSIBLE'), compartmentIdInSubtree: z.boolean().default(false) }),
  get_compartment: common.extend({ compartmentId: id }),
  list_subnets: common.extend({ ...namedListing, vcnId: id.optional(), lifecycleState: name.optional() }),
  get_subnet: common.extend({ subnetId: id }),
  list_vnic_attachments: common.extend({ ...listing, ...instance, availabilityDomain: name.optional() }),
  get_vnic: common.extend({ vnicId: id }),
  list_boot_volume_attachments: common.extend({ ...listing, ...instance, availabilityDomain: name }),
  list_volume_attachments: common.extend({ ...listing, ...instance, availabilityDomain: name.optional() }),
  list_work_requests: common.extend({ ...listing, resourceId: id.optional() }),
  get_work_request: common.extend(workRequest),
  list_work_request_errors: common.extend({ ...workRequest, ...paging }),
  list_work_request_logs: common.extend({ ...workRequest, ...paging }),
} as const

export type OciComputeOperation = keyof typeof ociComputeSchemas
export type OciComputeInput = z.output<(typeof ociComputeSchemas)[OciComputeOperation]>

/** Enforces OCI's combined metadata limit for direct launches, updates and nested templates. */
export function validateOciComputeMetadata(input: Record<string, unknown>): void {
  if (Buffer.byteLength(JSON.stringify(input.metadata ?? {})) + Buffer.byteLength(JSON.stringify(input.extendedMetadata ?? {})) > 32_000) {
    throw new Error('Combined metadata and extendedMetadata must not exceed 32,000 bytes')
  }
  const details = input.instanceDetails
  if (details && typeof details === 'object' && 'launchDetails' in details && details.launchDetails && typeof details.launchDetails === 'object') {
    validateOciComputeMetadata(details.launchDetails as Record<string, unknown>)
  }
}
