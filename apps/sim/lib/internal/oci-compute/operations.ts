import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import { deriveDeliveryKey } from '@/lib/core/http/derive-key'
import type { OciClient, OciRequest, OciRequestMethod } from '@/lib/internal/oci/client.server'
import { createOciStaticEndpointPolicy } from '@/lib/internal/oci/endpoints'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  type OciComputeInput,
  type OciComputeOperation,
  validateOciComputeMetadata,
} from '@/lib/internal/oci-compute/schema'
import {
  AVAILABILITY_DOMAIN_OUTPUT_PROPERTIES,
  BOOT_VOLUME_ATTACHMENT_OUTPUT_PROPERTIES,
  CAPACITY_REPORT_OUTPUT_PROPERTIES,
  COMPARTMENT_OUTPUT_PROPERTIES,
  COMPATIBILITY_ENTRY_OUTPUT_PROPERTIES,
  FAULT_DOMAIN_OUTPUT_PROPERTIES,
  IMAGE_OUTPUT_PROPERTIES,
  INSTANCE_CONFIGURATION_OUTPUT_PROPERTIES,
  INSTANCE_CONFIGURATION_SUMMARY_OUTPUT_PROPERTIES,
  INSTANCE_OUTPUT_PROPERTIES,
  INSTANCE_POOL_OUTPUT_PROPERTIES,
  INSTANCE_POOL_SUMMARY_OUTPUT_PROPERTIES,
  MAINTENANCE_REBOOT_OUTPUT_PROPERTIES,
  OCI_COMPUTE_SERVICE_ID,
  type OciComputeResponse,
  POOL_INSTANCE_OUTPUT_PROPERTIES,
  POOL_INSTANCE_SUMMARY_OUTPUT_PROPERTIES,
  SHAPE_OUTPUT_PROPERTIES,
  SUBNET_OUTPUT_PROPERTIES,
  VNIC_ATTACHMENT_OUTPUT_PROPERTIES,
  VNIC_OUTPUT_PROPERTIES,
  VOLUME_ATTACHMENT_OUTPUT_PROPERTIES,
  WORK_REQUEST_ERROR_OUTPUT_PROPERTIES,
  WORK_REQUEST_LOG_OUTPUT_PROPERTIES,
  WORK_REQUEST_OUTPUT_PROPERTIES,
  WORK_REQUEST_SUMMARY_OUTPUT_PROPERTIES,
} from '@/tools/oci_compute/types'
import type { ToolOutputProperty } from '@/tools/types'

const CORE_ENDPOINT = createOciStaticEndpointPolicy({
  serviceId: OCI_COMPUTE_SERVICE_ID,
  serviceName: 'iaas',
  hostnameTemplate: 'regional',
})
const IDENTITY_ENDPOINT = createOciStaticEndpointPolicy({
  serviceId: OCI_COMPUTE_SERVICE_ID,
  serviceName: 'identity',
  hostnameTemplate: 'regional-oci',
})

interface ComputeOperation {
  method: OciRequestMethod
  path: string
  body?: readonly string[]
  query?: readonly string[]
  output?: keyof OciComputeResponse['output']
  projection?: Record<string, ToolOutputProperty>
  list?: boolean
  token?: boolean
  work?: boolean
  etag?: boolean
  identity?: boolean
  location?: boolean
}

