import { isRecordLike } from '@sim/utils/object'
import { z } from 'zod'
import { validateAwsRegion } from '@/lib/core/security/input-validation'

const regionSchema = z
  .string()
  .min(1, 'AWS region is required')
  .refine((value) => validateAwsRegion(value).isValid, {
    message: 'Invalid AWS region format (e.g., us-east-1, eu-west-2)',
  })

const connectionSchema = z.object({
  region: regionSchema,
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
})

function parseJsonString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

/**
 * Splits an ID list given as an array, a JSON array string (a stringified upstream output), or a
 * comma-separated string into trimmed, non-empty values.
 */
function toIdList(value: unknown): string[] {
  if (value === null || value === undefined) return []
  const parsed =
    typeof value === 'string' && value.trim().startsWith('[') ? parseJsonString(value) : value
  const items = Array.isArray(parsed) ? parsed.map(String) : String(parsed).split(',')
  return items.map((item) => item.trim()).filter((item) => item.length > 0)
}

function idListSchema(label: string, max = 1000) {
  return z.preprocess((value) => {
    const ids = toIdList(value)
    return ids.length > 0 ? ids : undefined
  }, z.array(z.string()).max(max, `A maximum of ${max} ${label} can be provided`).optional())
}

function requiredIdListSchema(label: string, max = 1000) {
  return z.preprocess(
    toIdList,
    z
      .array(z.string())
      .min(1, `At least one ${label.replace(/s$/, '')} is required`)
      .max(max, `A maximum of ${max} ${label} can be provided`)
  )
}

const filterEntrySchema = z.preprocess(
  (value) => {
    if (!isRecordLike(value)) return value
    const values = value.Values ?? value.values
    return {
      Name: value.Name ?? value.name,
      Values: Array.isArray(values)
        ? values.map(String)
        : typeof values === 'string'
          ? [values]
          : values,
    }
  },
  z.object({
    Name: z.string().min(1, 'Each filter needs a Name'),
    Values: z.array(z.string()).min(1, 'Each filter needs at least one value'),
  })
)

/**
 * EC2 filters as `[{ "Name": "vpc-id", "Values": ["vpc-123"] }]`, either as an array or its
 * JSON string. Lowercase `name`/`values` keys are accepted for model-authored input.
 */
const filtersSchema = z.preprocess(
  parseJsonString,
  z
    .array(filterEntrySchema, { message: 'Filters must be a JSON array of { Name, Values }' })
    .max(200)
    .optional()
)

/**
 * Tags as a `{ "Key": "Value" }` object, a `[{ "Key": "k", "Value": "v" }]` array, or tag-table
 * rows (`[{ cells: { key, value } }]`), either directly or as a JSON string.
 */
const tagsSchema = z.preprocess(
  (value) => {
    const parsed = parseJsonString(value)
    if (Array.isArray(parsed)) {
      const record: Record<string, string> = {}
      for (const entry of parsed) {
        if (!isRecordLike(entry)) return parsed
        const tag = isRecordLike(entry.cells) ? entry.cells : entry
        const key = tag.Key ?? tag.key
        if (typeof key !== 'string') return parsed
        if (key.trim() === '') continue
        record[key.trim()] = String(tag.Value ?? tag.value ?? '')
      }
      return record
    }
    if (isRecordLike(parsed)) {
      return Object.fromEntries(Object.entries(parsed).map(([key, val]) => [key, String(val)]))
    }
    return parsed
  },
  z
    .record(z.string().min(1).max(128), z.string().max(256), {
      message: 'Tags must be a JSON object of key/value pairs',
    })
    .refine((tags) => Object.keys(tags).length <= 50, {
      message: 'A maximum of 50 tags can be provided',
    })
    .optional()
)

/** Booleans may arrive as `"true"`/`"false"` from model-authored tool calls. */
const booleanishSchema = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean().optional()
)

