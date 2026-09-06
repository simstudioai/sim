import { NetSuiteIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalNumberInput } from '@/blocks/utils'
import type { OciComputeResponse } from '@/tools/oci_compute/types'

const COMPARTMENT_ID_OPERATIONS = [
  'oci_compute_list_instances',
  'oci_compute_launch_instance',
  'oci_compute_change_instance_compartment',
  'oci_compute_list_images',
  'oci_compute_create_image',
  'oci_compute_change_image_compartment',
  'oci_compute_list_shapes',
  'oci_compute_create_compute_capacity_report',
  'oci_compute_list_instance_configurations',
  'oci_compute_create_instance_configuration',
  'oci_compute_change_instance_configuration_compartment',
  'oci_compute_list_instance_pools',
  'oci_compute_create_instance_pool',
  'oci_compute_change_instance_pool_compartment',
  'oci_compute_list_instance_pool_instances',
  'oci_compute_list_availability_domains',
  'oci_compute_list_fault_domains',
  'oci_compute_list_compartments',
  'oci_compute_get_compartment',
  'oci_compute_list_subnets',
  'oci_compute_list_vnic_attachments',
  'oci_compute_list_boot_volume_attachments',
  'oci_compute_list_volume_attachments',
  'oci_compute_list_work_requests',
  'oci_compute_get_instance',
  'oci_compute_update_instance',
  'oci_compute_instance_action',
  'oci_compute_terminate_instance',
  'oci_compute_get_instance_maintenance_reboot',
  'oci_compute_get_image',
  'oci_compute_update_image',
  'oci_compute_delete_image',
  'oci_compute_list_image_shape_compatibility_entries',
  'oci_compute_get_image_shape_compatibility_entry',
  'oci_compute_get_instance_configuration',
  'oci_compute_update_instance_configuration',
  'oci_compute_delete_instance_configuration',
  'oci_compute_launch_instance_configuration',
  'oci_compute_get_instance_pool',
  'oci_compute_update_instance_pool',
  'oci_compute_instance_pool_action',
  'oci_compute_terminate_instance_pool',
  'oci_compute_get_instance_pool_instance',
  'oci_compute_attach_instance_pool_instance',
  'oci_compute_detach_instance_pool_instance',
  'oci_compute_get_subnet',
]

const LIMIT_OPERATIONS = [
  'oci_compute_list_instances',
  'oci_compute_list_images',
  'oci_compute_list_shapes',
  'oci_compute_list_image_shape_compatibility_entries',
  'oci_compute_list_instance_configurations',
  'oci_compute_list_instance_pools',
  'oci_compute_list_instance_pool_instances',
  'oci_compute_list_compartments',
  'oci_compute_list_subnets',
  'oci_compute_list_vnic_attachments',
  'oci_compute_list_boot_volume_attachments',
  'oci_compute_list_volume_attachments',
  'oci_compute_list_work_requests',
  'oci_compute_list_work_request_errors',
  'oci_compute_list_work_request_logs',
]

const PAGE_OPERATIONS = [
  'oci_compute_list_instances',
  'oci_compute_list_images',
  'oci_compute_list_shapes',
  'oci_compute_list_image_shape_compatibility_entries',
  'oci_compute_list_instance_configurations',
  'oci_compute_list_instance_pools',
  'oci_compute_list_instance_pool_instances',
  'oci_compute_list_compartments',
  'oci_compute_list_subnets',
  'oci_compute_list_vnic_attachments',
  'oci_compute_list_boot_volume_attachments',
  'oci_compute_list_volume_attachments',
  'oci_compute_list_work_requests',
  'oci_compute_list_work_request_errors',
  'oci_compute_list_work_request_logs',
]

const SORT_BY_OPERATIONS = [
  'oci_compute_list_instances',
  'oci_compute_list_images',
  'oci_compute_list_instance_configurations',
  'oci_compute_list_instance_pools',
  'oci_compute_list_instance_pool_instances',
  'oci_compute_list_subnets',
]

const SORT_ORDER_OPERATIONS = [
  'oci_compute_list_instances',
  'oci_compute_list_images',
  'oci_compute_list_instance_configurations',
  'oci_compute_list_instance_pools',
  'oci_compute_list_instance_pool_instances',
  'oci_compute_list_subnets',
]

const DISPLAY_NAME_OPERATIONS = [
  'oci_compute_list_instances',
  'oci_compute_launch_instance',
  'oci_compute_update_instance',
  'oci_compute_list_images',
  'oci_compute_create_image',
  'oci_compute_update_image',
  'oci_compute_create_instance_configuration',
  'oci_compute_update_instance_configuration',
  'oci_compute_list_instance_pools',
  'oci_compute_create_instance_pool',
  'oci_compute_update_instance_pool',
  'oci_compute_list_instance_pool_instances',
  'oci_compute_list_subnets',
]

const AVAILABILITY_DOMAIN_OPERATIONS = [
  'oci_compute_list_instances',
  'oci_compute_launch_instance',
  'oci_compute_list_shapes',
  'oci_compute_create_compute_capacity_report',
  'oci_compute_list_fault_domains',
  'oci_compute_list_vnic_attachments',
  'oci_compute_list_boot_volume_attachments',
  'oci_compute_list_volume_attachments',
]

const LIFECYCLE_STATE_OPERATIONS = [
  'oci_compute_list_instances',
  'oci_compute_list_images',
  'oci_compute_list_instance_pools',
  'oci_compute_list_compartments',
  'oci_compute_list_subnets',
]

const CAPACITY_RESERVATION_ID_OPERATIONS = [
  'oci_compute_list_instances',
  'oci_compute_launch_instance',
  'oci_compute_update_instance',
]

const INSTANCE_ID_OPERATIONS = [
  'oci_compute_get_instance',
  'oci_compute_update_instance',
  'oci_compute_instance_action',
  'oci_compute_terminate_instance',
  'oci_compute_change_instance_compartment',
  'oci_compute_get_instance_maintenance_reboot',
  'oci_compute_create_image',
  'oci_compute_create_instance_configuration',
  'oci_compute_get_instance_pool_instance',
  'oci_compute_attach_instance_pool_instance',
  'oci_compute_detach_instance_pool_instance',
  'oci_compute_list_vnic_attachments',
  'oci_compute_list_boot_volume_attachments',
  'oci_compute_list_volume_attachments',
]

const SHAPE_OPERATIONS = [
  'oci_compute_launch_instance',
  'oci_compute_update_instance',
  'oci_compute_list_images',
  'oci_compute_list_shapes',
  'oci_compute_get_image_shape_compatibility_entry',
]

const SOURCE_MODE_OPERATIONS = [
  'oci_compute_launch_instance',
]

const IMAGE_ID_OPERATIONS = [
  'oci_compute_launch_instance',
  'oci_compute_get_image',
  'oci_compute_update_image',
  'oci_compute_delete_image',
  'oci_compute_change_image_compartment',
  'oci_compute_list_shapes',
  'oci_compute_list_image_shape_compatibility_entries',
  'oci_compute_get_image_shape_compatibility_entry',
]

const IMAGE_FILTER_OPERATIONS = [
  'oci_compute_launch_instance',
]

const BOOT_VOLUME_ID_OPERATIONS = [
  'oci_compute_launch_instance',
]

const BOOT_VOLUME_SIZE_IN_GBS_OPERATIONS = [
  'oci_compute_launch_instance',
]

const BOOT_VOLUME_VPUS_PER_GB_OPERATIONS = [
  'oci_compute_launch_instance',
]

const KMS_KEY_ID_OPERATIONS = [
  'oci_compute_launch_instance',
]

const FREEFORM_TAGS_OPERATIONS = [
  'oci_compute_launch_instance',
  'oci_compute_update_instance',
  'oci_compute_create_image',
  'oci_compute_update_image',
  'oci_compute_create_instance_configuration',
  'oci_compute_update_instance_configuration',
  'oci_compute_create_instance_pool',
  'oci_compute_update_instance_pool',
]

const DEFINED_TAGS_OPERATIONS = [
  'oci_compute_launch_instance',
  'oci_compute_update_instance',
  'oci_compute_create_image',
  'oci_compute_update_image',
  'oci_compute_create_instance_configuration',
  'oci_compute_update_instance_configuration',
  'oci_compute_create_instance_pool',
  'oci_compute_update_instance_pool',
]

const RETRY_TOKEN_OPERATIONS = [
  'oci_compute_launch_instance',
  'oci_compute_create_image',
  'oci_compute_create_compute_capacity_report',
  'oci_compute_create_instance_configuration',
  'oci_compute_launch_instance_configuration',
  'oci_compute_create_instance_pool',
]

const SHAPE_CONFIG_OPERATIONS = [
  'oci_compute_launch_instance',
  'oci_compute_update_instance',
]

const CREATE_VNIC_DETAILS_OPERATIONS = [
  'oci_compute_launch_instance',
]

const FAULT_DOMAIN_OPERATIONS = [
  'oci_compute_launch_instance',
  'oci_compute_update_instance',
]

const METADATA_OPERATIONS = [
  'oci_compute_launch_instance',
  'oci_compute_update_instance',
]

const EXTENDED_METADATA_OPERATIONS = [
  'oci_compute_launch_instance',
  'oci_compute_update_instance',
]

const AGENT_CONFIG_OPERATIONS = [
  'oci_compute_launch_instance',
  'oci_compute_update_instance',
]

const AVAILABILITY_CONFIG_OPERATIONS = [
  'oci_compute_launch_instance',
  'oci_compute_update_instance',
]