/** Explicit Core, Compute Management, Virtual Network, IAM and Work Requests API declarations. */
export const OCI_COMPUTE_OPERATIONS: Record<OciComputeOperation, ComputeOperation> = {
  list_instances: {
    method: 'GET',
    path: '/instances/',
    query: [
      'compartmentId',
      'limit',
      'page',
      'sortBy',
      'sortOrder',
      'displayName',
      'availabilityDomain',
      'lifecycleState',
      'capacityReservationId',
    ],
    output: 'instances',
    projection: INSTANCE_OUTPUT_PROPERTIES,
    list: true,
  },
  get_instance: {
    method: 'GET',
    path: '/instances/{instanceId}',
    output: 'instance',
    projection: INSTANCE_OUTPUT_PROPERTIES,
  },
  launch_instance: {
    method: 'POST',
    path: '/instances/',
    body: [
      'compartmentId',
      'availabilityDomain',
      'shape',
      'displayName',
      'freeformTags',
      'definedTags',
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
    ],
    output: 'instance',
    projection: INSTANCE_OUTPUT_PROPERTIES,
    token: true,
    work: true,
  },
  update_instance: {
    token: true,
    method: 'PUT',
    path: '/instances/{instanceId}',
    body: [
      'displayName',
      'freeformTags',
      'definedTags',
      'shape',
      'shapeConfig',
      'faultDomain',
      'metadata',
      'extendedMetadata',
      'agentConfig',
      'availabilityConfig',
      'instanceOptions',
      'capacityReservationId',
      'dedicatedVmHostId',
      'timeMaintenanceRebootDue',
      'updateOperationConstraint',
    ],
    output: 'instance',
    projection: INSTANCE_OUTPUT_PROPERTIES,
    work: true,
    etag: true,
  },
  instance_action: {
    token: true,
    method: 'POST',
    path: '/instances/{instanceId}',
    query: ['action'],
    output: 'instance',
    projection: INSTANCE_OUTPUT_PROPERTIES,
    etag: true,
  },
  terminate_instance: {
    method: 'DELETE',
    path: '/instances/{instanceId}',
    query: ['preserveBootVolume', 'preserveDataVolumesCreatedAtLaunch'],
    work: true,
    etag: true,
  },
  change_instance_compartment: {
    token: true,
    method: 'POST',
    path: '/instances/{instanceId}/actions/changeCompartment',
    body: ['compartmentId'],
    work: true,
    etag: true,
  },
  get_instance_maintenance_reboot: {
    method: 'GET',
    path: '/instances/{instanceId}/maintenanceReboot',
    output: 'maintenanceReboot',
    projection: MAINTENANCE_REBOOT_OUTPUT_PROPERTIES,
  },
  list_images: {
    method: 'GET',
    path: '/images',
    query: [
      'compartmentId',
      'limit',
      'page',
      'sortBy',
      'sortOrder',
      'displayName',
      'operatingSystem',
      'operatingSystemVersion',
      'shape',
      'lifecycleState',
    ],
    output: 'images',
    projection: IMAGE_OUTPUT_PROPERTIES,
    list: true,
  },
  get_image: {
    method: 'GET',
    path: '/images/{imageId}',
    output: 'image',
    projection: IMAGE_OUTPUT_PROPERTIES,
  },
  create_image: {
    method: 'POST',
    path: '/images',
    body: ['instanceId', 'compartmentId', 'displayName', 'freeformTags', 'definedTags'],
    output: 'image',
    projection: IMAGE_OUTPUT_PROPERTIES,
    token: true,
    work: true,
  },
  update_image: {
    token: true,
    method: 'PUT',
    path: '/images/{imageId}',
    body: ['displayName', 'freeformTags', 'definedTags'],
    output: 'image',
    projection: IMAGE_OUTPUT_PROPERTIES,
    etag: true,
  },
  delete_image: {
    method: 'DELETE',
    path: '/images/{imageId}',
    etag: true,
  },
  change_image_compartment: {
    token: true,
    method: 'POST',
    path: '/images/{imageId}/actions/changeCompartment',
    body: ['compartmentId'],
    etag: true,
  },
  list_shapes: {
    method: 'GET',
    path: '/shapes',
    query: ['compartmentId', 'limit', 'page', 'availabilityDomain', 'imageId', 'shape'],
    output: 'shapes',
    projection: SHAPE_OUTPUT_PROPERTIES,
    list: true,
  },
  list_image_shape_compatibility_entries: {
    method: 'GET',
    path: '/images/{imageId}/shapes',
    query: ['limit', 'page'],
    output: 'compatibilityEntries',
    projection: COMPATIBILITY_ENTRY_OUTPUT_PROPERTIES,
    list: true,
  },
  get_image_shape_compatibility_entry: {
    method: 'GET',
    path: '/images/{imageId}/shapes/{shape}',
    output: 'compatibilityEntry',
    projection: COMPATIBILITY_ENTRY_OUTPUT_PROPERTIES,
  },
  create_compute_capacity_report: {
    method: 'POST',
    path: '/computeCapacityReports',
    body: ['compartmentId', 'availabilityDomain', 'shapeAvailabilities'],
    output: 'capacityReport',
    projection: CAPACITY_REPORT_OUTPUT_PROPERTIES,
    token: true,
  },
  list_instance_configurations: {
    method: 'GET',
    path: '/instanceConfigurations',
    query: ['compartmentId', 'limit', 'page', 'sortBy', 'sortOrder'],
    output: 'instanceConfigurations',
    projection: INSTANCE_CONFIGURATION_SUMMARY_OUTPUT_PROPERTIES,
    list: true,
  },
  get_instance_configuration: {
    method: 'GET',
    path: '/instanceConfigurations/{instanceConfigurationId}',
    output: 'instanceConfiguration',
    projection: INSTANCE_CONFIGURATION_OUTPUT_PROPERTIES,
  },
  create_instance_configuration: {
    method: 'POST',
    path: '/instanceConfigurations',
    body: [
      'compartmentId',
      'displayName',
      'freeformTags',
      'definedTags',
      'instanceId',
      'instanceDetails',
    ],
    output: 'instanceConfiguration',
    projection: INSTANCE_CONFIGURATION_OUTPUT_PROPERTIES,
    token: true,
  },
  update_instance_configuration: {
    token: true,
    method: 'PUT',
    path: '/instanceConfigurations/{instanceConfigurationId}',
    body: ['displayName', 'freeformTags', 'definedTags'],
    output: 'instanceConfiguration',
    projection: INSTANCE_CONFIGURATION_OUTPUT_PROPERTIES,
    etag: true,
  },
  delete_instance_configuration: {
    method: 'DELETE',
    path: '/instanceConfigurations/{instanceConfigurationId}',
    etag: true,
  },
  launch_instance_configuration: {
    method: 'POST',
    path: '/instanceConfigurations/{instanceConfigurationId}/actions/launch',
    output: 'instance',
    projection: INSTANCE_OUTPUT_PROPERTIES,
    token: true,
    work: true,
  },
  change_instance_configuration_compartment: {
    token: true,
    method: 'POST',
    path: '/instanceConfigurations/{instanceConfigurationId}/actions/changeCompartment',
    body: ['compartmentId'],
    etag: true,
  },
  list_instance_pools: {
    method: 'GET',
    path: '/instancePools',
    query: [
      'compartmentId',
      'limit',
      'page',
      'sortBy',
      'sortOrder',
      'displayName',
      'lifecycleState',
    ],
    output: 'instancePools',
    projection: INSTANCE_POOL_SUMMARY_OUTPUT_PROPERTIES,
    list: true,
  },
  get_instance_pool: {
    method: 'GET',
    path: '/instancePools/{instancePoolId}',
    output: 'instancePool',
    projection: INSTANCE_POOL_OUTPUT_PROPERTIES,
  },
  create_instance_pool: {
    method: 'POST',
    path: '/instancePools',
    body: [
      'instanceConfigurationId',
      'compartmentId',
      'displayName',
      'freeformTags',
      'definedTags',
      'size',
      'placementConfigurations',
      'instanceDisplayNameFormatter',
      'instanceHostnameFormatter',
    ],
    output: 'instancePool',
    projection: INSTANCE_POOL_OUTPUT_PROPERTIES,
    token: true,
  },
  update_instance_pool: {
    token: true,
    method: 'PUT',
    path: '/instancePools/{instancePoolId}',
    body: [
      'displayName',
      'freeformTags',
      'definedTags',
      'instanceConfigurationId',
      'size',
      'placementConfigurations',
      'instanceDisplayNameFormatter',
      'instanceHostnameFormatter',
    ],
    output: 'instancePool',
    projection: INSTANCE_POOL_OUTPUT_PROPERTIES,
    etag: true,
  },
  instance_pool_action: {
    token: true,
    method: 'POST',
    path: '/instancePools/{instancePoolId}/actions/{action}',
    output: 'instancePool',
    projection: INSTANCE_POOL_OUTPUT_PROPERTIES,
    etag: true,
  },
  terminate_instance_pool: {
    method: 'DELETE',
    path: '/instancePools/{instancePoolId}',
    etag: true,
  },
  change_instance_pool_compartment: {
    token: true,
    method: 'POST',
    path: '/instancePools/{instancePoolId}/actions/changeCompartment',
    body: ['compartmentId'],
    etag: true,
  },
  list_instance_pool_instances: {
    method: 'GET',
    path: '/instancePools/{instancePoolId}/instances',
    query: ['compartmentId', 'limit', 'page', 'sortBy', 'sortOrder', 'displayName'],
    output: 'poolInstances',
    projection: POOL_INSTANCE_SUMMARY_OUTPUT_PROPERTIES,
    list: true,
  },
  get_instance_pool_instance: {
    method: 'GET',
    path: '/instancePools/{instancePoolId}/instances/{instanceId}',
    output: 'poolInstance',
    projection: POOL_INSTANCE_OUTPUT_PROPERTIES,
  },
  attach_instance_pool_instance: {
    token: true,
    method: 'POST',
    path: '/instancePools/{instancePoolId}/instances',
    body: ['instanceId'],
    output: 'poolInstance',
    projection: POOL_INSTANCE_OUTPUT_PROPERTIES,
    work: true,
    location: true,
  },
  detach_instance_pool_instance: {
    token: true,
    method: 'POST',
    path: '/instancePools/{instancePoolId}/actions/detachInstance',
    body: ['instanceId', 'isAutoTerminate', 'isDecrementSize'],
    work: true,
  },
  list_availability_domains: {
    method: 'GET',
    path: '/availabilityDomains',
    query: ['compartmentId'],
    output: 'availabilityDomains',
    projection: AVAILABILITY_DOMAIN_OUTPUT_PROPERTIES,
    identity: true,
    list: true,
  },
  list_fault_domains: {
    method: 'GET',
    path: '/faultDomains',
    query: ['compartmentId', 'availabilityDomain'],
    output: 'faultDomains',
    projection: FAULT_DOMAIN_OUTPUT_PROPERTIES,
    identity: true,
    list: true,
  },
  list_compartments: {
    method: 'GET',
    path: '/compartments',
    query: ['compartmentId', 'limit', 'page', 'name', 'lifecycleState', 'accessLevel', 'compartmentIdInSubtree'],
    output: 'compartments',
    projection: COMPARTMENT_OUTPUT_PROPERTIES,
    identity: true,
    list: true,
  },
  get_compartment: {
    method: 'GET',
    path: '/compartments/{compartmentId}',
    output: 'compartment',
    projection: COMPARTMENT_OUTPUT_PROPERTIES,
    identity: true,
  },
  list_subnets: {
    method: 'GET',
    path: '/subnets',
    query: ['compartmentId', 'limit', 'page', 'sortBy', 'sortOrder', 'displayName', 'vcnId', 'lifecycleState'],
    output: 'subnets',
    projection: SUBNET_OUTPUT_PROPERTIES,
    list: true,
  },
  get_subnet: {
    method: 'GET',
    path: '/subnets/{subnetId}',
    output: 'subnet',
    projection: SUBNET_OUTPUT_PROPERTIES,
  },
  list_vnic_attachments: {
    method: 'GET',
    path: '/vnicAttachments/',
    query: ['compartmentId', 'limit', 'page', 'instanceId', 'availabilityDomain'],
    output: 'vnicAttachments',
    projection: VNIC_ATTACHMENT_OUTPUT_PROPERTIES,
    list: true,
  },
  get_vnic: {
    method: 'GET',
    path: '/vnics/{vnicId}',
    output: 'vnic',
    projection: VNIC_OUTPUT_PROPERTIES,
  },
  list_boot_volume_attachments: {
    method: 'GET',
    path: '/bootVolumeAttachments/',
    query: ['compartmentId', 'limit', 'page', 'instanceId', 'availabilityDomain'],
    output: 'bootVolumeAttachments',
    projection: BOOT_VOLUME_ATTACHMENT_OUTPUT_PROPERTIES,
    list: true,
  },
  list_volume_attachments: {
    method: 'GET',
    path: '/volumeAttachments/',
    query: ['compartmentId', 'limit', 'page', 'instanceId', 'availabilityDomain'],
    output: 'volumeAttachments',
    projection: VOLUME_ATTACHMENT_OUTPUT_PROPERTIES,
    list: true,
  },
  list_work_requests: {
    method: 'GET',
    path: '/workRequests',
    query: ['compartmentId', 'limit', 'page', 'resourceId'],
    output: 'workRequests',
    projection: WORK_REQUEST_SUMMARY_OUTPUT_PROPERTIES,
    list: true,
  },
  get_work_request: {
    method: 'GET',
    path: '/workRequests/{workRequestId}',
    output: 'workRequest',
    projection: WORK_REQUEST_OUTPUT_PROPERTIES,
  },
  list_work_request_errors: {
    method: 'GET',
    path: '/workRequests/{workRequestId}/errors',
    query: ['limit', 'page'],
    output: 'workRequestErrors',
    projection: WORK_REQUEST_ERROR_OUTPUT_PROPERTIES,
    list: true,
  },
  list_work_request_logs: {
    method: 'GET',
    path: '/workRequests/{workRequestId}/logs',
    query: ['limit', 'page'],
    output: 'workRequestLogs',
    projection: WORK_REQUEST_LOG_OUTPUT_PROPERTIES,
    list: true,
  },
}

