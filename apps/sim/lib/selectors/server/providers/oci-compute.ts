import { isPlainRecord } from '@sim/utils/object'
import { createOciClient, type OciClient } from '@/lib/internal/oci/client.server'
import { createOciStaticEndpointPolicy } from '@/lib/internal/oci/endpoints'
import { executeOciComputeOperation } from '@/lib/internal/oci-compute/operations'
import { ociComputeSchemas, type OciComputeOperation } from '@/lib/internal/oci-compute/schema'
import { OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  listSelectorResult,
  type ExecuteServerSelectorArgs,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'
import { OCI_COMPUTE_SERVICE_ID } from '@/tools/oci_compute/types'

const SELECTORS = {
  'oci_compute.instances': {
    list: 'list_instances',
    get: 'get_instance',
    id: 'instanceId',
    output: 'instances',
    singular: 'instance',
    filters: ['availabilityDomain'],
  },
  'oci_compute.images': {
    list: 'list_images',
    get: 'get_image',
    id: 'imageId',
    output: 'images',
    singular: 'image',
    filters: ['shape'],
  },
  'oci_compute.shapes': {
    list: 'list_shapes',
    get: null,
    id: 'shape',
    output: 'shapes',
    singular: 'shape',
    filters: ['availabilityDomain', 'imageId'],
  },
  'oci_compute.instanceConfigurations': {
    list: 'list_instance_configurations',
    get: 'get_instance_configuration',
    id: 'instanceConfigurationId',
    output: 'instanceConfigurations',
    singular: 'instanceConfiguration',
    filters: [],
  },
  'oci_compute.instancePools': {
    list: 'list_instance_pools',
    get: 'get_instance_pool',
    id: 'instancePoolId',
    output: 'instancePools',
    singular: 'instancePool',
    filters: [],
  },
  'oci_compute.compartments': {
    list: 'list_compartments',
    get: 'get_compartment',
    id: 'compartmentId',
    output: 'compartments',
    singular: 'compartment',
    filters: [],
  },
  'oci_compute.availabilityDomains': {
    list: 'list_availability_domains',
    get: null,
    id: 'name',
    output: 'availabilityDomains',
    singular: 'availabilityDomain',
    filters: [],
  },
  'oci_compute.faultDomains': {
    list: 'list_fault_domains',
    get: null,
    id: 'name',
    output: 'faultDomains',
    singular: 'faultDomain',
    filters: ['availabilityDomain'],
  },
  'oci_compute.subnets': {
    list: 'list_subnets',
    get: 'get_subnet',
    id: 'subnetId',
    output: 'subnets',
    singular: 'subnet',
    filters: ['availabilityDomain', 'vcnId'],
  },
} as const

type ComputeSelectorKey = keyof typeof SELECTORS

interface PreparedCompute {
  client: OciClient
  credentialId: string
}

async function prepareCompute(args: ExecuteServerSelectorArgs): Promise<PreparedCompute> {
  const access = args.credential?.access
  if (
    !access?.resolvedCredentialId ||
    access.credentialType !== 'service_account' ||
    access.workspaceId !== args.workspaceId ||
    args.credential?.providerId !== OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  const region = args.context.region
  if (!region) throw new SelectorContextUnavailableError()
  args.signal?.throwIfAborted()
  const client = await createOciClient({
    credentialId: access.resolvedCredentialId,
    workspaceId: args.workspaceId,
    serviceId: OCI_COMPUTE_SERVICE_ID,
    region,
  })
  const identity = ['oci_compute.compartments', 'oci_compute.availabilityDomains', 'oci_compute.faultDomains'].includes(args.selectorKey)
  await client.prepareStaticEndpoint(createOciStaticEndpointPolicy({
    serviceId: OCI_COMPUTE_SERVICE_ID,
    serviceName: identity ? 'identity' : 'iaas',
    hostnameTemplate: identity ? 'regional-oci' : 'regional',
  }))
  args.signal?.throwIfAborted()
  return { client, credentialId: access.resolvedCredentialId }
}

function option(value: unknown, key: ComputeSelectorKey): SafeSelectorOption {
  if (!isPlainRecord(value)) throw new SelectorOptionsUnavailableError()
  const id = key === 'oci_compute.shapes' ? value.shape
    : key === 'oci_compute.availabilityDomains' || key === 'oci_compute.faultDomains'
      ? value.name : value.id
  if (typeof id !== 'string' || !id || id.length > 512) {
    throw new SelectorOptionsUnavailableError()
  }
  const name = typeof value.displayName === 'string' ? value.displayName
    : typeof value.name === 'string' ? value.name : id
  const label = name === id ? id : `${name} (${id.slice(-12)})`
  const meta: Record<string, string | number | boolean | null> = {}
  for (const field of ['lifecycleState', 'availabilityDomain', 'shape', 'isFlexible']) {
    const item = value[field]
    if (typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number') {
      meta[field] = item
    }
  }
  return { id, label, meta }
}

async function executeCompute(args: ExecuteServerSelectorArgs, prepared: PreparedCompute) {
  const key = args.selectorKey as ComputeSelectorKey
  const selector = SELECTORS[key]
  if (!selector) throw new SelectorOptionsUnavailableError()
  const compartmentId = key === 'oci_compute.compartments'
    ? args.context.parentCompartmentId : args.context.compartmentId
  if (!compartmentId) throw new SelectorContextUnavailableError()
  const flat = key === 'oci_compute.availabilityDomains' || key === 'oci_compute.faultDomains'
  const direct = args.request.kind === 'detail' && selector.get !== null
  const operation: OciComputeOperation = direct ? selector.get! : selector.list
  const input: Record<string, unknown> = {
    oauthCredential: prepared.credentialId,
    region: args.context.region,
  }
  if (direct && args.request.kind === 'detail') {
    input[selector.id] = args.request.id
  } else {
    input.compartmentId = compartmentId
    if (!flat) {
      input.limit = 50
      if (args.request.kind === 'list' && args.request.cursor) input.page = args.request.cursor
    }
    for (const field of selector.filters) {
      if (key === 'oci_compute.subnets' && field === 'availabilityDomain') continue
      if (args.context[field]) input[field] = args.context[field]
    }
    if (key === 'oci_compute.compartments') input.accessLevel = 'ACCESSIBLE'
    if (key === 'oci_compute.shapes' && args.request.kind === 'detail') {
      input.shape = args.request.id
    }
  }
  const parsed = ociComputeSchemas[operation].safeParse(input)
  if (!parsed.success) throw new SelectorContextUnavailableError()
  args.signal?.throwIfAborted()
  args.recordCredentialUse?.(OCI_API_KEY_SERVICE_ACCOUNT_PROVIDER_ID)
  const result = await executeOciComputeOperation(prepared.client, operation, parsed.data, args.signal)
  args.signal?.throwIfAborted()
  if (!result.success) {
    if (direct && result.output.status === 404) return detailSelectorResult(null)
    throw selectorProviderStatusError(result.output.status || 502)
  }
  const output = result.output as unknown as Record<string, unknown>
  if (direct) {
    const resource = output[selector.singular]
    if (!isPlainRecord(resource)) throw new SelectorOptionsUnavailableError()
    if (resource.compartmentId !== compartmentId) return detailSelectorResult(null)
    return detailSelectorResult(option(resource, key))
  }
  const resources = output[selector.output]
  if (!Array.isArray(resources)) throw new SelectorOptionsUnavailableError()
  const items = resources
    .filter((item) => key !== 'oci_compute.subnets' || !args.context.availabilityDomain ||
      (isPlainRecord(item) && (!item.availabilityDomain || item.availabilityDomain === args.context.availabilityDomain)))
    .map((item) => option(item, key))
  if (args.request.kind === 'detail') {
    const selectedId = args.request.id
    return detailSelectorResult(items.find((item) => item.id === selectedId) ?? null)
  }
  return listSelectorResult(items, result.output.nextPage ?? undefined)
}

const attachment = definePreparedSelectorAttachment({
  credential: { kind: 'stored', field: 'oauthCredential', serviceIds: ['oci_compute'] },
  integrationBlockTypes: ['oci_compute'],
  destination: { kind: 'credential-bound', prepare: prepareCompute },
  auditCredentialUse: true,
  execute: executeCompute,
})

export const ociComputeSelectorAttachments = {
  'oci_compute.instances': attachment,
  'oci_compute.images': attachment,
  'oci_compute.shapes': attachment,
  'oci_compute.instanceConfigurations': attachment,
  'oci_compute.instancePools': attachment,
  'oci_compute.compartments': attachment,
  'oci_compute.availabilityDomains': attachment,
  'oci_compute.faultDomains': attachment,
  'oci_compute.subnets': attachment,
} satisfies ServerSelectorAttachmentMap<Extract<ServerSelectorKey, ComputeSelectorKey>>