const INSTANCE_OPTIONS_OPERATIONS = [
  'oci_compute_launch_instance',
  'oci_compute_update_instance',
]

const DEDICATED_VM_HOST_ID_OPERATIONS = [
  'oci_compute_launch_instance',
  'oci_compute_update_instance',
]

const IF_MATCH_OPERATIONS = [
  'oci_compute_update_instance',
  'oci_compute_instance_action',
  'oci_compute_terminate_instance',
  'oci_compute_change_instance_compartment',
  'oci_compute_update_image',
  'oci_compute_delete_image',
  'oci_compute_change_image_compartment',
  'oci_compute_update_instance_configuration',
  'oci_compute_delete_instance_configuration',
  'oci_compute_change_instance_configuration_compartment',
  'oci_compute_update_instance_pool',
  'oci_compute_instance_pool_action',
  'oci_compute_terminate_instance_pool',
  'oci_compute_change_instance_pool_compartment',
]

const TIME_MAINTENANCE_REBOOT_DUE_OPERATIONS = [
  'oci_compute_update_instance',
]

const UPDATE_OPERATION_CONSTRAINT_OPERATIONS = [
  'oci_compute_update_instance',
]

const ACTION_OPERATIONS = [
  'oci_compute_instance_action',
  'oci_compute_instance_pool_action',
]

const ALLOW_DENSE_REBOOT_MIGRATION_OPERATIONS = [
  'oci_compute_instance_action',
]

const DELETE_LOCAL_STORAGE_OPERATIONS = [
  'oci_compute_instance_action',
]

const TIME_SCHEDULED_OPERATIONS = [
  'oci_compute_instance_action',
]

const PRESERVE_BOOT_VOLUME_OPERATIONS = [
  'oci_compute_terminate_instance',
]

const PRESERVE_DATA_VOLUMES_CREATED_AT_LAUNCH_OPERATIONS = [
  'oci_compute_terminate_instance',
]

const OPERATING_SYSTEM_OPERATIONS = [
  'oci_compute_list_images',
]

const OPERATING_SYSTEM_VERSION_OPERATIONS = [
  'oci_compute_list_images',
]

const SHAPE_AVAILABILITIES_OPERATIONS = [
  'oci_compute_create_compute_capacity_report',
]

const INSTANCE_CONFIGURATION_ID_OPERATIONS = [
  'oci_compute_get_instance_configuration',
  'oci_compute_update_instance_configuration',
  'oci_compute_delete_instance_configuration',
  'oci_compute_launch_instance_configuration',
  'oci_compute_change_instance_configuration_compartment',
  'oci_compute_create_instance_pool',
  'oci_compute_update_instance_pool',
]

const CONFIGURATION_SOURCE_OPERATIONS = [
  'oci_compute_create_instance_configuration',
]

const INSTANCE_DETAILS_OPERATIONS = [
  'oci_compute_create_instance_configuration',
  'oci_compute_launch_instance_configuration',
]

const INSTANCE_POOL_ID_OPERATIONS = [
  'oci_compute_get_instance_pool',
  'oci_compute_update_instance_pool',
  'oci_compute_instance_pool_action',
  'oci_compute_terminate_instance_pool',
  'oci_compute_change_instance_pool_compartment',
  'oci_compute_list_instance_pool_instances',
  'oci_compute_get_instance_pool_instance',
  'oci_compute_attach_instance_pool_instance',
  'oci_compute_detach_instance_pool_instance',
]

const SIZE_OPERATIONS = [
  'oci_compute_create_instance_pool',
  'oci_compute_update_instance_pool',
]

const PLACEMENT_CONFIGURATIONS_OPERATIONS = [
  'oci_compute_create_instance_pool',
  'oci_compute_update_instance_pool',
]

const INSTANCE_DISPLAY_NAME_FORMATTER_OPERATIONS = [
  'oci_compute_create_instance_pool',
  'oci_compute_update_instance_pool',
]

const INSTANCE_HOSTNAME_FORMATTER_OPERATIONS = [
  'oci_compute_create_instance_pool',
  'oci_compute_update_instance_pool',
]

const IS_AUTO_TERMINATE_OPERATIONS = [
  'oci_compute_detach_instance_pool_instance',
]

const IS_DECREMENT_SIZE_OPERATIONS = [
  'oci_compute_detach_instance_pool_instance',
]

const NAME_OPERATIONS = [
  'oci_compute_list_compartments',
]

const ACCESS_LEVEL_OPERATIONS = [
  'oci_compute_list_compartments',
]

const COMPARTMENT_ID_IN_SUBTREE_OPERATIONS = [
  'oci_compute_list_compartments',
]

const VCN_ID_OPERATIONS = [
  'oci_compute_list_subnets',
]

const SUBNET_ID_OPERATIONS = [
  'oci_compute_get_subnet',
  'oci_compute_launch_instance',
]

const VNIC_ID_OPERATIONS = [
  'oci_compute_get_vnic',
]

const RESOURCE_ID_OPERATIONS = [
  'oci_compute_list_work_requests',
]

const WORK_REQUEST_ID_OPERATIONS = [
  'oci_compute_get_work_request',
  'oci_compute_list_work_request_errors',
  'oci_compute_list_work_request_logs',
]

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  if (value === undefined || value === null || value === '') return undefined
  throw new Error('Boolean inputs must be true or false')
}