function select(input: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of keys) if (input[key] !== undefined) result[key] = input[key]
  return result
}

function parseResource(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body))
  } catch {
    throw new Error('OCI returned an invalid JSON response')
  }
}

/** Projects documented resource properties without reflecting arbitrary upstream fields. */
export function projectOciComputeResource(value: unknown, properties: Record<string, ToolOutputProperty>): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error('OCI returned an invalid resource object')
  const result: Record<string, unknown> = {}
  for (const [key, property] of Object.entries(properties)) {
    const field = value[key]
    if (property.type === 'array') {
      if (field !== undefined && field !== null && !Array.isArray(field)) throw new Error('OCI returned an invalid resource array')
      const values: unknown[] = Array.isArray(field) ? field : []
      const item = property.items
      result[key] = item?.properties
        ? values.map((entry) => projectOciComputeResource(entry, item.properties ?? {}))
        : values.map((entry) => {
            if (typeof entry !== 'string') throw new Error('OCI returned an invalid string array')
            return entry
          })
    } else if (property.type === 'json') {
      if (field === undefined || field === null) result[key] = null
      else if (property.properties) result[key] = projectOciComputeResource(field, property.properties)
      else {
        if (!isPlainRecord(field)) throw new Error('OCI returned invalid resource tags')
        result[key] = field
      }
    } else {
      if (field !== undefined && field !== null && typeof field !== property.type) throw new Error('OCI returned an invalid resource field')
      result[key] = field ?? null
    }
  }
  return result
}

