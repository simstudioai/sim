import { EC2Icon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

const INSTANCE_ACTIONS = [
  'start_instances',
  'stop_instances',
  'reboot_instances',
  'terminate_instances',
]

const PAGINATED_DESCRIBES = [
  'describe_instances',
  'describe_instance_status',
  'describe_nat_gateways',
  'describe_route_tables',
  'describe_vpcs',
  'describe_subnets',
  'describe_security_groups',
  'describe_internet_gateways',
  'describe_network_interfaces',
  'describe_volumes',
  'describe_snapshots',
]

const FILTERABLE_DESCRIBES = [
  ...PAGINATED_DESCRIBES,
  'describe_addresses',
  'describe_regions',
  'describe_availability_zones',
]

/**
 * Converts the tag table (rows of `{ cells: { key, value } }`) into a `{ key: value }`
 * record. A string value is a resolved reference or raw JSON and is passed through for the
 * operation to parse.
 */
function toTagParam(value: unknown): unknown {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value
  if (!Array.isArray(value)) return value ?? undefined
  const tags: Record<string, string> = {}
  for (const row of value) {
    const key = row?.cells?.key
    const tagValue = row?.cells?.value
    if (typeof key === 'string' && key.trim() !== '') tags[key.trim()] = String(tagValue ?? '')
  }
  return Object.keys(tags).length > 0 ? tags : undefined
}

export const EC2Block: BlockConfig = {
  type: 'ec2',
  name: 'Amazon EC2',
  description: 'Manage EC2 instances, Elastic IPs, VPC networking, and EBS',
  longDescription:
    'Integrate Amazon EC2 into workflows. Describe and control instances, manage Elastic IP addresses, inspect VPCs, subnets, route tables, NAT and internet gateways, security groups, and network interfaces, work with EBS volumes and snapshots, and tag resources. Requires an AWS access key with the matching ec2:* IAM permissions.',
  docsLink: 'https://docs.sim.ai/integrations/ec2',
  category: 'tools',
  integrationType: IntegrationType.DevOps,
  authMode: AuthMode.ApiKey,
  bgColor: 'linear-gradient(45deg, #C8511B 0%, #FF9900 100%)',
  iconColor: '#FF9900',
  icon: EC2Icon,
  canvasPresentation: {
    defaultTitle: 'Amazon EC2',
    sentences: {
      byOperation: {
        describe_instances: ['List instances', { text: 'with IDs', field: 'instanceIds' }],
        describe_instance_status: [
          'Check status of instances',
          { text: 'with IDs', field: 'instanceIds' },
        ],
        start_instances: [{ text: 'Start', field: 'instanceIds', core: true }],
        stop_instances: [{ text: 'Stop', field: 'instanceIds', core: true }],
        reboot_instances: [{ text: 'Reboot', field: 'instanceIds', core: true }],
        terminate_instances: [{ text: 'Terminate', field: 'instanceIds', core: true }],
        describe_addresses: [
          'List Elastic IPs',
          { text: 'matching', field: ['publicIps', 'allocationIds'] },
        ],
        allocate_address: ['Allocate new Elastic IP'],
        associate_address: [
          { text: 'Attach Elastic IP', field: 'allocationId', core: true },
          { text: 'to', field: ['instanceId', 'networkInterfaceId'] },
        ],
        disassociate_address: [
          { text: 'Detach Elastic IP association', field: 'associationId', core: true },
        ],
        release_address: [{ text: 'Release Elastic IP', field: 'allocationId', core: true }],
        describe_nat_gateways: ['List NAT gateways', { text: 'with IDs', field: 'natGatewayIds' }],
        describe_route_tables: ['List route tables', { text: 'with IDs', field: 'routeTableIds' }],
        describe_vpcs: ['List VPCs', { text: 'with IDs', field: 'vpcIds' }],
        describe_subnets: ['List subnets', { text: 'with IDs', field: 'subnetIds' }],
        describe_security_groups: ['List security groups', { text: 'with IDs', field: 'groupIds' }],
        describe_internet_gateways: [
          'List internet gateways',
          { text: 'with IDs', field: 'internetGatewayIds' },
        ],
        describe_network_interfaces: [
          'List network interfaces',
          { text: 'with IDs', field: 'networkInterfaceIds' },
        ],
        describe_volumes: ['List EBS volumes', { text: 'with IDs', field: 'volumeIds' }],
        describe_snapshots: ['List EBS snapshots', { text: 'with IDs', field: 'snapshotIds' }],
        create_snapshot: [{ text: 'Snapshot volume', field: 'volumeId', core: true }],
        create_tags: [{ text: 'Tag', field: 'resourceIds', core: true }],
        delete_tags: [
          { text: 'Remove tags', field: 'tagKeys', core: true },
          { text: 'from', field: 'resourceIds', core: true },
        ],
        describe_regions: ['List AWS Regions', { text: 'named', field: 'regionNames' }],
        describe_availability_zones: [
          'List Availability Zones',
          { text: 'named', field: 'zoneNames' },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Describe Instances', id: 'describe_instances' },
        { label: 'Describe Instance Status', id: 'describe_instance_status' },
        { label: 'Start Instances', id: 'start_instances' },
        { label: 'Stop Instances', id: 'stop_instances' },
        { label: 'Reboot Instances', id: 'reboot_instances' },
        { label: 'Terminate Instances', id: 'terminate_instances' },
        { label: 'Describe Elastic IPs', id: 'describe_addresses' },
        { label: 'Allocate Elastic IP', id: 'allocate_address' },
        { label: 'Associate Elastic IP', id: 'associate_address' },
        { label: 'Disassociate Elastic IP', id: 'disassociate_address' },
        { label: 'Release Elastic IP', id: 'release_address' },
        { label: 'Describe NAT Gateways', id: 'describe_nat_gateways' },
        { label: 'Describe Route Tables', id: 'describe_route_tables' },
        { label: 'Describe VPCs', id: 'describe_vpcs' },
        { label: 'Describe Subnets', id: 'describe_subnets' },
        { label: 'Describe Security Groups', id: 'describe_security_groups' },
        { label: 'Describe Internet Gateways', id: 'describe_internet_gateways' },
        { label: 'Describe Network Interfaces', id: 'describe_network_interfaces' },
        { label: 'Describe EBS Volumes', id: 'describe_volumes' },
        { label: 'Describe EBS Snapshots', id: 'describe_snapshots' },
        { label: 'Create EBS Snapshot', id: 'create_snapshot' },
        { label: 'Create Tags', id: 'create_tags' },
        { label: 'Delete Tags', id: 'delete_tags' },
        { label: 'Describe Regions', id: 'describe_regions' },
        { label: 'Describe Availability Zones', id: 'describe_availability_zones' },
      ],
      value: () => 'describe_instances',
    },
    {
      id: 'awsRegion',
      title: 'AWS Region',
      type: 'short-input',
      placeholder: 'us-east-1',
      required: true,
    },
    {
      id: 'awsAccessKeyId',
      title: 'AWS Access Key ID',
      type: 'short-input',
      placeholder: 'Enter your AWS access key ID',
      password: true,
      required: true,
    },
    {
      id: 'awsSecretAccessKey',
      title: 'AWS Secret Access Key',
      type: 'short-input',
      placeholder: 'Enter your AWS secret access key',
      password: true,
      required: true,
    },
    {
      id: 'instanceIds',
      title: 'Instance IDs',
      type: 'short-input',
      placeholder: 'i-0abc123def456, i-0789abc012def',
      condition: {
        field: 'operation',
        value: ['describe_instances', 'describe_instance_status', ...INSTANCE_ACTIONS],
      },
      required: { field: 'operation', value: INSTANCE_ACTIONS },
    },
    {
      id: 'includeAllInstances',
      title: 'Include Stopped Instances',
      type: 'switch',
      condition: { field: 'operation', value: 'describe_instance_status' },
    },
    {
      id: 'hibernate',
      title: 'Hibernate',
      type: 'switch',
      condition: { field: 'operation', value: 'stop_instances' },
      mode: 'advanced',
    },
    {
      id: 'force',
      title: 'Force Stop',
      type: 'switch',
      condition: { field: 'operation', value: 'stop_instances' },
      mode: 'advanced',
    },
    {
      id: 'publicIps',
      title: 'Public IPs',
      type: 'short-input',
      placeholder: '203.0.113.10, 203.0.113.11',
      condition: { field: 'operation', value: 'describe_addresses' },
    },
    {
      id: 'allocationIds',
      title: 'Allocation IDs',
      type: 'short-input',
      placeholder: 'eipalloc-0abc123def456',
      condition: { field: 'operation', value: 'describe_addresses' },
    },
    {
      id: 'allocationId',
      title: 'Allocation ID',
      type: 'short-input',
      placeholder: 'eipalloc-0abc123def456',
      condition: { field: 'operation', value: ['associate_address', 'release_address'] },
      required: { field: 'operation', value: ['associate_address', 'release_address'] },
    },
    {
      id: 'instanceId',
      title: 'Instance ID',
      type: 'short-input',
      placeholder: 'i-0abc123def456 (or set a network interface)',
      condition: { field: 'operation', value: 'associate_address' },
    },
    {
      id: 'networkInterfaceId',
      title: 'Network Interface ID',
      type: 'short-input',
      placeholder: 'eni-0abc123def456 (or set an instance)',
      condition: { field: 'operation', value: 'associate_address' },
    },
    {
      id: 'privateIpAddress',
      title: 'Private IP Address',
      type: 'short-input',
      placeholder: 'Defaults to the primary private IP',
      condition: { field: 'operation', value: 'associate_address' },
      mode: 'advanced',
    },
    {
      id: 'allowReassociation',
      title: 'Allow Reassociation',
      type: 'switch',
      condition: { field: 'operation', value: 'associate_address' },
      mode: 'advanced',
    },
    {
      id: 'associationId',
      title: 'Association ID',
      type: 'short-input',
      placeholder: 'eipassoc-0abc123def456',
      condition: { field: 'operation', value: 'disassociate_address' },
      required: { field: 'operation', value: 'disassociate_address' },
    },
    {
      id: 'networkBorderGroup',
      title: 'Network Border Group',
      type: 'short-input',
      placeholder: 'Defaults to the region',
      condition: { field: 'operation', value: ['allocate_address', 'release_address'] },
      mode: 'advanced',
    },
    {
      id: 'publicIpv4Pool',
      title: 'Public IPv4 Pool',
      type: 'short-input',
      placeholder: 'Defaults to the Amazon pool',
      condition: { field: 'operation', value: 'allocate_address' },
      mode: 'advanced',
    },
    {
      id: 'natGatewayIds',
      title: 'NAT Gateway IDs',
      type: 'short-input',
      placeholder: 'nat-0abc123def456',
      condition: { field: 'operation', value: 'describe_nat_gateways' },
    },
    {
      id: 'routeTableIds',
      title: 'Route Table IDs',
      type: 'short-input',
      placeholder: 'rtb-0abc123def456',
      condition: { field: 'operation', value: 'describe_route_tables' },
    },
    {
      id: 'vpcIds',
      title: 'VPC IDs',
      type: 'short-input',
      placeholder: 'vpc-0abc123def456',
      condition: { field: 'operation', value: 'describe_vpcs' },
    },
    {
      id: 'subnetIds',
      title: 'Subnet IDs',
      type: 'short-input',
      placeholder: 'subnet-0abc123def456',
      condition: { field: 'operation', value: 'describe_subnets' },
    },
    {
      id: 'groupIds',
      title: 'Security Group IDs',
      type: 'short-input',
      placeholder: 'sg-0abc123def456',
      condition: { field: 'operation', value: 'describe_security_groups' },
    },
    {
      id: 'internetGatewayIds',
      title: 'Internet Gateway IDs',
      type: 'short-input',
      placeholder: 'igw-0abc123def456',
      condition: { field: 'operation', value: 'describe_internet_gateways' },
    },
    {
      id: 'networkInterfaceIds',
      title: 'Network Interface IDs',
      type: 'short-input',
      placeholder: 'eni-0abc123def456',
      condition: { field: 'operation', value: 'describe_network_interfaces' },
    },
    {
      id: 'volumeIds',
      title: 'Volume IDs',
      type: 'short-input',
      placeholder: 'vol-0abc123def456',
      condition: { field: 'operation', value: 'describe_volumes' },
    },
    {
      id: 'snapshotIds',
      title: 'Snapshot IDs',
      type: 'short-input',
      placeholder: 'snap-0abc123def456',
      condition: { field: 'operation', value: 'describe_snapshots' },
    },
    {
      id: 'ownerIds',
      title: 'Snapshot Owners',
      type: 'short-input',
      placeholder: 'Defaults to self (account IDs, self, or amazon)',
      condition: { field: 'operation', value: 'describe_snapshots' },
      mode: 'advanced',
    },
    {
      id: 'volumeId',
      title: 'Volume ID',
      type: 'short-input',
      placeholder: 'vol-0abc123def456',
      condition: { field: 'operation', value: 'create_snapshot' },
      required: { field: 'operation', value: 'create_snapshot' },
    },
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Nightly backup of the app data volume',
      condition: { field: 'operation', value: 'create_snapshot' },
    },
    {
      id: 'resourceIds',
      title: 'Resource IDs',
      type: 'short-input',
      placeholder: 'i-0abc123def456, vol-0abc123def456',
      condition: { field: 'operation', value: ['create_tags', 'delete_tags'] },
      required: { field: 'operation', value: ['create_tags', 'delete_tags'] },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'table',
      columns: ['key', 'value'],
      condition: { field: 'operation', value: 'create_tags' },
      required: { field: 'operation', value: 'create_tags' },
    },
    {
      id: 'resourceTags',
      title: 'Tags',
      type: 'table',
      columns: ['key', 'value'],
      condition: { field: 'operation', value: ['allocate_address', 'create_snapshot'] },
      mode: 'advanced',
    },
    {
      id: 'tagKeys',
      title: 'Tag Keys',
      type: 'short-input',
      placeholder: 'Environment, Owner',
      condition: { field: 'operation', value: 'delete_tags' },
      required: { field: 'operation', value: 'delete_tags' },
    },
    {
      id: 'regionNames',
      title: 'Region Names',
      type: 'short-input',
      placeholder: 'us-east-1, eu-west-1',
      condition: { field: 'operation', value: 'describe_regions' },
    },
    {
      id: 'allRegions',
      title: 'Include Disabled Regions',
      type: 'switch',
      condition: { field: 'operation', value: 'describe_regions' },
      mode: 'advanced',
    },
    {
      id: 'zoneNames',
      title: 'Zone Names',
      type: 'short-input',
      placeholder: 'us-east-1a, us-east-1b',
      condition: { field: 'operation', value: 'describe_availability_zones' },
    },
    {
      id: 'allAvailabilityZones',
      title: 'Include All Zones',
      type: 'switch',
      condition: { field: 'operation', value: 'describe_availability_zones' },
      mode: 'advanced',
    },
    {
      id: 'filters',
      title: 'Filters',
      type: 'code',
      language: 'json',
      placeholder: '[{"Name": "vpc-id", "Values": ["vpc-0abc123def456"]}]',
      condition: { field: 'operation', value: FILTERABLE_DESCRIBES },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an Amazon EC2 API filter list as a JSON array based on the user's description.
Each entry is {"Name": "<filter-name>", "Values": ["<value>", ...]}. Values in one entry are ORed; entries are ANDed.
Common filter names:
- Instances: instance-state-name (pending|running|stopping|stopped|terminated), instance-type, vpc-id, subnet-id, tag:<key>, tag-key
- Elastic IPs: domain, instance-id, association-id, network-interface-id, tag:<key>
- NAT gateways: state (pending|failed|available|deleting|deleted), subnet-id, vpc-id, tag:<key>
- Route tables: vpc-id, association.subnet-id, association.main, route.nat-gateway-id, route.gateway-id, route.state (active|blackhole)
- Security groups: vpc-id, group-name, ip-permission.cidr, ip-permission.from-port
- Volumes: status (available|in-use), volume-type, attachment.instance-id, encrypted
- Snapshots: volume-id, status, start-time
Return ONLY the JSON array, no explanation.`,
        placeholder: 'Describe the resources to match...',
        generationType: 'json-object',
      },
    },
    {
      id: 'maxResults',
      title: 'Max Results',
      type: 'short-input',
      placeholder: '5 to 1000 (route tables 5 to 100), defaults to 100',
      condition: { field: 'operation', value: PAGINATED_DESCRIBES },
      mode: 'advanced',
    },
    {
      id: 'nextToken',
      title: 'Next Token',
      type: 'short-input',
      placeholder: 'Token from a previous response',
      condition: { field: 'operation', value: PAGINATED_DESCRIBES },
      mode: 'advanced',
    },
  ],
  tools: {
    access: [
      'ec2_describe_instances',
      'ec2_describe_instance_status',
      'ec2_start_instances',
      'ec2_stop_instances',
      'ec2_reboot_instances',
      'ec2_terminate_instances',
      'ec2_describe_addresses',
      'ec2_allocate_address',
      'ec2_associate_address',
      'ec2_disassociate_address',
      'ec2_release_address',
      'ec2_describe_nat_gateways',
      'ec2_describe_route_tables',
      'ec2_describe_vpcs',
      'ec2_describe_subnets',
      'ec2_describe_security_groups',
      'ec2_describe_internet_gateways',
      'ec2_describe_network_interfaces',
      'ec2_describe_volumes',
      'ec2_describe_snapshots',
      'ec2_create_snapshot',
      'ec2_create_tags',
      'ec2_delete_tags',
      'ec2_describe_regions',
      'ec2_describe_availability_zones',
    ],
    config: {
      tool: (params) => `ec2_${params.operation}`,
      params: (params) => {
        const { operation, maxResults, tags, resourceTags, ...rest } = params
        const result: Record<string, unknown> = { ...rest }
        if (maxResults !== undefined && maxResults !== null && maxResults !== '') {
          result.maxResults = Number(maxResults)
        }
        // The Agent tool path calls this without `operation`, so pick whichever tag field is set.
        const tagParam = toTagParam(tags ?? resourceTags)
        if (tagParam !== undefined) result.tags = tagParam
        return result
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'EC2 operation to perform' },
    awsRegion: { type: 'string', description: 'AWS region' },
    awsAccessKeyId: { type: 'string', description: 'AWS access key ID' },
    awsSecretAccessKey: { type: 'string', description: 'AWS secret access key' },
    instanceIds: { type: 'string', description: 'Comma-separated instance IDs' },
    includeAllInstances: {
      type: 'boolean',
      description: 'Include instances that are not running',
    },
    hibernate: { type: 'boolean', description: 'Hibernate instead of stopping' },
    force: { type: 'boolean', description: 'Force the instances to stop' },
    publicIps: { type: 'string', description: 'Comma-separated Elastic IP addresses' },
    allocationIds: { type: 'string', description: 'Comma-separated Elastic IP allocation IDs' },
    allocationId: { type: 'string', description: 'Elastic IP allocation ID' },
    instanceId: { type: 'string', description: 'Instance ID to associate the Elastic IP with' },
    networkInterfaceId: {
      type: 'string',
      description: 'Network interface ID to associate the Elastic IP with',
    },
    privateIpAddress: { type: 'string', description: 'Private IP address to associate with' },
    allowReassociation: {
      type: 'boolean',
      description: 'Allow moving an Elastic IP that is already associated',
    },
    associationId: { type: 'string', description: 'Elastic IP association ID' },
    networkBorderGroup: { type: 'string', description: 'Network border group' },
    publicIpv4Pool: { type: 'string', description: 'Public IPv4 address pool' },
    natGatewayIds: { type: 'string', description: 'Comma-separated NAT gateway IDs' },
    routeTableIds: { type: 'string', description: 'Comma-separated route table IDs' },
    vpcIds: { type: 'string', description: 'Comma-separated VPC IDs' },
    subnetIds: { type: 'string', description: 'Comma-separated subnet IDs' },
    groupIds: { type: 'string', description: 'Comma-separated security group IDs' },
    internetGatewayIds: { type: 'string', description: 'Comma-separated internet gateway IDs' },
    networkInterfaceIds: {
      type: 'string',
      description: 'Comma-separated network interface IDs',
    },
    volumeIds: { type: 'string', description: 'Comma-separated EBS volume IDs' },
    snapshotIds: { type: 'string', description: 'Comma-separated EBS snapshot IDs' },
    ownerIds: { type: 'string', description: 'Comma-separated snapshot owners' },
    volumeId: { type: 'string', description: 'EBS volume ID to snapshot' },
    description: { type: 'string', description: 'Snapshot description' },
    resourceIds: { type: 'string', description: 'Comma-separated resource IDs to tag or untag' },
    tags: { type: 'json', description: 'Tags to create as key/value pairs' },
    resourceTags: { type: 'json', description: 'Tags to apply to the new resource' },
    tagKeys: { type: 'string', description: 'Comma-separated tag keys to remove' },
    regionNames: { type: 'string', description: 'Comma-separated region names' },
    allRegions: { type: 'boolean', description: 'Include Regions not enabled for the account' },
    zoneNames: { type: 'string', description: 'Comma-separated Availability Zone names' },
    allAvailabilityZones: { type: 'boolean', description: 'Include zones that are not opted in' },
    filters: { type: 'json', description: 'EC2 filters as [{ Name, Values }]' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    nextToken: { type: 'string', description: 'Pagination token' },
  },
  outputs: {
    instances: {
      type: 'array',
      description:
        'Instances (describe_instances) or per-instance state transitions (start, stop, terminate)',
    },
    instanceStatuses: {
      type: 'array',
      description: 'Status checks and scheduled events per instance (describe_instance_status)',
    },
    rebooted: {
      type: 'boolean',
      description: 'Whether the reboot was accepted (reboot_instances)',
    },
    instanceIds: { type: 'array', description: 'Instance IDs sent the reboot (reboot_instances)' },
    addresses: { type: 'array', description: 'Elastic IP addresses (describe_addresses)' },
    allocationId: {
      type: 'string',
      description: 'Elastic IP allocation ID (allocate_address, release_address)',
    },
    publicIp: { type: 'string', description: 'Allocated Elastic IP address (allocate_address)' },
    domain: { type: 'string', description: 'Address scope (allocate_address)' },
    networkBorderGroup: { type: 'string', description: 'Network border group (allocate_address)' },
    publicIpv4Pool: { type: 'string', description: 'Public IPv4 pool (allocate_address)' },
    associationId: {
      type: 'string',
      description: 'Elastic IP association ID (associate_address, disassociate_address)',
    },
    disassociated: {
      type: 'boolean',
      description: 'Whether the address was disassociated (disassociate_address)',
    },
    released: {
      type: 'boolean',
      description: 'Whether the address was released (release_address)',
    },
    natGateways: { type: 'array', description: 'NAT gateways (describe_nat_gateways)' },
    routeTables: { type: 'array', description: 'Route tables (describe_route_tables)' },
    vpcs: { type: 'array', description: 'VPCs (describe_vpcs)' },
    subnets: { type: 'array', description: 'Subnets (describe_subnets)' },
    securityGroups: { type: 'array', description: 'Security groups (describe_security_groups)' },
    internetGateways: {
      type: 'array',
      description: 'Internet gateways (describe_internet_gateways)',
    },
    networkInterfaces: {
      type: 'array',
      description: 'Network interfaces (describe_network_interfaces)',
    },
    volumes: { type: 'array', description: 'EBS volumes (describe_volumes)' },
    snapshots: { type: 'array', description: 'EBS snapshots (describe_snapshots)' },
    snapshotId: { type: 'string', description: 'New snapshot ID (create_snapshot)' },
    volumeId: { type: 'string', description: 'Source volume ID (create_snapshot)' },
    volumeSize: { type: 'number', description: 'Source volume size in GiB (create_snapshot)' },
    state: { type: 'string', description: 'Snapshot state (create_snapshot)' },
    startTime: { type: 'string', description: 'Snapshot start time (create_snapshot)' },
    description: { type: 'string', description: 'Snapshot description (create_snapshot)' },
    encrypted: {
      type: 'boolean',
      description: 'Whether the snapshot is encrypted (create_snapshot)',
    },
    ownerId: { type: 'string', description: 'Owning AWS account ID (create_snapshot)' },
    tags: { type: 'json', description: 'Applied tags (create_snapshot, create_tags)' },
    resourceIds: {
      type: 'array',
      description: 'Resource IDs that were tagged or untagged (create_tags, delete_tags)',
    },
    tagKeys: { type: 'array', description: 'Tag keys that were removed (delete_tags)' },
    regions: { type: 'array', description: 'AWS Regions (describe_regions)' },
    availabilityZones: {
      type: 'array',
      description: 'Availability Zones (describe_availability_zones)',
    },
    nextToken: {
      type: 'string',
      description: 'Pagination token for the next page (describe operations)',
    },
  },
}

export const EC2BlockMeta = {
  tags: ['cloud', 'monitoring'],
  url: 'https://aws.amazon.com/ec2/',
  templates: [
    {
      icon: EC2Icon,
      title: 'EC2 egress IP map',
      prompt:
        'Build a workflow that lists Elastic IPs, NAT gateways, and route tables in Amazon EC2, works out which public IPs each private subnet egresses through, and writes the subnet-to-egress-IP map to a table so partners can allowlist the right addresses.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'automation'],
    },
    {
      icon: EC2Icon,
      title: 'EC2 off-hours scheduler',
      prompt:
        'Create a scheduled workflow that every weekday evening finds Amazon EC2 instances tagged Schedule=office-hours that are running, stops them, starts them again each morning, and posts a summary of the instances changed to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: EC2Icon,
      title: 'EC2 unused Elastic IP finder',
      prompt:
        'Build a scheduled weekly workflow that lists Amazon EC2 Elastic IP addresses, flags any with no association, records them in a cost table with their allocation IDs and tags, and asks for approval in Slack before releasing them.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: EC2Icon,
      title: 'EC2 open security group audit',
      prompt:
        'Create a scheduled daily workflow that describes Amazon EC2 security groups, flags inbound rules open to 0.0.0.0/0 or ::/0 on ports other than 80 and 443, and files a finding for each with the group, VPC, and offending rule.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: EC2Icon,
      title: 'EBS nightly snapshot',
      prompt:
        'Build a scheduled nightly workflow that lists Amazon EC2 EBS volumes tagged Backup=true, creates a snapshot of each with a dated description and tags, and logs the snapshot IDs to a backup table.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation'],
    },
    {
      icon: EC2Icon,
      title: 'EC2 unattached volume cleanup',
      prompt:
        'Create a scheduled weekly workflow that finds Amazon EC2 EBS volumes in the available state, estimates their monthly cost from size and type, snapshots each one, and sends the list to Slack for review before deletion.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: EC2Icon,
      title: 'EC2 scheduled event watcher',
      prompt:
        'Build a scheduled workflow that checks Amazon EC2 instance status for impaired status checks and scheduled events such as instance retirement or system reboot, and opens a ticket for each affected instance with the event window.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'monitoring'],
    },
    {
      icon: EC2Icon,
      title: 'EC2 tag compliance enforcer',
      prompt:
        'Create a scheduled workflow that lists Amazon EC2 instances, volumes, and Elastic IPs, finds resources missing the Owner or CostCenter tag, applies a default tag where the owner can be inferred, and reports the rest to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['devops', 'automation'],
      alsoIntegrations: ['slack'],
    },
  ],
  skills: [
    {
      name: 'map-subnet-egress-ips',
      description:
        'Use Amazon EC2 route tables, NAT gateways, and Elastic IPs to work out which public IP each subnet reaches the internet through. Use when a partner or vendor needs your outbound IPs for an allowlist.',
      content:
        "# Map Subnet Egress IPs\n\nWork out the public IPs that outbound traffic from each subnet uses.\n\n## Steps\n1. Describe route tables (filter by vpc-id when the VPC is known) and read each table's subnet associations and its 0.0.0.0/0 route.\n2. For routes that target a NAT gateway, describe that NAT gateway and read the public IPs in its addresses.\n3. For routes that target an internet gateway, note that instances egress through their own public or Elastic IP; describe Elastic IPs to list them.\n4. Subnets with no explicit association use the main route table for the VPC.\n\n## Output\nA table of subnet ID, route table ID, egress target (NAT gateway or internet gateway), and the public egress IPs.",
    },
    {
      name: 'find-unassociated-elastic-ips',
      description:
        'List Amazon EC2 Elastic IP addresses that are not associated with any instance or network interface, which AWS bills for while idle. Use for cost reviews.',
      content:
        '# Find Unassociated Elastic IPs\n\nFind Elastic IPs that are allocated but unused.\n\n## Steps\n1. Describe Elastic IP addresses in the region.\n2. Keep addresses with no association ID, instance ID, or network interface ID.\n3. Exclude addresses whose tags mark them as reserved.\n4. Only release an address after explicit confirmation, because a released IP cannot be guaranteed back.\n\n## Output\nEach unassociated address with its public IP, allocation ID, and tags.',
    },
    {
      name: 'audit-open-security-groups',
      description:
        'Check Amazon EC2 security groups for inbound rules open to the whole internet (0.0.0.0/0 or ::/0), especially on SSH, RDP, and database ports. Use for security reviews.',
      content:
        '# Audit Open Security Groups\n\nFind inbound rules that expose resources to the internet.\n\n## Steps\n1. Describe security groups, optionally filtered by VPC.\n2. For each ingress rule, check IPv4 ranges for 0.0.0.0/0 and IPv6 ranges for ::/0.\n3. Treat protocol -1 (all traffic) and ports 22, 3389, 3306, and 5432 as high severity.\n4. Ports 80 and 443 open to the internet are usually expected for public load balancers; report them separately.\n\n## Output\nEach finding with the group ID, group name, VPC, protocol, port range, and open CIDR.',
    },
    {
      name: 'stop-instances-off-hours',
      description:
        'Stop Amazon EC2 instances tagged for office-hours scheduling outside working hours and start them again in the morning. Use to cut cost on dev and test environments.',
      content:
        '# Stop Instances Off Hours\n\nRun non-production instances only when they are needed.\n\n## Steps\n1. Describe instances with filters tag:Schedule = office-hours and instance-state-name = running (or stopped for the morning run).\n2. Collect the instance IDs.\n3. Stop the instances in the evening, or start them in the morning.\n4. Report the state transitions returned for each instance.\n\n## Output\nThe instance IDs acted on with their previous and current states.',
    },
    {
      name: 'snapshot-tagged-volumes',
      description:
        'Create EBS snapshots of every Amazon EC2 volume carrying a backup tag. Use for scheduled backups.',
      content:
        '# Snapshot Tagged Volumes\n\nBack up EBS volumes that are marked for backup.\n\n## Steps\n1. Describe volumes with the filter tag:Backup = true.\n2. For each volume, create a snapshot with a dated description and tags that record the source volume and run date.\n3. Record the snapshot ID and state for each volume.\n4. Describe snapshots later to confirm they reached the completed state.\n\n## Output\nA list of volume IDs and the snapshot IDs created for them.',
    },
    {
      name: 'find-blackhole-routes',
      description:
        'Find Amazon EC2 VPC routes in the blackhole state, which happen when a route targets a deleted NAT gateway, instance, or network interface. Use when a subnet suddenly loses connectivity.',
      content:
        '# Find Blackhole Routes\n\nLocate routes that point at targets that no longer exist.\n\n## Steps\n1. Describe route tables with the filter route.state = blackhole, optionally narrowed by vpc-id.\n2. For each table, list the routes whose state is blackhole and their target IDs.\n3. List the subnets associated with each affected table.\n\n## Output\nEach blackhole route with its route table, destination CIDR, missing target, and affected subnets.',
    },
    {
      name: 'check-instance-scheduled-events',
      description:
        'Check Amazon EC2 instance status for failed status checks and scheduled maintenance events such as retirement or system reboot. Use to plan around AWS maintenance.',
      content:
        '# Check Instance Scheduled Events\n\nSurface instances that need attention.\n\n## Steps\n1. Describe instance status, including stopped instances if needed.\n2. Flag instances whose instance or system status check is impaired.\n3. List scheduled events with their code, description, and not-before and not-after window.\n\n## Output\nEach affected instance with its failed checks and upcoming events.',
    },
  ],
} as const satisfies BlockMeta