export const OciComputeBlock: BlockConfig<OciComputeResponse> = {
  type: 'oci_compute',
  name: 'OCI Compute',
  description: 'Manage OCI instances, images, capacity, configurations, and pools',
  longDescription:
    'Manage Compute instances, custom images, shapes, capacity reports, instance configurations and pools with a reusable OCI signing-key credential. Discover existing placement and attachment resources and inspect work requests. Launching, resizing, starting, and capturing images can incur charges. Deletion and termination can permanently destroy data. Operations return current state promptly; use get/status tools to check progress. Retry tokens protect supported requests within Oracle’s token lifetime; unkeyed mutations can repeat if workflow retries are enabled. Networking and storage provisioning are separate integrations.',
  docsLink: 'https://docs.sim.ai/integrations/oci_compute',
  authMode: AuthMode.ApiKey,
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'OCI Compute',
    sentences: {
      byOperation: {
        oci_compute_list_instances: ['List Instances'],
        oci_compute_get_instance: ['Get Instance'],
        oci_compute_launch_instance: ['Launch Instance'],
        oci_compute_update_instance: ['Update Instance'],
        oci_compute_instance_action: ['Instance Action'],
        oci_compute_terminate_instance: ['Terminate Instance'],
        oci_compute_change_instance_compartment: ['Change Instance Compartment'],
        oci_compute_get_instance_maintenance_reboot: ['Get Instance Maintenance Reboot'],
        oci_compute_list_images: ['List Images'],
        oci_compute_get_image: ['Get Image'],
        oci_compute_create_image: ['Create Image'],
        oci_compute_update_image: ['Update Image'],
        oci_compute_delete_image: ['Delete Image'],
        oci_compute_change_image_compartment: ['Change Image Compartment'],
        oci_compute_list_shapes: ['List Shapes'],
        oci_compute_list_image_shape_compatibility_entries: ['List Image Shape Compatibility Entries'],
        oci_compute_get_image_shape_compatibility_entry: ['Get Image Shape Compatibility Entry'],
        oci_compute_create_compute_capacity_report: ['Create Compute Capacity Report'],
        oci_compute_list_instance_configurations: ['List Instance Configurations'],
        oci_compute_get_instance_configuration: ['Get Instance Configuration'],
        oci_compute_create_instance_configuration: ['Create Instance Configuration'],
        oci_compute_update_instance_configuration: ['Update Instance Configuration'],
        oci_compute_delete_instance_configuration: ['Delete Instance Configuration'],
        oci_compute_launch_instance_configuration: ['Launch Instance Configuration'],
        oci_compute_change_instance_configuration_compartment: ['Change Instance Configuration Compartment'],
        oci_compute_list_instance_pools: ['List Instance Pools'],
        oci_compute_get_instance_pool: ['Get Instance Pool'],
        oci_compute_create_instance_pool: ['Create Instance Pool'],
        oci_compute_update_instance_pool: ['Update Instance Pool'],
        oci_compute_instance_pool_action: ['Instance Pool Action'],
        oci_compute_terminate_instance_pool: ['Terminate Instance Pool'],
        oci_compute_change_instance_pool_compartment: ['Change Instance Pool Compartment'],
        oci_compute_list_instance_pool_instances: ['List Instance Pool Instances'],
        oci_compute_get_instance_pool_instance: ['Get Instance Pool Instance'],
        oci_compute_attach_instance_pool_instance: ['Attach Instance Pool Instance'],
        oci_compute_detach_instance_pool_instance: ['Detach Instance Pool Instance'],
        oci_compute_list_availability_domains: ['List Availability Domains'],
        oci_compute_list_fault_domains: ['List Fault Domains'],
        oci_compute_list_compartments: ['List Compartments'],
        oci_compute_get_compartment: ['Get Compartment'],
        oci_compute_list_subnets: ['List Subnets'],
        oci_compute_get_subnet: ['Get Subnet'],
        oci_compute_list_vnic_attachments: ['List Vnic Attachments'],
        oci_compute_get_vnic: ['Get Vnic'],
        oci_compute_list_boot_volume_attachments: ['List Boot Volume Attachments'],
        oci_compute_list_volume_attachments: ['List Volume Attachments'],
        oci_compute_list_work_requests: ['List Work Requests'],
        oci_compute_get_work_request: ['Get Work Request'],
        oci_compute_list_work_request_errors: ['List Work Request Errors'],
        oci_compute_list_work_request_logs: ['List Work Request Logs'],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'OCI Account',
      type: 'oauth-input',
      serviceId: 'oci_compute',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select OCI signing-key credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'OCI Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Credential ID or runtime reference',
      required: true,
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      placeholder: 'us-ashburn-1',
      required: true,
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Instances', id: 'oci_compute_list_instances' },
        { label: 'Get Instance', id: 'oci_compute_get_instance' },
        { label: 'Launch Instance', id: 'oci_compute_launch_instance' },
        { label: 'Update Instance', id: 'oci_compute_update_instance' },
        { label: 'Instance Action', id: 'oci_compute_instance_action' },
        { label: 'Terminate Instance', id: 'oci_compute_terminate_instance' },
        { label: 'Change Instance Compartment', id: 'oci_compute_change_instance_compartment' },
        { label: 'Get Instance Maintenance Reboot', id: 'oci_compute_get_instance_maintenance_reboot' },
        { label: 'List Images', id: 'oci_compute_list_images' },
        { label: 'Get Image', id: 'oci_compute_get_image' },
        { label: 'Create Image', id: 'oci_compute_create_image' },
        { label: 'Update Image', id: 'oci_compute_update_image' },
        { label: 'Delete Image', id: 'oci_compute_delete_image' },
        { label: 'Change Image Compartment', id: 'oci_compute_change_image_compartment' },
        { label: 'List Shapes', id: 'oci_compute_list_shapes' },
        { label: 'List Image Shape Compatibility Entries', id: 'oci_compute_list_image_shape_compatibility_entries' },
        { label: 'Get Image Shape Compatibility Entry', id: 'oci_compute_get_image_shape_compatibility_entry' },
        { label: 'Create Compute Capacity Report', id: 'oci_compute_create_compute_capacity_report' },
        { label: 'List Instance Configurations', id: 'oci_compute_list_instance_configurations' },
        { label: 'Get Instance Configuration', id: 'oci_compute_get_instance_configuration' },
        { label: 'Create Instance Configuration', id: 'oci_compute_create_instance_configuration' },
        { label: 'Update Instance Configuration', id: 'oci_compute_update_instance_configuration' },
        { label: 'Delete Instance Configuration', id: 'oci_compute_delete_instance_configuration' },
        { label: 'Launch Instance Configuration', id: 'oci_compute_launch_instance_configuration' },
        { label: 'Change Instance Configuration Compartment', id: 'oci_compute_change_instance_configuration_compartment' },
        { label: 'List Instance Pools', id: 'oci_compute_list_instance_pools' },
        { label: 'Get Instance Pool', id: 'oci_compute_get_instance_pool' },
        { label: 'Create Instance Pool', id: 'oci_compute_create_instance_pool' },
        { label: 'Update Instance Pool', id: 'oci_compute_update_instance_pool' },
        { label: 'Instance Pool Action', id: 'oci_compute_instance_pool_action' },
        { label: 'Terminate Instance Pool', id: 'oci_compute_terminate_instance_pool' },
        { label: 'Change Instance Pool Compartment', id: 'oci_compute_change_instance_pool_compartment' },
        { label: 'List Instance Pool Instances', id: 'oci_compute_list_instance_pool_instances' },
        { label: 'Get Instance Pool Instance', id: 'oci_compute_get_instance_pool_instance' },
        { label: 'Attach Instance Pool Instance', id: 'oci_compute_attach_instance_pool_instance' },
        { label: 'Detach Instance Pool Instance', id: 'oci_compute_detach_instance_pool_instance' },
        { label: 'List Availability Domains', id: 'oci_compute_list_availability_domains' },
        { label: 'List Fault Domains', id: 'oci_compute_list_fault_domains' },
        { label: 'List Compartments', id: 'oci_compute_list_compartments' },
        { label: 'Get Compartment', id: 'oci_compute_get_compartment' },
        { label: 'List Subnets', id: 'oci_compute_list_subnets' },
        { label: 'Get Subnet', id: 'oci_compute_get_subnet' },
        { label: 'List Vnic Attachments', id: 'oci_compute_list_vnic_attachments' },
        { label: 'Get Vnic', id: 'oci_compute_get_vnic' },
        { label: 'List Boot Volume Attachments', id: 'oci_compute_list_boot_volume_attachments' },
        { label: 'List Volume Attachments', id: 'oci_compute_list_volume_attachments' },
        { label: 'List Work Requests', id: 'oci_compute_list_work_requests' },
        { label: 'Get Work Request', id: 'oci_compute_get_work_request' },
        { label: 'List Work Request Errors', id: 'oci_compute_list_work_request_errors' },
        { label: 'List Work Request Logs', id: 'oci_compute_list_work_request_logs' },
      ],
      value: () => 'oci_compute_list_instances',
      required: true,
    },
    {
      id: 'parentCompartmentId',
      title: 'Parent Compartment for Discovery',
      type: 'short-input',
      placeholder: 'Parent compartment or tenancy OCID for the compartment picker',
    },
    {
      id: 'compartmentSelector',
      title: 'Compartment Id',
      type: 'project-selector',
      canonicalParamId: 'compartmentId',
      serviceId: 'oci_compute',
      selectorKey: 'oci_compute.compartments',
      dependsOn: ['credential', 'region', 'parentCompartmentId'],
      mode: 'basic',
      placeholder: 'Select Compartment Id',
      condition: { field: 'operation', value: COMPARTMENT_ID_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_list_instances','oci_compute_launch_instance','oci_compute_change_instance_compartment','oci_compute_list_images','oci_compute_create_image','oci_compute_change_image_compartment','oci_compute_list_shapes','oci_compute_create_compute_capacity_report','oci_compute_list_instance_configurations','oci_compute_create_instance_configuration','oci_compute_change_instance_configuration_compartment','oci_compute_list_instance_pools','oci_compute_create_instance_pool','oci_compute_change_instance_pool_compartment','oci_compute_list_instance_pool_instances','oci_compute_list_availability_domains','oci_compute_list_fault_domains','oci_compute_list_compartments','oci_compute_get_compartment','oci_compute_list_subnets','oci_compute_list_vnic_attachments','oci_compute_list_boot_volume_attachments','oci_compute_list_volume_attachments','oci_compute_list_work_requests'] },
    },
    {
      id: 'compartmentIdManual',
      title: 'Compartment Id',
      type: 'short-input',
      canonicalParamId: 'compartmentId',
      mode: 'advanced',
      placeholder: 'Compartment OCID; use the destination for moves, parent for compartment listing, and root for capacity reports',
      condition: { field: 'operation', value: COMPARTMENT_ID_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_list_instances','oci_compute_launch_instance','oci_compute_change_instance_compartment','oci_compute_list_images','oci_compute_create_image','oci_compute_change_image_compartment','oci_compute_list_shapes','oci_compute_create_compute_capacity_report','oci_compute_list_instance_configurations','oci_compute_create_instance_configuration','oci_compute_change_instance_configuration_compartment','oci_compute_list_instance_pools','oci_compute_create_instance_pool','oci_compute_change_instance_pool_compartment','oci_compute_list_instance_pool_instances','oci_compute_list_availability_domains','oci_compute_list_fault_domains','oci_compute_list_compartments','oci_compute_get_compartment','oci_compute_list_subnets','oci_compute_list_vnic_attachments','oci_compute_list_boot_volume_attachments','oci_compute_list_volume_attachments','oci_compute_list_work_requests'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Maximum results in this page, 1–100; default 50',
      mode: 'advanced',
      condition: { field: 'operation', value: LIMIT_OPERATIONS },
      required: false,
    },
    {
      id: 'page',
      title: 'Page',
      type: 'short-input',
      placeholder: 'Opaque continuation token from nextPage; empty pages can still have another token',
      mode: 'advanced',
      condition: { field: 'operation', value: PAGE_OPERATIONS },
      required: false,
    },
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'Sort by TIMECREATED or DISPLAYNAME',
      mode: 'advanced',
      condition: { field: 'operation', value: SORT_BY_OPERATIONS },
      required: false,
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      placeholder: 'Sort direction: ASC or DESC',
      options: [{ label: 'ASC', id: 'ASC' }, { label: 'DESC', id: 'DESC' }],
      mode: 'advanced',
      condition: { field: 'operation', value: SORT_ORDER_OPERATIONS },
      required: false,
    },
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      placeholder: 'Display name; on list operations this is an exact provider filter',
      condition: { field: 'operation', value: DISPLAY_NAME_OPERATIONS },
      required: false,
    },
    {
      id: 'availabilityDomainSelector',
      title: 'Availability Domain',
      type: 'project-selector',
      canonicalParamId: 'availabilityDomain',
      serviceId: 'oci_compute',
      selectorKey: 'oci_compute.availabilityDomains',
      dependsOn: ['credential', 'region', 'compartmentSelector'],
      mode: 'basic',
      placeholder: 'Select Availability Domain',
      condition: { field: 'operation', value: AVAILABILITY_DOMAIN_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_launch_instance','oci_compute_create_compute_capacity_report','oci_compute_list_fault_domains','oci_compute_list_boot_volume_attachments'] },
    },
    {
      id: 'availabilityDomainManual',
      title: 'Availability Domain',
      type: 'short-input',
      canonicalParamId: 'availabilityDomain',
      mode: 'advanced',
      placeholder: 'Exact availability-domain name returned by OCI discovery',
      condition: { field: 'operation', value: AVAILABILITY_DOMAIN_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_launch_instance','oci_compute_create_compute_capacity_report','oci_compute_list_fault_domains','oci_compute_list_boot_volume_attachments'] },
    },
    {
      id: 'lifecycleState',
      title: 'Lifecycle State',
      type: 'short-input',
      placeholder: 'Exact lifecycle-state filter supported by this resource',
      mode: 'advanced',
      condition: { field: 'operation', value: LIFECYCLE_STATE_OPERATIONS },
      required: false,
    },
    {
      id: 'capacityReservationId',
      title: 'Capacity Reservation Id',
      type: 'short-input',
      placeholder: 'Existing reservation OCID; an empty string opts out on direct launch or removes the reservation on update',
      mode: 'advanced',
      condition: { field: 'operation', value: CAPACITY_RESERVATION_ID_OPERATIONS },
      required: false,
    },
    {
      id: 'instanceIdSelector',
      title: 'Instance Id',
      type: 'project-selector',
      canonicalParamId: 'instanceId',
      serviceId: 'oci_compute',
      selectorKey: 'oci_compute.instances',
      dependsOn: ['credential', 'region', 'compartmentSelector'],
      mode: 'basic',
      placeholder: 'Select Instance Id',
      condition: { field: 'operation', value: INSTANCE_ID_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_get_instance','oci_compute_update_instance','oci_compute_instance_action','oci_compute_terminate_instance','oci_compute_change_instance_compartment','oci_compute_get_instance_maintenance_reboot','oci_compute_create_image','oci_compute_get_instance_pool_instance','oci_compute_attach_instance_pool_instance','oci_compute_detach_instance_pool_instance','oci_compute_list_vnic_attachments','oci_compute_list_boot_volume_attachments','oci_compute_list_volume_attachments'] },
    },
    {
      id: 'instanceIdManual',
      title: 'Instance Id',
      type: 'short-input',
      canonicalParamId: 'instanceId',
      mode: 'advanced',
      placeholder: 'Compute instance OCID',
      condition: { field: 'operation', value: INSTANCE_ID_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_get_instance','oci_compute_update_instance','oci_compute_instance_action','oci_compute_terminate_instance','oci_compute_change_instance_compartment','oci_compute_get_instance_maintenance_reboot','oci_compute_create_image','oci_compute_get_instance_pool_instance','oci_compute_attach_instance_pool_instance','oci_compute_detach_instance_pool_instance','oci_compute_list_vnic_attachments','oci_compute_list_boot_volume_attachments','oci_compute_list_volume_attachments'] },
    },
    {
      id: 'shapeSelector',
      title: 'Shape',
      type: 'project-selector',
      canonicalParamId: 'shape',
      serviceId: 'oci_compute',
      selectorKey: 'oci_compute.shapes',
      dependsOn: ['credential', 'region', 'compartmentSelector'],
      mode: 'basic',
      placeholder: 'Select Shape',
      condition: { field: 'operation', value: SHAPE_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_launch_instance','oci_compute_get_image_shape_compatibility_entry'] },
    },
    {
      id: 'shapeManual',
      title: 'Shape',
      type: 'short-input',
      canonicalParamId: 'shape',
      mode: 'advanced',
      placeholder: 'Compute shape name; image, capacity, and shape compatibility are validated by OCI',
      condition: { field: 'operation', value: SHAPE_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_launch_instance','oci_compute_get_image_shape_compatibility_entry'] },
    },
    {
      id: 'sourceMode',
      title: 'Source Mode',
      type: 'dropdown',
      placeholder: 'Launch from image ID (image), image filter (imageFilter), or existing boot volume (bootVolume)',
      options: [{ label: 'image', id: 'image' }, { label: 'imageFilter', id: 'imageFilter' }, { label: 'bootVolume', id: 'bootVolume' }],
      value: () => 'image',
      condition: { field: 'operation', value: SOURCE_MODE_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_launch_instance'] },
    },
    {
      id: 'imageIdSelector',
      title: 'Image Id',
      type: 'project-selector',
      canonicalParamId: 'imageId',
      serviceId: 'oci_compute',
      selectorKey: 'oci_compute.images',
      dependsOn: ['credential', 'region', 'compartmentSelector'],
      mode: 'basic',
      placeholder: 'Select Image Id',
      condition: { field: 'operation', value: IMAGE_ID_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_get_image','oci_compute_update_image','oci_compute_delete_image','oci_compute_change_image_compartment','oci_compute_list_image_shape_compatibility_entries','oci_compute_get_image_shape_compatibility_entry'] },
    },
    {
      id: 'imageIdManual',
      title: 'Image Id',
      type: 'short-input',
      canonicalParamId: 'imageId',
      mode: 'advanced',
      placeholder: 'Image OCID; required for image-ID launches',
      condition: { field: 'operation', value: IMAGE_ID_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_get_image','oci_compute_update_image','oci_compute_delete_image','oci_compute_change_image_compartment','oci_compute_list_image_shape_compatibility_entries','oci_compute_get_image_shape_compatibility_entry'] },
    },
    {
      id: 'imageFilter',
      title: 'Image Filter',
      type: 'long-input',
      placeholder: 'Image selection criteria: compartmentId, operatingSystem, operatingSystemVersion, definedTagsFilter',
      condition: { field: 'operation', value: IMAGE_FILTER_OPERATIONS },
      required: false,
    },
    {
      id: 'bootVolumeId',
      title: 'Boot Volume Id',
      type: 'short-input',
      placeholder: 'Existing boot volume OCID in the instance availability domain; only for bootVolume launches',
      condition: { field: 'operation', value: BOOT_VOLUME_ID_OPERATIONS },
      required: false,
    },
    {
      id: 'bootVolumeSizeInGBs',
      title: 'Boot Volume Size In GBs',
      type: 'short-input',
      placeholder: 'Image-source boot volume size in GB, 50–32768; increases storage charges',
      mode: 'advanced',
      condition: { field: 'operation', value: BOOT_VOLUME_SIZE_IN_GBS_OPERATIONS },
      required: false,
    },
    {
      id: 'bootVolumeVpusPerGB',
      title: 'Boot Volume Vpus Per GB',
      type: 'short-input',
      placeholder: 'Image-source boot volume performance: 10, 20, or 30–120 VPUs/GB; affects charges',
      mode: 'advanced',
      condition: { field: 'operation', value: BOOT_VOLUME_VPUS_PER_GB_OPERATIONS },
      required: false,
    },
    {
      id: 'kmsKeyId',
      title: 'Kms Key Id',
      type: 'short-input',
      placeholder: 'Existing Vault key OCID for a newly created image-source boot volume',
      mode: 'advanced',
      condition: { field: 'operation', value: KMS_KEY_ID_OPERATIONS },
      required: false,
    },
    {
      id: 'freeformTags',
      title: 'Freeform Tags',
      type: 'long-input',
      placeholder: 'Free-form tags as a string-to-string JSON map',
      mode: 'advanced',
      condition: { field: 'operation', value: FREEFORM_TAGS_OPERATIONS },
      required: false,
    },
    {
      id: 'definedTags',
      title: 'Defined Tags',
      type: 'long-input',
      placeholder: 'Defined string tags grouped by namespace, for example {Operations: {CostCenter: "42"}}',
      mode: 'advanced',
      condition: { field: 'operation', value: DEFINED_TAGS_OPERATIONS },
      required: false,
    },
    {
      id: 'retryToken',
      title: 'Retry Token',
      type: 'short-input',
      placeholder: 'Optional 1–64 character retry token. Reuse only for the same logical creation request; otherwise Sim derives an invocation key',
      mode: 'advanced',
      condition: { field: 'operation', value: RETRY_TOKEN_OPERATIONS },
      required: false,
    },
    {
      id: 'shapeConfig',
      title: 'Shape Config',
      type: 'long-input',
      placeholder: 'Shape resources: ocpus OR vcpus, memoryInGBs, baselineOcpuUtilization, nvmes; use List Shapes for valid ranges',
      mode: 'advanced',
      condition: { field: 'operation', value: SHAPE_CONFIG_OPERATIONS },
      required: false,
    },
    {
      id: 'createVnicDetails',
      title: 'Create Vnic Details',
      type: 'long-input',
      placeholder: 'Primary VNIC settings: subnetId (required), displayName, assignPublicIp, assignPrivateDnsRecord, hostnameLabel, privateIp/privateIpId/subnetCidr, nsgIds, skipSourceDestCheck, assignIpv6Ip, ipv6AddressIpv6SubnetCidrPairDetails',
      condition: { field: 'operation', value: CREATE_VNIC_DETAILS_OPERATIONS },
      required: false,
    },
    {
      id: 'faultDomainSelector',
      title: 'Fault Domain',
      type: 'project-selector',
      canonicalParamId: 'faultDomain',
      serviceId: 'oci_compute',
      selectorKey: 'oci_compute.faultDomains',
      dependsOn: ['credential', 'region', 'compartmentSelector', 'availabilityDomainSelector'],
      mode: 'basic',
      placeholder: 'Select Fault Domain',
      condition: { field: 'operation', value: FAULT_DOMAIN_OPERATIONS },
      required: false,
    },
    {
      id: 'faultDomainManual',
      title: 'Fault Domain',
      type: 'short-input',
      canonicalParamId: 'faultDomain',
      mode: 'advanced',
      placeholder: 'Fault domain within the selected availability domain',
      condition: { field: 'operation', value: FAULT_DOMAIN_OPERATIONS },
      required: false,
    },
    {
      id: 'metadata',
      title: 'Metadata',
      type: 'long-input',
      placeholder: 'String-to-string metadata map; user_data is base64 and ssh_authorized_keys contains SSH public keys. Updates replace the map and must retain immutable launch keys unchanged',
      mode: 'advanced',
      condition: { field: 'operation', value: METADATA_OPERATIONS },
      required: false,
    },
    {
      id: 'extendedMetadata',
      title: 'Extended Metadata',
      type: 'long-input',
      placeholder: 'Nested metadata map; combined with metadata, at most 32000 bytes. Updates must preserve immutable launch keys',
      mode: 'advanced',
      condition: { field: 'operation', value: EXTENDED_METADATA_OPERATIONS },
      required: false,
    },
    {
      id: 'agentConfig',
      title: 'Agent Config',
      type: 'long-input',
      placeholder: 'Oracle Cloud Agent settings: isMonitoringDisabled, isManagementDisabled, areAllPluginsDisabled, pluginsConfig [{name, desiredState: ENABLED or DISABLED}]',
      mode: 'advanced',
      condition: { field: 'operation', value: AGENT_CONFIG_OPERATIONS },
      required: false,
    },
    {
      id: 'availabilityConfig',
      title: 'Availability Config',
      type: 'long-input',
      placeholder: 'Availability settings: recoveryAction (RESTORE_INSTANCE or STOP_INSTANCE), isLiveMigrationPreferred',
      mode: 'advanced',
      condition: { field: 'operation', value: AVAILABILITY_CONFIG_OPERATIONS },
      required: false,
    },
    {
      id: 'instanceOptions',
      title: 'Instance Options',
      type: 'long-input',
      placeholder: 'Instance options: areLegacyImdsEndpointsDisabled',
      mode: 'advanced',
      condition: { field: 'operation', value: INSTANCE_OPTIONS_OPERATIONS },
      required: false,
    },
    {
      id: 'dedicatedVmHostId',
      title: 'Dedicated Vm Host Id',
      type: 'short-input',
      placeholder: 'Existing dedicated VM host OCID; placement restrictions and capacity are enforced by OCI',
      mode: 'advanced',
      condition: { field: 'operation', value: DEDICATED_VM_HOST_ID_OPERATIONS },
      required: false,
    },
    {
      id: 'ifMatch',
      title: 'If Match',
      type: 'short-input',
      placeholder: 'ETag from a previous get response; a conflict is returned instead of overwriting changed state',
      mode: 'advanced',
      condition: { field: 'operation', value: IF_MATCH_OPERATIONS },
      required: false,
    },
    {
      id: 'timeMaintenanceRebootDue',
      title: 'Time Maintenance Reboot Due',
      type: 'short-input',
      placeholder: 'RFC3339 VM maintenance reboot schedule within the maximum returned by Get Instance Maintenance Reboot',
      mode: 'advanced',
      condition: { field: 'operation', value: TIME_MAINTENANCE_REBOOT_DUE_OPERATIONS },
      required: false,
    },
    {
      id: 'updateOperationConstraint',
      title: 'Update Operation Constraint',
      type: 'dropdown',
      placeholder: 'AVOID_DOWNTIME (default) rejects updates requiring a reboot; ALLOW_DOWNTIME permits downtime',
      options: [{ label: 'AVOID_DOWNTIME', id: 'AVOID_DOWNTIME' }, { label: 'ALLOW_DOWNTIME', id: 'ALLOW_DOWNTIME' }],
      value: () => 'AVOID_DOWNTIME',
      mode: 'advanced',
      condition: { field: 'operation', value: UPDATE_OPERATION_CONSTRAINT_OPERATIONS },
      required: false,
    },
    {
      id: 'action',
      title: 'Action',
      type: 'dropdown',
      placeholder: 'Instance action: START, STOP, SOFTSTOP, RESET, SOFTRESET, or REBOOTMIGRATE. Pools support the first five',
      options: [{ label: 'START', id: 'START' }, { label: 'STOP', id: 'STOP' }, { label: 'SOFTSTOP', id: 'SOFTSTOP' }, { label: 'RESET', id: 'RESET' }, { label: 'SOFTRESET', id: 'SOFTRESET' }, { label: 'REBOOTMIGRATE', id: 'REBOOTMIGRATE' }],
      condition: { field: 'operation', value: ACTION_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_instance_action','oci_compute_instance_pool_action'] },
    },
    {
      id: 'allowDenseRebootMigration',
      title: 'Allow Dense Reboot Migration',
      type: 'dropdown',
      placeholder: 'For RESET/SOFTRESET only: enabling DenseIO reboot migration permanently deletes local SSD data',
      options: [{ label: 'Provider default', id: '' }, { label: 'true', id: 'true' }, { label: 'false', id: 'false' }],
      mode: 'advanced',
      condition: { field: 'operation', value: ALLOW_DENSE_REBOOT_MIGRATION_OPERATIONS },
      required: false,
    },
    {
      id: 'deleteLocalStorage',
      title: 'Delete Local Storage',
      type: 'dropdown',
      placeholder: 'For REBOOTMIGRATE only: explicitly permit deletion of local storage on applicable bare metal instances',
      options: [{ label: 'Provider default', id: '' }, { label: 'true', id: 'true' }, { label: 'false', id: 'false' }],
      mode: 'advanced',
      condition: { field: 'operation', value: DELETE_LOCAL_STORAGE_OPERATIONS },
      required: false,
    },
    {
      id: 'timeScheduled',
      title: 'Time Scheduled',
      type: 'short-input',
      placeholder: 'RFC3339 REBOOTMIGRATE timestamp; omit for immediate migration',
      mode: 'advanced',
      condition: { field: 'operation', value: TIME_SCHEDULED_OPERATIONS },
      required: false,
    },
    {
      id: 'preserveBootVolume',
      title: 'Preserve Boot Volume',
      type: 'dropdown',
      placeholder: 'Preserve the boot volume on termination (default true); retained storage remains billable',
      options: [{ label: 'Provider default', id: '' }, { label: 'true', id: 'true' }, { label: 'false', id: 'false' }],
      value: () => 'true',
      mode: 'advanced',
      condition: { field: 'operation', value: PRESERVE_BOOT_VOLUME_OPERATIONS },
      required: false,
    },
    {
      id: 'preserveDataVolumesCreatedAtLaunch',
      title: 'Preserve Data Volumes Created At Launch',
      type: 'dropdown',
      placeholder: 'Preserve launch-created data volumes on termination (default true); retained storage remains billable',
      options: [{ label: 'Provider default', id: '' }, { label: 'true', id: 'true' }, { label: 'false', id: 'false' }],
      value: () => 'true',
      mode: 'advanced',
      condition: { field: 'operation', value: PRESERVE_DATA_VOLUMES_CREATED_AT_LAUNCH_OPERATIONS },
      required: false,
    },
    {
      id: 'operatingSystem',
      title: 'Operating System',
      type: 'short-input',
      placeholder: 'Exact image operating-system filter',
      mode: 'advanced',
      condition: { field: 'operation', value: OPERATING_SYSTEM_OPERATIONS },
      required: false,
    },
    {
      id: 'operatingSystemVersion',
      title: 'Operating System Version',
      type: 'short-input',
      placeholder: 'Exact image operating-system-version filter',
      mode: 'advanced',
      condition: { field: 'operation', value: OPERATING_SYSTEM_VERSION_OPERATIONS },
      required: false,
    },
    {
      id: 'shapeAvailabilities',
      title: 'Shape Availabilities',
      type: 'long-input',
      placeholder: 'Capacity queries [{instanceShape, instanceShapeConfig: {ocpus, memoryInGBs}, faultDomain}]; reports do not reserve capacity',
      condition: { field: 'operation', value: SHAPE_AVAILABILITIES_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_create_compute_capacity_report'] },
    },
    {
      id: 'instanceConfigurationIdSelector',
      title: 'Instance Configuration Id',
      type: 'project-selector',
      canonicalParamId: 'instanceConfigurationId',
      serviceId: 'oci_compute',
      selectorKey: 'oci_compute.instanceConfigurations',
      dependsOn: ['credential', 'region', 'compartmentSelector'],
      mode: 'basic',
      placeholder: 'Select Instance Configuration Id',
      condition: { field: 'operation', value: INSTANCE_CONFIGURATION_ID_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_get_instance_configuration','oci_compute_update_instance_configuration','oci_compute_delete_instance_configuration','oci_compute_launch_instance_configuration','oci_compute_change_instance_configuration_compartment','oci_compute_create_instance_pool'] },
    },
    {
      id: 'instanceConfigurationIdManual',
      title: 'Instance Configuration Id',
      type: 'short-input',
      canonicalParamId: 'instanceConfigurationId',
      mode: 'advanced',
      placeholder: 'Instance configuration OCID',
      condition: { field: 'operation', value: INSTANCE_CONFIGURATION_ID_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_get_instance_configuration','oci_compute_update_instance_configuration','oci_compute_delete_instance_configuration','oci_compute_launch_instance_configuration','oci_compute_change_instance_configuration_compartment','oci_compute_create_instance_pool'] },
    },
    {
      id: 'configurationSource',
      title: 'Configuration Source',
      type: 'dropdown',
      placeholder: 'NONE creates a typed template using instanceDetails; INSTANCE copies settings using instanceId, not disk contents',
      options: [{ label: 'NONE', id: 'NONE' }, { label: 'INSTANCE', id: 'INSTANCE' }],
      value: () => 'NONE',
      condition: { field: 'operation', value: CONFIGURATION_SOURCE_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_create_instance_configuration'] },
    },
    {
      id: 'instanceDetails',
      title: 'Instance Details',
      type: 'long-input',
      placeholder: 'Typed compute configuration: {instanceType: "compute", launchDetails: {...}, blockVolumes: [{volumeId, attachDetails: {type: "iscsi" or "paravirtualized", ...}}], secondaryVnics: [{createVnicDetails, displayName, nicIndex}]}. Deferred launch fields may be omitted. Volume creation and arbitrary provider fields are not accepted',
      mode: 'advanced',
      condition: { field: 'operation', value: INSTANCE_DETAILS_OPERATIONS },
      required: false,
    },
    {
      id: 'instancePoolIdSelector',
      title: 'Instance Pool Id',
      type: 'project-selector',
      canonicalParamId: 'instancePoolId',
      serviceId: 'oci_compute',
      selectorKey: 'oci_compute.instancePools',
      dependsOn: ['credential', 'region', 'compartmentSelector'],
      mode: 'basic',
      placeholder: 'Select Instance Pool Id',
      condition: { field: 'operation', value: INSTANCE_POOL_ID_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_get_instance_pool','oci_compute_update_instance_pool','oci_compute_instance_pool_action','oci_compute_terminate_instance_pool','oci_compute_change_instance_pool_compartment','oci_compute_list_instance_pool_instances','oci_compute_get_instance_pool_instance','oci_compute_attach_instance_pool_instance','oci_compute_detach_instance_pool_instance'] },
    },
    {
      id: 'instancePoolIdManual',
      title: 'Instance Pool Id',
      type: 'short-input',
      canonicalParamId: 'instancePoolId',
      mode: 'advanced',
      placeholder: 'Instance pool OCID',
      condition: { field: 'operation', value: INSTANCE_POOL_ID_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_get_instance_pool','oci_compute_update_instance_pool','oci_compute_instance_pool_action','oci_compute_terminate_instance_pool','oci_compute_change_instance_pool_compartment','oci_compute_list_instance_pool_instances','oci_compute_get_instance_pool_instance','oci_compute_attach_instance_pool_instance','oci_compute_detach_instance_pool_instance'] },
    },
    {
      id: 'size',
      title: 'Size',
      type: 'short-input',
      placeholder: 'Desired pool size; increasing creates billable resources and decreasing terminates members',
      condition: { field: 'operation', value: SIZE_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_create_instance_pool'] },
    },
    {
      id: 'placementConfigurations',
      title: 'Placement Configurations',
      type: 'long-input',
      placeholder: 'Placements [{availabilityDomain, faultDomains, primaryVnicSubnets: {subnetId, isAssignIpv6Ip, ipv6AddressIpv6SubnetCidrPairDetails}, secondaryVnicSubnets: [{subnetId, displayName, ...}]}]; one placement per AD',
      condition: { field: 'operation', value: PLACEMENT_CONFIGURATIONS_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_create_instance_pool'] },
    },
    {
      id: 'instanceDisplayNameFormatter',
      title: 'Instance Display Name Formatter',
      type: 'short-input',
      placeholder: 'Display-name formatter for future pool instances; empty string clears it on update',
      mode: 'advanced',
      condition: { field: 'operation', value: INSTANCE_DISPLAY_NAME_FORMATTER_OPERATIONS },
      required: false,
    },
    {
      id: 'instanceHostnameFormatter',
      title: 'Instance Hostname Formatter',
      type: 'short-input',
      placeholder: 'Hostname formatter for future pool instances; empty string clears it on update',
      mode: 'advanced',
      condition: { field: 'operation', value: INSTANCE_HOSTNAME_FORMATTER_OPERATIONS },
      required: false,
    },
    {
      id: 'isAutoTerminate',
      title: 'Is Auto Terminate',
      type: 'dropdown',
      placeholder: 'Terminate the detached instance (default false)',
      options: [{ label: 'Provider default', id: '' }, { label: 'true', id: 'true' }, { label: 'false', id: 'false' }],
      value: () => 'false',
      mode: 'advanced',
      condition: { field: 'operation', value: IS_AUTO_TERMINATE_OPERATIONS },
      required: false,
    },
    {
      id: 'isDecrementSize',
      title: 'Is Decrement Size',
      type: 'dropdown',
      placeholder: 'Reduce desired pool size when detaching (default true); false can create a billable replacement',
      options: [{ label: 'Provider default', id: '' }, { label: 'true', id: 'true' }, { label: 'false', id: 'false' }],
      value: () => 'true',
      mode: 'advanced',
      condition: { field: 'operation', value: IS_DECREMENT_SIZE_OPERATIONS },
      required: false,
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Exact compartment name filter',
      mode: 'advanced',
      condition: { field: 'operation', value: NAME_OPERATIONS },
      required: false,
    },
    {
      id: 'accessLevel',
      title: 'Access Level',
      type: 'dropdown',
      placeholder: 'ACCESSIBLE (default) lists accessible compartments; ANY requests all permitted results',
      options: [{ label: 'ACCESSIBLE', id: 'ACCESSIBLE' }, { label: 'ANY', id: 'ANY' }],
      mode: 'advanced',
      condition: { field: 'operation', value: ACCESS_LEVEL_OPERATIONS },
      required: false,
    },
    {
      id: 'compartmentIdInSubtree',
      title: 'Compartment Id In Subtree',
      type: 'dropdown',
      placeholder: 'List descendants instead of immediate children (default false); subtree listing requires the tenancy root',
      options: [{ label: 'Provider default', id: '' }, { label: 'true', id: 'true' }, { label: 'false', id: 'false' }],
      mode: 'advanced',
      condition: { field: 'operation', value: COMPARTMENT_ID_IN_SUBTREE_OPERATIONS },
      required: false,
    },
    {
      id: 'vcnId',
      title: 'Vcn Id',
      type: 'short-input',
      placeholder: 'Filter by VCN OCID',
      mode: 'advanced',
      condition: { field: 'operation', value: VCN_ID_OPERATIONS },
      required: false,
    },
    {
      id: 'subnetIdSelector',
      title: 'Subnet Id',
      type: 'project-selector',
      canonicalParamId: 'subnetId',
      serviceId: 'oci_compute',
      selectorKey: 'oci_compute.subnets',
      dependsOn: ['credential', 'region', 'compartmentSelector'],
      mode: 'basic',
      placeholder: 'Select Subnet Id',
      condition: { field: 'operation', value: SUBNET_ID_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_get_subnet', 'oci_compute_launch_instance'] },
    },
    {
      id: 'subnetIdManual',
      title: 'Subnet Id',
      type: 'short-input',
      canonicalParamId: 'subnetId',
      mode: 'advanced',
      placeholder: 'Subnet OCID',
      condition: { field: 'operation', value: SUBNET_ID_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_get_subnet', 'oci_compute_launch_instance'] },
    },
    {
      id: 'vnicId',
      title: 'Vnic Id',
      type: 'short-input',
      placeholder: 'VNIC OCID',
      condition: { field: 'operation', value: VNIC_ID_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_get_vnic'] },
    },
    {
      id: 'resourceId',
      title: 'Resource Id',
      type: 'short-input',
      placeholder: 'Filter work requests by affected resource OCID',
      mode: 'advanced',
      condition: { field: 'operation', value: RESOURCE_ID_OPERATIONS },
      required: false,
    },
    {
      id: 'workRequestId',
      title: 'Work Request Id',
      type: 'short-input',
      placeholder: 'Work request OCID returned by a supported asynchronous operation',
      condition: { field: 'operation', value: WORK_REQUEST_ID_OPERATIONS },
      required: { field: 'operation', value: ['oci_compute_get_work_request','oci_compute_list_work_request_errors','oci_compute_list_work_request_logs'] },
    },
  ],
  tools: {
    access: [
      'oci_compute_list_instances',
      'oci_compute_get_instance',
      'oci_compute_launch_instance',
      'oci_compute_update_instance',
      'oci_compute_instance_action',
      'oci_compute_terminate_instance',
      'oci_compute_change_instance_compartment',
      'oci_compute_get_instance_maintenance_reboot',
      'oci_compute_list_images',
      'oci_compute_get_image',
      'oci_compute_create_image',
      'oci_compute_update_image',
      'oci_compute_delete_image',
      'oci_compute_change_image_compartment',
      'oci_compute_list_shapes',
      'oci_compute_list_image_shape_compatibility_entries',
      'oci_compute_get_image_shape_compatibility_entry',
      'oci_compute_create_compute_capacity_report',
      'oci_compute_list_instance_configurations',
      'oci_compute_get_instance_configuration',
      'oci_compute_create_instance_configuration',
      'oci_compute_update_instance_configuration',
      'oci_compute_delete_instance_configuration',
      'oci_compute_launch_instance_configuration',
      'oci_compute_change_instance_configuration_compartment',
      'oci_compute_list_instance_pools',
      'oci_compute_get_instance_pool',
      'oci_compute_create_instance_pool',
      'oci_compute_update_instance_pool',
      'oci_compute_instance_pool_action',
      'oci_compute_terminate_instance_pool',
      'oci_compute_change_instance_pool_compartment',
      'oci_compute_list_instance_pool_instances',
      'oci_compute_get_instance_pool_instance',
      'oci_compute_attach_instance_pool_instance',
      'oci_compute_detach_instance_pool_instance',
      'oci_compute_list_availability_domains',
      'oci_compute_list_fault_domains',
      'oci_compute_list_compartments',
      'oci_compute_get_compartment',
      'oci_compute_list_subnets',
      'oci_compute_get_subnet',
      'oci_compute_list_vnic_attachments',
      'oci_compute_get_vnic',
      'oci_compute_list_boot_volume_attachments',
      'oci_compute_list_volume_attachments',
      'oci_compute_list_work_requests',
      'oci_compute_get_work_request',
      'oci_compute_list_work_request_errors',
      'oci_compute_list_work_request_logs',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const result: Record<string, unknown> = { ...params }
        for (const field of ['limit', 'bootVolumeSizeInGBs', 'bootVolumeVpusPerGB', 'size']) {
          result[field] = parseOptionalNumberInput(params[field], field, { integer: true, min: field === 'size' ? 0 : 1 })
        }
        for (const field of ['allowDenseRebootMigration', 'deleteLocalStorage', 'preserveBootVolume', 'preserveDataVolumesCreatedAtLaunch', 'isAutoTerminate', 'isDecrementSize', 'compartmentIdInSubtree']) {
          result[field] = optionalBoolean(params[field])
        }
        for (const field of ['compartmentId', 'page', 'sortBy', 'sortOrder', 'displayName', 'availabilityDomain', 'lifecycleState', 'instanceId', 'shape', 'sourceMode', 'imageId', 'imageFilter', 'bootVolumeId', 'kmsKeyId', 'freeformTags', 'definedTags', 'retryToken', 'shapeConfig', 'createVnicDetails', 'faultDomain', 'metadata', 'extendedMetadata', 'agentConfig', 'availabilityConfig', 'instanceOptions', 'dedicatedVmHostId', 'ifMatch', 'timeMaintenanceRebootDue', 'updateOperationConstraint', 'action', 'timeScheduled', 'operatingSystem', 'operatingSystemVersion', 'shapeAvailabilities', 'instanceConfigurationId', 'configurationSource', 'instanceDetails', 'instancePoolId', 'placementConfigurations', 'name', 'accessLevel', 'vcnId', 'subnetId', 'vnicId', 'resourceId', 'workRequestId']) {
          if (result[field] === '') delete result[field]
        }
        if (params.operation === 'oci_compute_launch_instance') {
          let vnic = result.createVnicDetails
          if (typeof vnic === 'string') vnic = JSON.parse(vnic)
          if (vnic !== undefined && (vnic === null || typeof vnic !== 'object' || Array.isArray(vnic))) {
            throw new Error('Primary VNIC settings must be a JSON object')
          }
          result.createVnicDetails = { ...(vnic ?? {}), subnetId: params.subnetId }
          if (params.sourceMode !== 'image') delete result.imageId
          if (params.sourceMode !== 'imageFilter') delete result.imageFilter
          if (params.sourceMode !== 'bootVolume') delete result.bootVolumeId
          if (params.sourceMode === 'bootVolume') {
            for (const field of ['bootVolumeSizeInGBs', 'bootVolumeVpusPerGB', 'kmsKeyId']) delete result[field]
          }
        }
        if (params.operation === 'oci_compute_create_instance_configuration') {
          if (params.configurationSource === 'INSTANCE') delete result.instanceDetails
          else delete result.instanceId
        }
        if (params.operation === 'oci_compute_instance_action') {
          if (params.action !== 'RESET' && params.action !== 'SOFTRESET') delete result.allowDenseRebootMigration
          if (params.action !== 'REBOOTMIGRATE') {
            delete result.deleteLocalStorage
            delete result.timeScheduled
          }
        }
        return result
      },
    },
  },
  inputs: {
    oauthCredential: { type: 'string', description: 'Authorized OCI credential ID' },
    region: { type: 'string', description: 'OCI region' },
    compartmentId: { type: 'string', description: 'Compartment OCID; use the destination for moves, parent for compartment listing, and root for capacity reports' },
    limit: { type: 'number', description: 'Maximum results in this page, 1–100; default 50' },
    page: { type: 'string', description: 'Opaque continuation token from nextPage; empty pages can still have another token' },
    sortBy: { type: 'string', description: 'Sort by TIMECREATED or DISPLAYNAME' },
    sortOrder: { type: 'string', description: 'Sort direction: ASC or DESC' },
    displayName: { type: 'string', description: 'Display name; on list operations this is an exact provider filter' },
    availabilityDomain: { type: 'string', description: 'Exact availability-domain name returned by OCI discovery' },
    lifecycleState: { type: 'string', description: 'Exact lifecycle-state filter supported by this resource' },
    capacityReservationId: { type: 'string', description: 'Existing reservation OCID; an empty string opts out on direct launch or removes the reservation on update' },
    instanceId: { type: 'string', description: 'Compute instance OCID' },
    shape: { type: 'string', description: 'Compute shape name; image, capacity, and shape compatibility are validated by OCI' },
    sourceMode: { type: 'string', description: 'Launch from image ID (image), image filter (imageFilter), or existing boot volume (bootVolume)' },
    imageId: { type: 'string', description: 'Image OCID; required for image-ID launches' },
    imageFilter: { type: 'json', description: 'Image selection criteria: compartmentId, operatingSystem, operatingSystemVersion, definedTagsFilter' },
    bootVolumeId: { type: 'string', description: 'Existing boot volume OCID in the instance availability domain; only for bootVolume launches' },
    bootVolumeSizeInGBs: { type: 'number', description: 'Image-source boot volume size in GB, 50–32768; increases storage charges' },
    bootVolumeVpusPerGB: { type: 'number', description: 'Image-source boot volume performance: 10, 20, or 30–120 VPUs/GB; affects charges' },
    kmsKeyId: { type: 'string', description: 'Existing Vault key OCID for a newly created image-source boot volume' },
    freeformTags: { type: 'json', description: 'Free-form tags as a string-to-string JSON map' },
    definedTags: { type: 'json', description: 'Defined string tags grouped by namespace, for example {Operations: {CostCenter: "42"}}' },
    retryToken: { type: 'string', description: 'Optional 1–64 character retry token. Reuse only for the same logical creation request; otherwise Sim derives an invocation key' },
    shapeConfig: { type: 'json', description: 'Shape resources: ocpus OR vcpus, memoryInGBs, baselineOcpuUtilization, nvmes; use List Shapes for valid ranges' },
    createVnicDetails: { type: 'json', description: 'Primary VNIC settings: subnetId (required), displayName, assignPublicIp, assignPrivateDnsRecord, hostnameLabel, privateIp/privateIpId/subnetCidr, nsgIds, skipSourceDestCheck, assignIpv6Ip, ipv6AddressIpv6SubnetCidrPairDetails' },
    faultDomain: { type: 'string', description: 'Fault domain within the selected availability domain' },
    metadata: { type: 'json', description: 'String-to-string metadata map; user_data is base64 and ssh_authorized_keys contains SSH public keys. Updates replace the map and must retain immutable launch keys unchanged' },
    extendedMetadata: { type: 'json', description: 'Nested metadata map; combined with metadata, at most 32000 bytes. Updates must preserve immutable launch keys' },
    agentConfig: { type: 'json', description: 'Oracle Cloud Agent settings: isMonitoringDisabled, isManagementDisabled, areAllPluginsDisabled, pluginsConfig [{name, desiredState: ENABLED or DISABLED}]' },
    availabilityConfig: { type: 'json', description: 'Availability settings: recoveryAction (RESTORE_INSTANCE or STOP_INSTANCE), isLiveMigrationPreferred' },
    instanceOptions: { type: 'json', description: 'Instance options: areLegacyImdsEndpointsDisabled' },
    dedicatedVmHostId: { type: 'string', description: 'Existing dedicated VM host OCID; placement restrictions and capacity are enforced by OCI' },
    ifMatch: { type: 'string', description: 'ETag from a previous get response; a conflict is returned instead of overwriting changed state' },
    timeMaintenanceRebootDue: { type: 'string', description: 'RFC3339 VM maintenance reboot schedule within the maximum returned by Get Instance Maintenance Reboot' },
    updateOperationConstraint: { type: 'string', description: 'AVOID_DOWNTIME (default) rejects updates requiring a reboot; ALLOW_DOWNTIME permits downtime' },
    action: { type: 'string', description: 'Instance action: START, STOP, SOFTSTOP, RESET, SOFTRESET, or REBOOTMIGRATE. Pools support the first five' },
    allowDenseRebootMigration: { type: 'boolean', description: 'For RESET/SOFTRESET only: enabling DenseIO reboot migration permanently deletes local SSD data' },
    deleteLocalStorage: { type: 'boolean', description: 'For REBOOTMIGRATE only: explicitly permit deletion of local storage on applicable bare metal instances' },
    timeScheduled: { type: 'string', description: 'RFC3339 REBOOTMIGRATE timestamp; omit for immediate migration' },
    preserveBootVolume: { type: 'boolean', description: 'Preserve the boot volume on termination (default true); retained storage remains billable' },
    preserveDataVolumesCreatedAtLaunch: { type: 'boolean', description: 'Preserve launch-created data volumes on termination (default true); retained storage remains billable' },
    operatingSystem: { type: 'string', description: 'Exact image operating-system filter' },
    operatingSystemVersion: { type: 'string', description: 'Exact image operating-system-version filter' },
    shapeAvailabilities: { type: 'json', description: 'Capacity queries [{instanceShape, instanceShapeConfig: {ocpus, memoryInGBs}, faultDomain}]; reports do not reserve capacity' },
    instanceConfigurationId: { type: 'string', description: 'Instance configuration OCID' },
    configurationSource: { type: 'string', description: 'NONE creates a typed template using instanceDetails; INSTANCE copies settings using instanceId, not disk contents' },
    instanceDetails: { type: 'json', description: 'Typed compute configuration: {instanceType: "compute", launchDetails: {...}, blockVolumes: [{volumeId, attachDetails: {type: "iscsi" or "paravirtualized", ...}}], secondaryVnics: [{createVnicDetails, displayName, nicIndex}]}. Deferred launch fields may be omitted. Volume creation and arbitrary provider fields are not accepted' },
    instancePoolId: { type: 'string', description: 'Instance pool OCID' },
    size: { type: 'number', description: 'Desired pool size; increasing creates billable resources and decreasing terminates members' },
    placementConfigurations: { type: 'json', description: 'Placements [{availabilityDomain, faultDomains, primaryVnicSubnets: {subnetId, isAssignIpv6Ip, ipv6AddressIpv6SubnetCidrPairDetails}, secondaryVnicSubnets: [{subnetId, displayName, ...}]}]; one placement per AD' },
    instanceDisplayNameFormatter: { type: 'string', description: 'Display-name formatter for future pool instances; empty string clears it on update' },
    instanceHostnameFormatter: { type: 'string', description: 'Hostname formatter for future pool instances; empty string clears it on update' },
    isAutoTerminate: { type: 'boolean', description: 'Terminate the detached instance (default false)' },
    isDecrementSize: { type: 'boolean', description: 'Reduce desired pool size when detaching (default true); false can create a billable replacement' },
    name: { type: 'string', description: 'Exact compartment name filter' },
    accessLevel: { type: 'string', description: 'ACCESSIBLE (default) lists accessible compartments; ANY requests all permitted results' },
    compartmentIdInSubtree: { type: 'boolean', description: 'List descendants instead of immediate children (default false); subtree listing requires the tenancy root' },
    vcnId: { type: 'string', description: 'Filter by VCN OCID' },
    subnetId: { type: 'string', description: 'Subnet OCID' },
    vnicId: { type: 'string', description: 'VNIC OCID' },
    resourceId: { type: 'string', description: 'Filter work requests by affected resource OCID' },
    workRequestId: { type: 'string', description: 'Work request OCID returned by a supported asynchronous operation' },
  },
  outputs: {
    status: { type: 'number', description: 'OCI HTTP status' },
    requestId: { type: 'string', description: 'Oracle request ID' },
    etag: { type: 'string', description: 'Resource ETag, when returned' },
    nextPage: { type: 'string', description: 'Continuation token, including on empty pages' },
    workRequestId: { type: 'string', description: 'Work request OCID, when returned' },
    retryToken: { type: 'string', description: 'Token used for a supported creation request' },
    location: { type: 'string', description: 'Pool member location, when returned' },
    instances: { type: 'json', description: 'Instances returned by OCI' },
    instance: { type: 'json', description: 'Instance returned by OCI' },
    maintenanceReboot: { type: 'json', description: 'Maintenance Reboot returned by OCI' },
    images: { type: 'json', description: 'Images returned by OCI' },
    image: { type: 'json', description: 'Image returned by OCI' },
    shapes: { type: 'json', description: 'Shapes returned by OCI' },
    compatibilityEntries: { type: 'json', description: 'Compatibility Entries returned by OCI' },
    compatibilityEntry: { type: 'json', description: 'Compatibility Entry returned by OCI' },
    capacityReport: { type: 'json', description: 'Capacity Report returned by OCI' },
    instanceConfigurations: { type: 'json', description: 'Instance Configurations returned by OCI' },
    instanceConfiguration: { type: 'json', description: 'Instance Configuration returned by OCI' },
    instancePools: { type: 'json', description: 'Instance Pools returned by OCI' },
    instancePool: { type: 'json', description: 'Instance Pool returned by OCI' },
    poolInstances: { type: 'json', description: 'Pool Instances returned by OCI' },
    poolInstance: { type: 'json', description: 'Pool Instance returned by OCI' },
    availabilityDomains: { type: 'json', description: 'Availability Domains returned by OCI' },
    faultDomains: { type: 'json', description: 'Fault Domains returned by OCI' },
    compartments: { type: 'json', description: 'Compartments returned by OCI' },
    compartment: { type: 'json', description: 'Compartment returned by OCI' },
    subnets: { type: 'json', description: 'Subnets returned by OCI' },
    subnet: { type: 'json', description: 'Subnet returned by OCI' },
    vnicAttachments: { type: 'json', description: 'Vnic Attachments returned by OCI' },
    vnic: { type: 'json', description: 'Vnic returned by OCI' },
    bootVolumeAttachments: { type: 'json', description: 'Boot Volume Attachments returned by OCI' },
    volumeAttachments: { type: 'json', description: 'Volume Attachments returned by OCI' },
    workRequests: { type: 'json', description: 'Work Requests returned by OCI' },
    workRequest: { type: 'json', description: 'Work Request returned by OCI' },
    workRequestErrors: { type: 'json', description: 'Work Request Errors returned by OCI' },
    workRequestLogs: { type: 'json', description: 'Work Request Logs returned by OCI' },
  },
}

export const OciComputeBlockMeta = {
  tags: ['automation', 'monitoring'],
  url: 'https://www.oracle.com/cloud/compute/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Inventory OCI instances',
      prompt: 'On a schedule, list one page of instances in a chosen compartment, retrieve details for selected instances, and write their shape and lifecycle state to a table.',
      modules: ['workflows', 'tables'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Launch approved compute',
      prompt: 'When a compute request is approved, inspect image-shape compatibility and capacity, launch from the approved image and existing subnet, and record the instance ID and provisioning state.',
      modules: ['workflows', 'tables'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Capture a reusable image',
      prompt: 'After an approved maintenance window, capture a custom image from a stopped instance, retrieve its state in a later run, and record its image ID when available.',
      modules: ['workflows', 'tables'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Resize an instance pool',
      prompt: 'When an approved capacity request arrives, get the pool and ETag, apply the requested size with explicit scale-down termination consent, and report the new pool state.',
      modules: ['workflows', 'tables'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Manage maintenance reboots',
      prompt: 'On a schedule, inspect instance maintenance-reboot information, identify due maintenance, and report the affected instances for operator approval.',
      modules: ['workflows', 'tables'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Launch from a configuration',
      prompt: 'For an approved environment request, retrieve an instance configuration, supply its deferred values through typed launch overrides, launch it with a stable retry token, and record the returned instance ID.',
      modules: ['workflows', 'tables'],
      category: 'engineering',
      tags: ['automation'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Inspect provisioning failures',
      prompt: 'When a work request ID is recorded, get its current status, list one page of errors and logs, and produce a correlated diagnostic report without resubmitting the mutation.',
      modules: ['workflows', 'tables'],
      category: 'engineering',
      tags: ['automation'],
    },
  ],
  skills: [
    {
      name: 'inventory-oci-instances',
      description: 'Inventory a compartment without unbounded discovery',
      content: '# Inventory a compartment without unbounded discovery\n\n## Steps\n\n1. List Instances in the chosen region and compartment with limit 50.\n2. Return nextPage even if no instances are returned.\n3. Get Instance only for selected IDs.\n\n## Output\n\nReport IDs, shapes, lifecycle states, and the continuation token.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/listinginstances.htm',
    },
    {
      name: 'launch-oci-instances',
      description: 'Launch approved instances with explicit placement and retry identity',
      content: '# Launch approved instances with explicit placement and retry identity\n\n## Steps\n\n1. List Shapes and inspect image-shape compatibility.\n2. Discover the availability domain and existing subnet. Capacity reports are advisory, not reservations.\n3. Choose image, image filter, or boot volume. Obtain authorization for costs and provide only typed launch fields.\n4. Retain the retry token and request ID. Check Get Instance in a later workflow step; do not wait indefinitely or blindly resubmit.\n\n## Output\n\nReturn the instance ID and current lifecycle state.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/launchinginstance.htm',
    },
    {
      name: 'capture-oci-images',
      description: 'Capture reusable custom images during an approved maintenance window',
      content: '# Capture reusable custom images during an approved maintenance window\n\n## Steps\n\n1. Get Instance and confirm the requested source.\n2. Confirm downtime and storage costs before Create Image.\n3. Use Get Image in a later execution to check availability.\n\n## Output\n\nReturn image ID, lifecycle state, and request ID.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/managingcustomimages.htm',
    },
    {
      name: 'resize-oci-pools',
      description: 'Apply approved instance-pool capacity changes',
      content: '# Apply approved instance-pool capacity changes\n\n## Steps\n\n1. Get Instance Pool and its ETag.\n2. Confirm desired size and that reducing size terminates instances.\n3. Update Instance Pool with ifMatch.\n4. List members and report progress without automatic resubmission.\n\n## Output\n\nReturn size, lifecycle state, and member discovery cursor.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/resizinginstancepools.htm',
    },
    {
      name: 'launch-oci-configurations',
      description: 'Supply deferred configuration values without changing immutable settings',
      content: '# Supply deferred configuration values without changing immutable settings\n\n## Steps\n\n1. Get Instance Configuration and inspect deferredFields.\n2. Supply typed instanceDetails overrides for missing launch, existing-volume, and VNIC values.\n3. Launch Instance Configuration using a stable token. Configuration updates support only name and tags.\n\n## Output\n\nReturn instance ID, state, and any work request ID.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/creatinginstanceconfig.htm',
    },
    {
      name: 'inspect-oci-work-requests',
      description: 'Diagnose asynchronous work without replaying ambiguous mutations',
      content: '# Diagnose asynchronous work without replaying ambiguous mutations\n\n## Steps\n\n1. Get Work Request using its returned ID.\n2. List one bounded page of errors and logs.\n3. Correlate the resource ID and request ID. An absent work request header is not evidence of failure.\n\n## Output\n\nReport current status, errors, log cursor, and any uncertainty.\n\nSource: https://docs.oracle.com/en-us/iaas/Content/General/Concepts/workrequestoverview.htm',
    },
  ],
} as const satisfies BlockMeta
