import { allocateAddressTool } from './allocate_address'
import { associateAddressTool } from './associate_address'
import { authorizeSecurityGroupIngressTool } from './authorize_security_group_ingress'
import { createSnapshotTool } from './create_snapshot'
import { createTagsTool } from './create_tags'
import { deleteSnapshotTool } from './delete_snapshot'
import { deleteTagsTool } from './delete_tags'
import { deleteVolumeTool } from './delete_volume'
import { describeAddressesTool } from './describe_addresses'
import { describeAvailabilityZonesTool } from './describe_availability_zones'
import { describeImagesTool } from './describe_images'
import { describeInstanceStatusTool } from './describe_instance_status'
import { describeInstancesTool } from './describe_instances'
import { describeInternetGatewaysTool } from './describe_internet_gateways'
import { describeKeyPairsTool } from './describe_key_pairs'
import { describeNatGatewaysTool } from './describe_nat_gateways'
import { describeNetworkAclsTool } from './describe_network_acls'
import { describeNetworkInterfacesTool } from './describe_network_interfaces'
import { describeRegionsTool } from './describe_regions'
import { describeRouteTablesTool } from './describe_route_tables'
import { describeSecurityGroupsTool } from './describe_security_groups'
import { describeSnapshotsTool } from './describe_snapshots'
import { describeSubnetsTool } from './describe_subnets'
import { describeVolumesTool } from './describe_volumes'
import { describeVpcEndpointsTool } from './describe_vpc_endpoints'
import { describeVpcPeeringConnectionsTool } from './describe_vpc_peering_connections'
import { describeVpcsTool } from './describe_vpcs'
import { disassociateAddressTool } from './disassociate_address'
import { rebootInstancesTool } from './reboot_instances'
import { releaseAddressTool } from './release_address'
import { revokeSecurityGroupIngressTool } from './revoke_security_group_ingress'
import { startInstancesTool } from './start_instances'
import { stopInstancesTool } from './stop_instances'
import { terminateInstancesTool } from './terminate_instances'

export const ec2DescribeInstancesTool = describeInstancesTool
export const ec2DescribeInstanceStatusTool = describeInstanceStatusTool
export const ec2StartInstancesTool = startInstancesTool
export const ec2StopInstancesTool = stopInstancesTool
export const ec2RebootInstancesTool = rebootInstancesTool
export const ec2TerminateInstancesTool = terminateInstancesTool
export const ec2DescribeAddressesTool = describeAddressesTool
export const ec2AllocateAddressTool = allocateAddressTool
export const ec2AssociateAddressTool = associateAddressTool
export const ec2DisassociateAddressTool = disassociateAddressTool
export const ec2ReleaseAddressTool = releaseAddressTool
export const ec2DescribeNatGatewaysTool = describeNatGatewaysTool
export const ec2DescribeRouteTablesTool = describeRouteTablesTool
export const ec2DescribeVpcsTool = describeVpcsTool
export const ec2DescribeSubnetsTool = describeSubnetsTool
export const ec2DescribeSecurityGroupsTool = describeSecurityGroupsTool
export const ec2DescribeInternetGatewaysTool = describeInternetGatewaysTool
export const ec2DescribeNetworkInterfacesTool = describeNetworkInterfacesTool
export const ec2DescribeVolumesTool = describeVolumesTool
export const ec2DescribeSnapshotsTool = describeSnapshotsTool
export const ec2CreateSnapshotTool = createSnapshotTool
export const ec2CreateTagsTool = createTagsTool
export const ec2DeleteTagsTool = deleteTagsTool
export const ec2DescribeRegionsTool = describeRegionsTool
export const ec2DescribeAvailabilityZonesTool = describeAvailabilityZonesTool
export const ec2DescribeNetworkAclsTool = describeNetworkAclsTool
export const ec2DescribeVpcEndpointsTool = describeVpcEndpointsTool
export const ec2DescribeVpcPeeringConnectionsTool = describeVpcPeeringConnectionsTool
export const ec2DescribeImagesTool = describeImagesTool
export const ec2DescribeKeyPairsTool = describeKeyPairsTool
export const ec2AuthorizeSecurityGroupIngressTool = authorizeSecurityGroupIngressTool
export const ec2RevokeSecurityGroupIngressTool = revokeSecurityGroupIngressTool
export const ec2DeleteVolumeTool = deleteVolumeTool
export const ec2DeleteSnapshotTool = deleteSnapshotTool

export * from './types'
