import { toError } from '@sim/utils/errors'
import type { z } from 'zod'
import {
  executeEc2AllocateAddress,
  executeEc2AssociateAddress,
  executeEc2AuthorizeSecurityGroupIngress,
  executeEc2CreateSnapshot,
  executeEc2CreateTags,
  executeEc2DeleteSnapshot,
  executeEc2DeleteTags,
  executeEc2DeleteVolume,
  executeEc2DescribeAddresses,
  executeEc2DescribeAvailabilityZones,
  executeEc2DescribeImages,
  executeEc2DescribeInstanceStatus,
  executeEc2DescribeInstances,
  executeEc2DescribeInternetGateways,
  executeEc2DescribeKeyPairs,
  executeEc2DescribeNatGateways,
  executeEc2DescribeNetworkAcls,
  executeEc2DescribeNetworkInterfaces,
  executeEc2DescribeRegions,
  executeEc2DescribeRouteTables,
  executeEc2DescribeSecurityGroups,
  executeEc2DescribeSnapshots,
  executeEc2DescribeSubnets,
  executeEc2DescribeVolumes,
  executeEc2DescribeVpcEndpoints,
  executeEc2DescribeVpcPeeringConnections,
  executeEc2DescribeVpcs,
  executeEc2DisassociateAddress,
  executeEc2RebootInstances,
  executeEc2ReleaseAddress,
  executeEc2RevokeSecurityGroupIngress,
  executeEc2StartInstances,
  executeEc2StopInstances,
  executeEc2TerminateInstances,
} from '@/lib/internal/ec2/operations'
import {
  ec2AllocateAddressInputSchema,
  ec2AssociateAddressInputSchema,
  ec2AuthorizeSecurityGroupIngressInputSchema,
  ec2CreateSnapshotInputSchema,
  ec2CreateTagsInputSchema,
  ec2DeleteSnapshotInputSchema,
  ec2DeleteTagsInputSchema,
  ec2DeleteVolumeInputSchema,
  ec2DescribeAddressesInputSchema,
  ec2DescribeAvailabilityZonesInputSchema,
  ec2DescribeImagesInputSchema,
  ec2DescribeInstanceStatusInputSchema,
  ec2DescribeInstancesInputSchema,
  ec2DescribeInternetGatewaysInputSchema,
  ec2DescribeKeyPairsInputSchema,
  ec2DescribeNatGatewaysInputSchema,
  ec2DescribeNetworkAclsInputSchema,
  ec2DescribeNetworkInterfacesInputSchema,
  ec2DescribeRegionsInputSchema,
  ec2DescribeRouteTablesInputSchema,
  ec2DescribeSecurityGroupsInputSchema,
  ec2DescribeSnapshotsInputSchema,
  ec2DescribeSubnetsInputSchema,
  ec2DescribeVolumesInputSchema,
  ec2DescribeVpcEndpointsInputSchema,
  ec2DescribeVpcPeeringConnectionsInputSchema,
  ec2DescribeVpcsInputSchema,
  ec2DisassociateAddressInputSchema,
  ec2InstanceIdsInputSchema,
  ec2ReleaseAddressInputSchema,
  ec2RevokeSecurityGroupIngressInputSchema,
  ec2StopInstancesInputSchema,
} from '@/lib/internal/ec2/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