const paginationSchema = {
  maxResults: z.coerce.number().int().min(5).max(1000).optional(),
  nextToken: z.string().min(1).optional(),
}

export const ec2DescribeInstancesInputSchema = connectionSchema.extend({
  instanceIds: idListSchema('instance IDs'),
  filters: filtersSchema,
  ...paginationSchema,
})

export const ec2DescribeInstanceStatusInputSchema = connectionSchema.extend({
  instanceIds: idListSchema('instance IDs', 100),
  filters: filtersSchema,
  includeAllInstances: booleanishSchema,
  ...paginationSchema,
})

export const ec2InstanceIdsInputSchema = connectionSchema.extend({
  instanceIds: requiredIdListSchema('instance IDs'),
})

export const ec2StopInstancesInputSchema = ec2InstanceIdsInputSchema.extend({
  hibernate: booleanishSchema,
  force: booleanishSchema,
})

export const ec2DescribeAddressesInputSchema = connectionSchema.extend({
  publicIps: idListSchema('public IPs'),
  allocationIds: idListSchema('allocation IDs'),
  filters: filtersSchema,
})

export const ec2AllocateAddressInputSchema = connectionSchema.extend({
  networkBorderGroup: z.string().min(1).optional(),
  publicIpv4Pool: z.string().min(1).optional(),
  tags: tagsSchema,
})

export const ec2AssociateAddressInputSchema = connectionSchema
  .extend({
    allocationId: z.string().min(1, 'Allocation ID is required'),
    instanceId: z.string().min(1).optional(),
    networkInterfaceId: z.string().min(1).optional(),
    privateIpAddress: z.string().min(1).optional(),
    allowReassociation: booleanishSchema,
  })
  .refine((input) => Boolean(input.instanceId) !== Boolean(input.networkInterfaceId), {
    message: 'Provide exactly one of instanceId or networkInterfaceId',
  })

export const ec2DisassociateAddressInputSchema = connectionSchema.extend({
  associationId: z.string().min(1, 'Association ID is required'),
})

export const ec2ReleaseAddressInputSchema = connectionSchema.extend({
  allocationId: z.string().min(1, 'Allocation ID is required'),
  networkBorderGroup: z.string().min(1).optional(),
})

export const ec2DescribeNatGatewaysInputSchema = connectionSchema.extend({
  natGatewayIds: idListSchema('NAT gateway IDs'),
  filters: filtersSchema,
  ...paginationSchema,
})

export const ec2DescribeRouteTablesInputSchema = connectionSchema.extend({
  routeTableIds: idListSchema('route table IDs'),
  filters: filtersSchema,
  maxResults: z.coerce.number().int().min(5).max(100).optional(),
  nextToken: paginationSchema.nextToken,
})

export const ec2DescribeVpcsInputSchema = connectionSchema.extend({
  vpcIds: idListSchema('VPC IDs'),
  filters: filtersSchema,
  ...paginationSchema,
})

export const ec2DescribeSubnetsInputSchema = connectionSchema.extend({
  subnetIds: idListSchema('subnet IDs'),
  filters: filtersSchema,
  ...paginationSchema,
})

export const ec2DescribeSecurityGroupsInputSchema = connectionSchema.extend({
  groupIds: idListSchema('security group IDs'),
  filters: filtersSchema,
  ...paginationSchema,
})

export const ec2DescribeInternetGatewaysInputSchema = connectionSchema.extend({
  internetGatewayIds: idListSchema('internet gateway IDs'),
  filters: filtersSchema,
  ...paginationSchema,
})

export const ec2DescribeNetworkInterfacesInputSchema = connectionSchema.extend({
  networkInterfaceIds: idListSchema('network interface IDs'),
  filters: filtersSchema,
  ...paginationSchema,
})

export const ec2DescribeVolumesInputSchema = connectionSchema.extend({
  volumeIds: idListSchema('volume IDs'),
  filters: filtersSchema,
  ...paginationSchema,
})

