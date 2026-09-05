/**
 * AWS partitions Sim can address, derived from the region prefixes the shared
 * region validator admits (`validateAwsRegion`).
 */
export type AwsPartition =
  | 'aws'
  | 'aws-us-gov'
  | 'aws-cn'
  | 'aws-iso'
  | 'aws-iso-b'
  | 'aws-iso-e'
  | 'aws-eusc'

interface PartitionRule {
  prefix: string
  partition: AwsPartition
}

/**
 * Ordered longest-prefix-first so `us-isob-east-1` is not mistaken for `us-iso-*`.
 * Regions that match no prefix belong to the commercial `aws` partition.
 */
const PARTITION_RULES: readonly PartitionRule[] = [
  { prefix: 'us-gov-', partition: 'aws-us-gov' },
  { prefix: 'us-isob-', partition: 'aws-iso-b' },
  { prefix: 'us-iso-', partition: 'aws-iso' },
  { prefix: 'eu-isoe-', partition: 'aws-iso-e' },
  { prefix: 'eusc-', partition: 'aws-eusc' },
  { prefix: 'cn-', partition: 'aws-cn' },
] as const

/**
 * Resolves the AWS partition a region belongs to.
 */
export function getAwsPartition(region: string): AwsPartition {
  const normalized = region.trim().toLowerCase()
  for (const rule of PARTITION_RULES) {
    if (normalized.startsWith(rule.prefix)) return rule.partition
  }
  return 'aws'
}

/**
 * AWS Organizations is a global service, but global *per partition* — each
 * partition has exactly one Organizations endpoint and a caller must sign for
 * that partition's home region.
 *
 * - `aws` → `organizations.us-east-1.amazonaws.com`
 * - `aws-us-gov` → `organizations.us-gov-west-1.amazonaws.com` (both GovCloud regions)
 * - `aws-cn` → `organizations.cn-northwest-1.amazonaws.com.cn`
 *
 * @see https://docs.aws.amazon.com/general/latest/gr/ao.html
 * @see https://docs.aws.amazon.com/organizations/latest/APIReference/Welcome.html
 */
const ORGANIZATIONS_REGION_BY_PARTITION: Partial<Record<AwsPartition, string>> = {
  aws: 'us-east-1',
  'aws-us-gov': 'us-gov-west-1',
  'aws-cn': 'cn-northwest-1',
}

/**
 * Returns the Organizations home region to sign for, given the caller's region.
 *
 * Throws for the ISO and EU Sovereign partitions rather than silently falling
 * back to a commercial endpoint the caller's credentials cannot sign for: AWS
 * does not publish Organizations endpoints for those partitions.
 */
export function resolveOrganizationsRegion(region: string): string {
  const partition = getAwsPartition(region)
  const organizationsRegion = ORGANIZATIONS_REGION_BY_PARTITION[partition]
  if (!organizationsRegion) {
    throw new Error(
      `AWS Organizations is not supported in the ${partition} partition (region "${region}"): AWS does not publish an Organizations endpoint for it. Use an operation that does not read AWS Organizations, such as List Instances or List Permission Sets.`
    )
  }
  return organizationsRegion
}