/** Identity is for provider deduplication, never credential or workspace authorization. */
export function resolveOciComputeRetryToken(operation: OciComputeOperation, input: OciComputeInput): string {
  if ('retryToken' in input && input.retryToken) return input.retryToken
  if (input.deliveryIdentity) {
    return deriveDeliveryKey({ ...input.deliveryIdentity, toolId: `oci_compute_${operation}` }, operation)
  }
  return generateId()
}

function requestBody(operation: OciComputeOperation, input: Record<string, unknown>, definition: ComputeOperation): Record<string, unknown> | undefined {
  const body = select(input, definition.body ?? [])
  if (operation === 'launch_instance') {
    body.sourceDetails = input.sourceMode === 'bootVolume'
      ? { sourceType: 'bootVolume', bootVolumeId: input.bootVolumeId }
      : {
          sourceType: 'image',
          ...select(input, ['bootVolumeSizeInGBs', 'bootVolumeVpusPerGB', 'kmsKeyId']),
          ...(input.sourceMode === 'image' ? { imageId: input.imageId } : { instanceSourceImageFilterDetails: input.imageFilter }),
        }
  }
  if (operation === 'create_instance_configuration') body.source = input.configurationSource
  if (operation === 'launch_instance_configuration') return input.instanceDetails as Record<string, unknown>
  if (operation === 'instance_action') {
    if (input.action === 'REBOOTMIGRATE') return { actionType: 'rebootMigrate', ...select(input, ['deleteLocalStorage', 'timeScheduled']) }
    if (input.allowDenseRebootMigration !== undefined) return {
      actionType: input.action === 'RESET' ? 'reset' : 'softreset',
      allowDenseRebootMigration: input.allowDenseRebootMigration,
    }
    return undefined
  }
  return Object.keys(body).length ? body : undefined
}