export const ec2DescribeSnapshotsInputSchema = connectionSchema.extend({
  snapshotIds: idListSchema('snapshot IDs'),
  ownerIds: idListSchema('owner IDs'),
  filters: filtersSchema,
  ...paginationSchema,
})

export const ec2CreateSnapshotInputSchema = connectionSchema.extend({
  volumeId: z.string().min(1, 'Volume ID is required'),
  description: z.string().max(255).optional(),
  tags: tagsSchema,
})

export const ec2CreateTagsInputSchema = connectionSchema.extend({
  resourceIds: requiredIdListSchema('resource IDs'),
  tags: tagsSchema.refine((tags) => tags !== undefined && Object.keys(tags).length > 0, {
    message: 'At least one tag is required',
  }),
})

export const ec2DeleteTagsInputSchema = connectionSchema.extend({
  resourceIds: requiredIdListSchema('resource IDs'),
  tagKeys: requiredIdListSchema('tag keys', 50),
})

export const ec2DescribeRegionsInputSchema = connectionSchema.extend({
  regionNames: idListSchema('region names'),
  allRegions: booleanishSchema,
  filters: filtersSchema,
})

export const ec2DescribeAvailabilityZonesInputSchema = connectionSchema.extend({
  zoneNames: idListSchema('zone names'),
  allAvailabilityZones: booleanishSchema,
  filters: filtersSchema,
})

export type Ec2DescribeInstancesInput = z.output<typeof ec2DescribeInstancesInputSchema>
export type Ec2DescribeInstanceStatusInput = z.output<typeof ec2DescribeInstanceStatusInputSchema>
export type Ec2InstanceIdsInput = z.output<typeof ec2InstanceIdsInputSchema>
export type Ec2StopInstancesInput = z.output<typeof ec2StopInstancesInputSchema>
export type Ec2DescribeAddressesInput = z.output<typeof ec2DescribeAddressesInputSchema>
export type Ec2AllocateAddressInput = z.output<typeof ec2AllocateAddressInputSchema>
export type Ec2AssociateAddressInput = z.output<typeof ec2AssociateAddressInputSchema>
export type Ec2DisassociateAddressInput = z.output<typeof ec2DisassociateAddressInputSchema>
export type Ec2ReleaseAddressInput = z.output<typeof ec2ReleaseAddressInputSchema>
export type Ec2DescribeNatGatewaysInput = z.output<typeof ec2DescribeNatGatewaysInputSchema>
export type Ec2DescribeRouteTablesInput = z.output<typeof ec2DescribeRouteTablesInputSchema>
export type Ec2DescribeVpcsInput = z.output<typeof ec2DescribeVpcsInputSchema>
export type Ec2DescribeSubnetsInput = z.output<typeof ec2DescribeSubnetsInputSchema>
export type Ec2DescribeSecurityGroupsInput = z.output<typeof ec2DescribeSecurityGroupsInputSchema>
export type Ec2DescribeInternetGatewaysInput = z.output<
  typeof ec2DescribeInternetGatewaysInputSchema
>
export type Ec2DescribeNetworkInterfacesInput = z.output<
  typeof ec2DescribeNetworkInterfacesInputSchema
>
export type Ec2DescribeVolumesInput = z.output<typeof ec2DescribeVolumesInputSchema>
export type Ec2DescribeSnapshotsInput = z.output<typeof ec2DescribeSnapshotsInputSchema>
export type Ec2CreateSnapshotInput = z.output<typeof ec2CreateSnapshotInputSchema>
export type Ec2CreateTagsInput = z.output<typeof ec2CreateTagsInputSchema>
export type Ec2DeleteTagsInput = z.output<typeof ec2DeleteTagsInputSchema>
export type Ec2DescribeRegionsInput = z.output<typeof ec2DescribeRegionsInputSchema>
export type Ec2DescribeAvailabilityZonesInput = z.output<
  typeof ec2DescribeAvailabilityZonesInputSchema
>