async function executeOperation<TInput>(
  schema: z.ZodType<TInput>,
  input: unknown,
  execute: (input: TInput, signal?: AbortSignal) => Promise<unknown>,
  errorMessage: string,
  signal?: AbortSignal
): Promise<Response> {
  signal?.throwIfAborted()
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((issue) => issue.message).join('; ')
    return Response.json(
      { error: `Invalid request data: ${reasons}`, details: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    const result = await execute(parsed.data, signal)
    signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    signal?.throwIfAborted()
    return Response.json({ error: `${errorMessage}: ${toError(error).message}` }, { status: 500 })
  }
}

export const executeEc2Tool: InternalToolOperationHandler = async ({ toolId, input, signal }) => {
  signal?.throwIfAborted()

  switch (toolId) {
    case 'ec2_describe_instances':
      return executeOperation(
        ec2DescribeInstancesInputSchema,
        input,
        executeEc2DescribeInstances,
        'Failed to describe EC2 instances',
        signal
      )
    case 'ec2_describe_instance_status':
      return executeOperation(
        ec2DescribeInstanceStatusInputSchema,
        input,
        executeEc2DescribeInstanceStatus,
        'Failed to describe EC2 instance status',
        signal
      )
    case 'ec2_start_instances':
      return executeOperation(
        ec2InstanceIdsInputSchema,
        input,
        executeEc2StartInstances,
        'Failed to start EC2 instances',
        signal
      )
    case 'ec2_stop_instances':
      return executeOperation(
        ec2StopInstancesInputSchema,
        input,
        executeEc2StopInstances,
        'Failed to stop EC2 instances',
        signal
      )
    case 'ec2_reboot_instances':
      return executeOperation(
        ec2InstanceIdsInputSchema,
        input,
        executeEc2RebootInstances,
        'Failed to reboot EC2 instances',
        signal
      )
    case 'ec2_terminate_instances':
      return executeOperation(
        ec2InstanceIdsInputSchema,
        input,
        executeEc2TerminateInstances,
        'Failed to terminate EC2 instances',
        signal
      )
    case 'ec2_describe_addresses':
      return executeOperation(
        ec2DescribeAddressesInputSchema,
        input,
        executeEc2DescribeAddresses,
        'Failed to describe Elastic IP addresses',
        signal
      )
    case 'ec2_allocate_address':
      return executeOperation(
        ec2AllocateAddressInputSchema,
        input,
        executeEc2AllocateAddress,
        'Failed to allocate Elastic IP address',
        signal
      )
    case 'ec2_associate_address':
      return executeOperation(
        ec2AssociateAddressInputSchema,
        input,
        executeEc2AssociateAddress,
        'Failed to associate Elastic IP address',
        signal
      )
    case 'ec2_disassociate_address':
      return executeOperation(
        ec2DisassociateAddressInputSchema,
        input,
        executeEc2DisassociateAddress,
        'Failed to disassociate Elastic IP address',
        signal
      )
    case 'ec2_release_address':
      return executeOperation(
        ec2ReleaseAddressInputSchema,
        input,
        executeEc2ReleaseAddress,
        'Failed to release Elastic IP address',
        signal
      )
    case 'ec2_describe_nat_gateways':
      return executeOperation(
        ec2DescribeNatGatewaysInputSchema,
        input,
        executeEc2DescribeNatGateways,
        'Failed to describe NAT gateways',
        signal
      )
    case 'ec2_describe_route_tables':
      return executeOperation(
        ec2DescribeRouteTablesInputSchema,
        input,
        executeEc2DescribeRouteTables,
        'Failed to describe route tables',
        signal
      )
    case 'ec2_describe_vpcs':
      return executeOperation(
        ec2DescribeVpcsInputSchema,
        input,
        executeEc2DescribeVpcs,
        'Failed to describe VPCs',
        signal
      )
    case 'ec2_describe_subnets':
      return executeOperation(
        ec2DescribeSubnetsInputSchema,
        input,
        executeEc2DescribeSubnets,
        'Failed to describe subnets',
        signal
      )
    case 'ec2_describe_security_groups':
      return executeOperation(
        ec2DescribeSecurityGroupsInputSchema,
        input,
        executeEc2DescribeSecurityGroups,
        'Failed to describe security groups',
        signal
      )
    case 'ec2_describe_internet_gateways':
      return executeOperation(
        ec2DescribeInternetGatewaysInputSchema,
        input,
        executeEc2DescribeInternetGateways,
        'Failed to describe internet gateways',
        signal
      )
    case 'ec2_describe_network_interfaces':
      return executeOperation(
        ec2DescribeNetworkInterfacesInputSchema,
        input,
        executeEc2DescribeNetworkInterfaces,
        'Failed to describe network interfaces',
        signal
      )
    case 'ec2_describe_volumes':
      return executeOperation(
        ec2DescribeVolumesInputSchema,
        input,
        executeEc2DescribeVolumes,
        'Failed to describe EBS volumes',
        signal
      )
    case 'ec2_describe_snapshots':
      return executeOperation(
        ec2DescribeSnapshotsInputSchema,
        input,
        executeEc2DescribeSnapshots,
        'Failed to describe EBS snapshots',
        signal
      )
    case 'ec2_create_snapshot':
      return executeOperation(
        ec2CreateSnapshotInputSchema,
        input,
        executeEc2CreateSnapshot,
        'Failed to create EBS snapshot',
        signal
      )
    case 'ec2_create_tags':
      return executeOperation(
        ec2CreateTagsInputSchema,
        input,
        executeEc2CreateTags,
        'Failed to create EC2 tags',
        signal
      )
    case 'ec2_delete_tags':
      return executeOperation(
        ec2DeleteTagsInputSchema,
        input,
        executeEc2DeleteTags,
        'Failed to delete EC2 tags',
        signal
      )
    case 'ec2_describe_regions':
      return executeOperation(
        ec2DescribeRegionsInputSchema,
        input,
        executeEc2DescribeRegions,
        'Failed to describe EC2 regions',
        signal
      )
    case 'ec2_describe_availability_zones':
      return executeOperation(
        ec2DescribeAvailabilityZonesInputSchema,
        input,
        executeEc2DescribeAvailabilityZones,
        'Failed to describe availability zones',
        signal
      )
    case 'ec2_describe_network_acls':
      return executeOperation(
        ec2DescribeNetworkAclsInputSchema,
        input,
        executeEc2DescribeNetworkAcls,
        'Failed to describe network ACLs',
        signal
      )
    case 'ec2_describe_vpc_endpoints':
      return executeOperation(
        ec2DescribeVpcEndpointsInputSchema,
        input,
        executeEc2DescribeVpcEndpoints,
        'Failed to describe VPC endpoints',
        signal
      )
    case 'ec2_describe_vpc_peering_connections':
      return executeOperation(
        ec2DescribeVpcPeeringConnectionsInputSchema,
        input,
        executeEc2DescribeVpcPeeringConnections,
        'Failed to describe VPC peering connections',
        signal
      )
    case 'ec2_describe_images':
      return executeOperation(
        ec2DescribeImagesInputSchema,
        input,
        executeEc2DescribeImages,
        'Failed to describe AMIs',
        signal
      )
    case 'ec2_describe_key_pairs':
      return executeOperation(
        ec2DescribeKeyPairsInputSchema,
        input,
        executeEc2DescribeKeyPairs,
        'Failed to describe key pairs',
        signal
      )
    case 'ec2_authorize_security_group_ingress':
      return executeOperation(
        ec2AuthorizeSecurityGroupIngressInputSchema,
        input,
        executeEc2AuthorizeSecurityGroupIngress,
        'Failed to authorize security group ingress',
        signal
      )
    case 'ec2_revoke_security_group_ingress':
      return executeOperation(
        ec2RevokeSecurityGroupIngressInputSchema,
        input,
        executeEc2RevokeSecurityGroupIngress,
        'Failed to revoke security group ingress',
        signal
      )
    case 'ec2_delete_volume':
      return executeOperation(
        ec2DeleteVolumeInputSchema,
        input,
        executeEc2DeleteVolume,
        'Failed to delete EBS volume',
        signal
      )
    case 'ec2_delete_snapshot':
      return executeOperation(
        ec2DeleteSnapshotInputSchema,
        input,
        executeEc2DeleteSnapshot,
        'Failed to delete EBS snapshot',
        signal
      )
    default:
      return Response.json({ error: `Unsupported EC2 tool: ${toolId}` }, { status: 500 })
  }
}