/** Returns accepted operation results, never waits for provisioning or performs cleanup mutations. */
export async function executeOciComputeOperation(
  client: OciClient,
  operation: OciComputeOperation,
  input: OciComputeInput,
  signal?: AbortSignal
): Promise<OciComputeResponse> {
  const definition = OCI_COMPUTE_OPERATIONS[operation]
  const retryToken = definition.token ? resolveOciComputeRetryToken(operation, input) : undefined
  let dispatched = false
  let receivedStatus: number | undefined
  let receivedRequestId: string | undefined
  try {
    signal?.throwIfAborted()
    validateOciComputeMetadata(input)
    const endpoint = await client.prepareStaticEndpoint(definition.identity ? IDENTITY_ENDPOINT : CORE_ENDPOINT)
    signal?.throwIfAborted()
    const values: Record<string, unknown> = input
    const headers: Record<string, string> = {}
    if (definition.etag && typeof values.ifMatch === 'string') headers['if-match'] = values.ifMatch
    if (operation === 'update_instance' && (values.metadata !== undefined || values.extendedMetadata !== undefined)) {
      const current = await client.request({
        endpoint, method: 'GET', encodedPath: `/20160918/instances/${encodeURIComponent(String(values.instanceId))}`,
        timeoutMs: 30_000, maxResponseBytes: 2_000_000, signal, retry: { kind: 'safe', maxAttempts: 2 },
      })
      const existing = parseResource(current.body)
      if (!isPlainRecord(existing)) throw new Error('OCI returned an invalid instance')
      for (const field of ['metadata', 'extendedMetadata']) {
        if (values[field] === undefined) continue
        const before = isPlainRecord(existing[field]) ? existing[field] : {}
        const after = isPlainRecord(values[field]) ? values[field] : {}
        for (const key of ['user_data', 'ssh_authorized_keys']) {
          if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw new Error(`Updating ${field} must preserve existing user_data and ssh_authorized_keys`)
        }
      }
      validateOciComputeMetadata({
        metadata: values.metadata ?? existing.metadata,
        extendedMetadata: values.extendedMetadata ?? existing.extendedMetadata,
      })
      if (!headers['if-match']) {
        if (!current.headers.etag) throw new Error('OCI did not return an ETag for the metadata update')
        headers['if-match'] = current.headers.etag
      }
    }
    const path = definition.path.replace(/\{(\w+)\}/g, (_match, key: string) => {
      const value = operation === 'instance_pool_action' && key === 'action'
        ? String(values[key]).toLowerCase()
        : String(values[key])
      return encodeURIComponent(value)
    })
    const queryPairs: [string, string][] = []
    for (const key of definition.query ?? []) {
      if (values[key] !== undefined) queryPairs.push([key, String(values[key])])
    }
    const base = {
      endpoint, encodedPath: `/20160918${path}`, queryPairs, headers,
      timeoutMs: 30_000, maxResponseBytes: 2_000_000, signal,
      responseHeaders: [
        ...(definition.query?.includes('page') ? ['opc-next-page'] : []),
        ...(definition.work ? ['opc-work-request-id'] : []),
        ...(definition.location ? ['location'] : []),
      ],
    }
    const body = requestBody(operation, values, definition)
    const request: OciRequest = definition.method === 'GET'
      ? { ...base, method: 'GET', retry: { kind: 'safe', maxAttempts: 2 } }
      : definition.method === 'DELETE'
        ? { ...base, method: 'DELETE' }
        : {
            ...base, method: definition.method as 'POST' | 'PUT',
            body: body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body)),
            contentType: 'application/json',
            ...(retryToken ? { retry: { kind: 'tokenized' as const, maxAttempts: 2, retryToken } } : {}),
          }
    signal?.throwIfAborted()
    dispatched = true
    const response = await client.request(request)
    receivedStatus = response.status
    receivedRequestId = response.opcRequestId ?? response.headers['opc-request-id']
    const output: OciComputeResponse['output'] = {
      status: response.status,
      requestId: response.opcRequestId ?? response.headers['opc-request-id'] ?? null,
      etag: response.headers.etag ?? null,
      ...(definition.query?.includes('page') ? { nextPage: response.headers['opc-next-page'] ?? null } : {}),
      ...(definition.work ? { workRequestId: response.headers['opc-work-request-id'] ?? null } : {}),
      ...(definition.location ? { location: response.headers.location ?? null } : {}),
      ...(retryToken ? { retryToken } : {}),
    }
    if (definition.output && definition.projection) {
      const data = parseResource(response.body)
      if (definition.list && (!Array.isArray(data) || data.length > 100)) throw new Error('OCI returned an invalid or oversized resource page')
      const resource = definition.list && Array.isArray(data)
        ? data.map((entry) => projectOciComputeResource(entry, definition.projection ?? {}))
        : projectOciComputeResource(data, definition.projection)
      Object.assign(output, { [definition.output]: resource })
    }
    return { success: true, output }
  } catch (error) {
    const providerError = error instanceof OciClientError ? error : undefined
    const rejected = !dispatched || (providerError?.status !== undefined && providerError.status < 500)
    return {
      success: false,
      retryable: definition.method === 'GET',
      error: providerError?.status === 412
        ? 'The resource changed. Read its current state and ETag before submitting another update.'
        : getErrorMessage(error, 'OCI Compute operation failed'),
      output: {
        status: providerError?.status ?? receivedStatus ?? 0,
        requestId: providerError?.opcRequestId ?? receivedRequestId ?? null,
        outcome: rejected ? 'rejected' : 'unknown',
        ...(retryToken ? { retryToken } : {}),
      },
    }
  }
}
