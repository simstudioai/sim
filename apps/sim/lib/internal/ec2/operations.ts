import {
  AllocateAddressCommand,
  AssociateAddressCommand,
  CreateSnapshotCommand,
  CreateTagsCommand,
  DeleteTagsCommand,
  DescribeAddressesCommand,
  DescribeAvailabilityZonesCommand,
  DescribeInstanceStatusCommand,
  DescribeInstancesCommand,
  DescribeInternetGatewaysCommand,
  DescribeNatGatewaysCommand,
  DescribeNetworkInterfacesCommand,
  DescribeRegionsCommand,
  DescribeRouteTablesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSnapshotsCommand,
  DescribeSubnetsCommand,
  DescribeVolumesCommand,
  DescribeVpcsCommand,
  DisassociateAddressCommand,
  type EC2Client,
  type GroupIdentifier,
  type InstanceState,
  type InstanceStateChange,
  type InstanceStatusSummary,
  type IpPermission,
  RebootInstancesCommand,
  ReleaseAddressCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
} from '@aws-sdk/client-ec2'
import { createEc2Client, recordToTags, tagsToRecord, toIsoString } from '@/lib/internal/ec2/client'
import type {
  Ec2AllocateAddressInput,
  Ec2AssociateAddressInput,
  Ec2CreateSnapshotInput,
  Ec2CreateTagsInput,
  Ec2DeleteTagsInput,
  Ec2DescribeAddressesInput,
  Ec2DescribeAvailabilityZonesInput,
  Ec2DescribeInstanceStatusInput,
  Ec2DescribeInstancesInput,
  Ec2DescribeInternetGatewaysInput,
  Ec2DescribeNatGatewaysInput,
  Ec2DescribeNetworkInterfacesInput,
  Ec2DescribeRegionsInput,
  Ec2DescribeRouteTablesInput,
  Ec2DescribeSecurityGroupsInput,
  Ec2DescribeSnapshotsInput,
  Ec2DescribeSubnetsInput,
  Ec2DescribeVolumesInput,
  Ec2DescribeVpcsInput,
  Ec2DisassociateAddressInput,
  Ec2InstanceIdsInput,
  Ec2ReleaseAddressInput,
  Ec2StopInstancesInput,
} from '@/lib/internal/ec2/schema'

/** Page size used when the caller lists without IDs and without an explicit `maxResults`. */
const DEFAULT_PAGE_SIZE = 100

/** AllocateAddress and CreateSnapshot take no client token, so an SDK retry could duplicate them. */
const NON_IDEMPOTENT_MAX_ATTEMPTS = 1

interface PaginationInput {
  maxResults?: number
  nextToken?: string
}

/**
 * EC2 rejects `MaxResults` alongside explicit IDs on several describe calls, and an ID list is
 * already bounded, so pagination applies only to filter/list-all requests.
 */
function pageParams(ids: string[] | undefined, input: PaginationInput) {
  if (ids && ids.length > 0) return {}
  return {
    MaxResults: input.maxResults ?? DEFAULT_PAGE_SIZE,
    ...(input.nextToken && { NextToken: input.nextToken }),
  }
}

async function withClient<T>(
  input: { region: string; accessKeyId: string; secretAccessKey: string },
  run: (client: EC2Client) => Promise<T>,
  options?: { maxAttempts?: number }
): Promise<T> {
  const client = createEc2Client(input, options)
  try {
    return await run(client)
  } finally {
    client.destroy()
  }
}

function mapGroups(groups?: GroupIdentifier[]) {
  return (groups ?? []).map((group) => ({
    groupId: group.GroupId ?? null,
    groupName: group.GroupName ?? null,
  }))
}

function mapStatusSummary(summary?: InstanceStatusSummary) {
  return summary?.Status ?? null
}

function mapStateName(state?: InstanceState) {
  return state?.Name ?? null
}

function mapStateChanges(changes?: InstanceStateChange[]) {
  return (changes ?? []).map((change) => ({
    instanceId: change.InstanceId ?? '',
    currentState: mapStateName(change.CurrentState),
    previousState: mapStateName(change.PreviousState),
  }))
}

function mapIpPermissions(permissions?: IpPermission[]) {
  return (permissions ?? []).map((permission) => ({
    ipProtocol: permission.IpProtocol ?? null,
    fromPort: permission.FromPort ?? null,
    toPort: permission.ToPort ?? null,
    ipv4Ranges: (permission.IpRanges ?? []).map((range) => ({
      cidr: range.CidrIp ?? null,
      description: range.Description ?? null,
    })),
    ipv6Ranges: (permission.Ipv6Ranges ?? []).map((range) => ({
      cidr: range.CidrIpv6 ?? null,
      description: range.Description ?? null,
    })),
    referencedGroups: (permission.UserIdGroupPairs ?? []).map((pair) => ({
      groupId: pair.GroupId ?? null,
      userId: pair.UserId ?? null,
      description: pair.Description ?? null,
    })),
    prefixListIds: (permission.PrefixListIds ?? [])
      .map((prefixList) => prefixList.PrefixListId)
      .filter((id): id is string => Boolean(id)),
  }))
}

export async function executeEc2DescribeInstances(
  input: Ec2DescribeInstancesInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new DescribeInstancesCommand({
        ...(input.instanceIds && { InstanceIds: input.instanceIds }),
        ...(input.filters && { Filters: input.filters }),
        ...pageParams(input.instanceIds, input),
      }),
      { abortSignal: signal }
    )
    const instances = (response.Reservations ?? []).flatMap((reservation) =>
      (reservation.Instances ?? []).map((instance) => ({
        instanceId: instance.InstanceId ?? '',
        instanceType: instance.InstanceType ?? null,
        state: mapStateName(instance.State),
        stateReason: instance.StateReason?.Message ?? null,
        launchTime: toIsoString(instance.LaunchTime),
        availabilityZone: instance.Placement?.AvailabilityZone ?? null,
        vpcId: instance.VpcId ?? null,
        subnetId: instance.SubnetId ?? null,
        privateIpAddress: instance.PrivateIpAddress ?? null,
        publicIpAddress: instance.PublicIpAddress ?? null,
        privateDnsName: instance.PrivateDnsName || null,
        publicDnsName: instance.PublicDnsName || null,
        imageId: instance.ImageId ?? null,
        keyName: instance.KeyName ?? null,
        platformDetails: instance.PlatformDetails ?? null,
        architecture: instance.Architecture ?? null,
        iamInstanceProfileArn: instance.IamInstanceProfile?.Arn ?? null,
        securityGroups: mapGroups(instance.SecurityGroups),
        tags: tagsToRecord(instance.Tags),
      }))
    )
    return { instances, nextToken: response.NextToken ?? null }
  })
}

export async function executeEc2DescribeInstanceStatus(
  input: Ec2DescribeInstanceStatusInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new DescribeInstanceStatusCommand({
        ...(input.instanceIds && { InstanceIds: input.instanceIds }),
        ...(input.filters && { Filters: input.filters }),
        ...(input.includeAllInstances !== undefined && {
          IncludeAllInstances: input.includeAllInstances,
        }),
        ...pageParams(input.instanceIds, input),
      }),
      { abortSignal: signal }
    )
    const instanceStatuses = (response.InstanceStatuses ?? []).map((status) => ({
      instanceId: status.InstanceId ?? '',
      availabilityZone: status.AvailabilityZone ?? null,
      instanceState: mapStateName(status.InstanceState),
      instanceStatus: mapStatusSummary(status.InstanceStatus),
      systemStatus: mapStatusSummary(status.SystemStatus),
      attachedEbsStatus: status.AttachedEbsStatus?.Status ?? null,
      events: (status.Events ?? []).map((event) => ({
        code: event.Code ?? null,
        description: event.Description ?? null,
        notBefore: toIsoString(event.NotBefore),
        notAfter: toIsoString(event.NotAfter),
      })),
    }))
    return { instanceStatuses, nextToken: response.NextToken ?? null }
  })
}

export async function executeEc2StartInstances(input: Ec2InstanceIdsInput, signal?: AbortSignal) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new StartInstancesCommand({ InstanceIds: input.instanceIds }),
      { abortSignal: signal }
    )
    return { instances: mapStateChanges(response.StartingInstances) }
  })
}

export async function executeEc2StopInstances(input: Ec2StopInstancesInput, signal?: AbortSignal) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new StopInstancesCommand({
        InstanceIds: input.instanceIds,
        ...(input.hibernate !== undefined && { Hibernate: input.hibernate }),
        ...(input.force !== undefined && { Force: input.force }),
      }),
      { abortSignal: signal }
    )
    return { instances: mapStateChanges(response.StoppingInstances) }
  })
}

export async function executeEc2RebootInstances(input: Ec2InstanceIdsInput, signal?: AbortSignal) {
  return withClient(input, async (client) => {
    await client.send(new RebootInstancesCommand({ InstanceIds: input.instanceIds }), {
      abortSignal: signal,
    })
    return { rebooted: true, instanceIds: input.instanceIds }
  })
}

export async function executeEc2TerminateInstances(
  input: Ec2InstanceIdsInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new TerminateInstancesCommand({ InstanceIds: input.instanceIds }),
      { abortSignal: signal }
    )
    return { instances: mapStateChanges(response.TerminatingInstances) }
  })
}

export async function executeEc2DescribeAddresses(
  input: Ec2DescribeAddressesInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new DescribeAddressesCommand({
        ...(input.publicIps && { PublicIps: input.publicIps }),
        ...(input.allocationIds && { AllocationIds: input.allocationIds }),
        ...(input.filters && { Filters: input.filters }),
      }),
      { abortSignal: signal }
    )
    const addresses = (response.Addresses ?? []).map((address) => ({
      publicIp: address.PublicIp ?? null,
      allocationId: address.AllocationId ?? null,
      associationId: address.AssociationId ?? null,
      domain: address.Domain ?? null,
      instanceId: address.InstanceId || null,
      networkInterfaceId: address.NetworkInterfaceId ?? null,
      networkInterfaceOwnerId: address.NetworkInterfaceOwnerId ?? null,
      privateIpAddress: address.PrivateIpAddress ?? null,
      publicIpv4Pool: address.PublicIpv4Pool ?? null,
      networkBorderGroup: address.NetworkBorderGroup ?? null,
      serviceManaged: address.ServiceManaged ?? null,
      tags: tagsToRecord(address.Tags),
    }))
    return { addresses }
  })
}

export async function executeEc2AllocateAddress(
  input: Ec2AllocateAddressInput,
  signal?: AbortSignal
) {
  return withClient(
    input,
    async (client) => {
      const response = await client.send(
        new AllocateAddressCommand({
          Domain: 'vpc',
          ...(input.networkBorderGroup && { NetworkBorderGroup: input.networkBorderGroup }),
          ...(input.publicIpv4Pool && { PublicIpv4Pool: input.publicIpv4Pool }),
          ...(input.tags &&
            Object.keys(input.tags).length > 0 && {
              TagSpecifications: [{ ResourceType: 'elastic-ip', Tags: recordToTags(input.tags) }],
            }),
        }),
        { abortSignal: signal }
      )
      return {
        allocationId: response.AllocationId ?? '',
        publicIp: response.PublicIp ?? '',
        domain: response.Domain ?? null,
        networkBorderGroup: response.NetworkBorderGroup ?? null,
        publicIpv4Pool: response.PublicIpv4Pool ?? null,
      }
    },
    { maxAttempts: NON_IDEMPOTENT_MAX_ATTEMPTS }
  )
}

export async function executeEc2AssociateAddress(
  input: Ec2AssociateAddressInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new AssociateAddressCommand({
        AllocationId: input.allocationId,
        ...(input.instanceId && { InstanceId: input.instanceId }),
        ...(input.networkInterfaceId && { NetworkInterfaceId: input.networkInterfaceId }),
        ...(input.privateIpAddress && { PrivateIpAddress: input.privateIpAddress }),
        ...(input.allowReassociation !== undefined && {
          AllowReassociation: input.allowReassociation,
        }),
      }),
      { abortSignal: signal }
    )
    return { associationId: response.AssociationId ?? '' }
  })
}

export async function executeEc2DisassociateAddress(
  input: Ec2DisassociateAddressInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    await client.send(new DisassociateAddressCommand({ AssociationId: input.associationId }), {
      abortSignal: signal,
    })
    return { disassociated: true, associationId: input.associationId }
  })
}

export async function executeEc2ReleaseAddress(
  input: Ec2ReleaseAddressInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    await client.send(
      new ReleaseAddressCommand({
        AllocationId: input.allocationId,
        ...(input.networkBorderGroup && { NetworkBorderGroup: input.networkBorderGroup }),
      }),
      { abortSignal: signal }
    )
    return { released: true, allocationId: input.allocationId }
  })
}

export async function executeEc2DescribeNatGateways(
  input: Ec2DescribeNatGatewaysInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new DescribeNatGatewaysCommand({
        ...(input.natGatewayIds && { NatGatewayIds: input.natGatewayIds }),
        ...(input.filters && { Filter: input.filters }),
        ...pageParams(input.natGatewayIds, input),
      }),
      { abortSignal: signal }
    )
    const natGateways = (response.NatGateways ?? []).map((gateway) => ({
      natGatewayId: gateway.NatGatewayId ?? '',
      state: gateway.State ?? null,
      connectivityType: gateway.ConnectivityType ?? null,
      vpcId: gateway.VpcId ?? null,
      subnetId: gateway.SubnetId ?? null,
      createTime: toIsoString(gateway.CreateTime),
      deleteTime: toIsoString(gateway.DeleteTime),
      failureCode: gateway.FailureCode ?? null,
      failureMessage: gateway.FailureMessage ?? null,
      addresses: (gateway.NatGatewayAddresses ?? []).map((address) => ({
        allocationId: address.AllocationId ?? null,
        networkInterfaceId: address.NetworkInterfaceId ?? null,
        privateIp: address.PrivateIp ?? null,
        publicIp: address.PublicIp ?? null,
        associationId: address.AssociationId ?? null,
        isPrimary: address.IsPrimary ?? null,
        status: address.Status ?? null,
      })),
      tags: tagsToRecord(gateway.Tags),
    }))
    return { natGateways, nextToken: response.NextToken ?? null }
  })
}

export async function executeEc2DescribeRouteTables(
  input: Ec2DescribeRouteTablesInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new DescribeRouteTablesCommand({
        ...(input.routeTableIds && { RouteTableIds: input.routeTableIds }),
        ...(input.filters && { Filters: input.filters }),
        ...pageParams(input.routeTableIds, input),
      }),
      { abortSignal: signal }
    )
    const routeTables = (response.RouteTables ?? []).map((table) => ({
      routeTableId: table.RouteTableId ?? '',
      vpcId: table.VpcId ?? null,
      ownerId: table.OwnerId ?? null,
      routes: (table.Routes ?? []).map((route) => ({
        destinationCidrBlock: route.DestinationCidrBlock ?? null,
        destinationIpv6CidrBlock: route.DestinationIpv6CidrBlock ?? null,
        destinationPrefixListId: route.DestinationPrefixListId ?? null,
        gatewayId: route.GatewayId ?? null,
        natGatewayId: route.NatGatewayId ?? null,
        transitGatewayId: route.TransitGatewayId ?? null,
        vpcPeeringConnectionId: route.VpcPeeringConnectionId ?? null,
        networkInterfaceId: route.NetworkInterfaceId ?? null,
        instanceId: route.InstanceId ?? null,
        egressOnlyInternetGatewayId: route.EgressOnlyInternetGatewayId ?? null,
        state: route.State ?? null,
        origin: route.Origin ?? null,
      })),
      associations: (table.Associations ?? []).map((association) => ({
        associationId: association.RouteTableAssociationId ?? null,
        main: association.Main ?? false,
        subnetId: association.SubnetId ?? null,
        gatewayId: association.GatewayId ?? null,
        state: association.AssociationState?.State ?? null,
      })),
      tags: tagsToRecord(table.Tags),
    }))
    return { routeTables, nextToken: response.NextToken ?? null }
  })
}

export async function executeEc2DescribeVpcs(input: Ec2DescribeVpcsInput, signal?: AbortSignal) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new DescribeVpcsCommand({
        ...(input.vpcIds && { VpcIds: input.vpcIds }),
        ...(input.filters && { Filters: input.filters }),
        ...pageParams(input.vpcIds, input),
      }),
      { abortSignal: signal }
    )
    const vpcs = (response.Vpcs ?? []).map((vpc) => ({
      vpcId: vpc.VpcId ?? '',
      cidrBlock: vpc.CidrBlock ?? null,
      cidrBlocks: (vpc.CidrBlockAssociationSet ?? [])
        .map((association) => association.CidrBlock)
        .filter((cidr): cidr is string => Boolean(cidr)),
      ipv6CidrBlocks: (vpc.Ipv6CidrBlockAssociationSet ?? [])
        .map((association) => association.Ipv6CidrBlock)
        .filter((cidr): cidr is string => Boolean(cidr)),
      state: vpc.State ?? null,
      isDefault: vpc.IsDefault ?? false,
      instanceTenancy: vpc.InstanceTenancy ?? null,
      dhcpOptionsId: vpc.DhcpOptionsId ?? null,
      ownerId: vpc.OwnerId ?? null,
      tags: tagsToRecord(vpc.Tags),
    }))
    return { vpcs, nextToken: response.NextToken ?? null }
  })
}

export async function executeEc2DescribeSubnets(
  input: Ec2DescribeSubnetsInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new DescribeSubnetsCommand({
        ...(input.subnetIds && { SubnetIds: input.subnetIds }),
        ...(input.filters && { Filters: input.filters }),
        ...pageParams(input.subnetIds, input),
      }),
      { abortSignal: signal }
    )
    const subnets = (response.Subnets ?? []).map((subnet) => ({
      subnetId: subnet.SubnetId ?? '',
      subnetArn: subnet.SubnetArn ?? null,
      vpcId: subnet.VpcId ?? null,
      cidrBlock: subnet.CidrBlock ?? null,
      ipv6CidrBlocks: (subnet.Ipv6CidrBlockAssociationSet ?? [])
        .map((association) => association.Ipv6CidrBlock)
        .filter((cidr): cidr is string => Boolean(cidr)),
      availabilityZone: subnet.AvailabilityZone ?? null,
      availabilityZoneId: subnet.AvailabilityZoneId ?? null,
      availableIpAddressCount: subnet.AvailableIpAddressCount ?? null,
      state: subnet.State ?? null,
      defaultForAz: subnet.DefaultForAz ?? false,
      mapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch ?? false,
      ownerId: subnet.OwnerId ?? null,
      tags: tagsToRecord(subnet.Tags),
    }))
    return { subnets, nextToken: response.NextToken ?? null }
  })
}

export async function executeEc2DescribeSecurityGroups(
  input: Ec2DescribeSecurityGroupsInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new DescribeSecurityGroupsCommand({
        ...(input.groupIds && { GroupIds: input.groupIds }),
        ...(input.filters && { Filters: input.filters }),
        ...pageParams(input.groupIds, input),
      }),
      { abortSignal: signal }
    )
    const securityGroups = (response.SecurityGroups ?? []).map((group) => ({
      groupId: group.GroupId ?? '',
      groupName: group.GroupName ?? null,
      description: group.Description ?? null,
      vpcId: group.VpcId ?? null,
      ownerId: group.OwnerId ?? null,
      ingressRules: mapIpPermissions(group.IpPermissions),
      egressRules: mapIpPermissions(group.IpPermissionsEgress),
      tags: tagsToRecord(group.Tags),
    }))
    return { securityGroups, nextToken: response.NextToken ?? null }
  })
}

export async function executeEc2DescribeInternetGateways(
  input: Ec2DescribeInternetGatewaysInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new DescribeInternetGatewaysCommand({
        ...(input.internetGatewayIds && { InternetGatewayIds: input.internetGatewayIds }),
        ...(input.filters && { Filters: input.filters }),
        ...pageParams(input.internetGatewayIds, input),
      }),
      { abortSignal: signal }
    )
    const internetGateways = (response.InternetGateways ?? []).map((gateway) => ({
      internetGatewayId: gateway.InternetGatewayId ?? '',
      ownerId: gateway.OwnerId ?? null,
      attachments: (gateway.Attachments ?? []).map((attachment) => ({
        vpcId: attachment.VpcId ?? null,
        state: attachment.State ?? null,
      })),
      tags: tagsToRecord(gateway.Tags),
    }))
    return { internetGateways, nextToken: response.NextToken ?? null }
  })
}

export async function executeEc2DescribeNetworkInterfaces(
  input: Ec2DescribeNetworkInterfacesInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new DescribeNetworkInterfacesCommand({
        ...(input.networkInterfaceIds && { NetworkInterfaceIds: input.networkInterfaceIds }),
        ...(input.filters && { Filters: input.filters }),
        ...pageParams(input.networkInterfaceIds, input),
      }),
      { abortSignal: signal }
    )
    const networkInterfaces = (response.NetworkInterfaces ?? []).map((eni) => ({
      networkInterfaceId: eni.NetworkInterfaceId ?? '',
      interfaceType: eni.InterfaceType ?? null,
      status: eni.Status ?? null,
      description: eni.Description || null,
      vpcId: eni.VpcId ?? null,
      subnetId: eni.SubnetId ?? null,
      availabilityZone: eni.AvailabilityZone ?? null,
      privateIpAddress: eni.PrivateIpAddress ?? null,
      privateIpAddresses: (eni.PrivateIpAddresses ?? [])
        .map((address) => address.PrivateIpAddress)
        .filter((ip): ip is string => Boolean(ip)),
      publicIp: eni.Association?.PublicIp ?? null,
      macAddress: eni.MacAddress ?? null,
      requesterManaged: eni.RequesterManaged ?? false,
      attachment: eni.Attachment
        ? {
            attachmentId: eni.Attachment.AttachmentId ?? null,
            instanceId: eni.Attachment.InstanceId ?? null,
            deviceIndex: eni.Attachment.DeviceIndex ?? null,
            status: eni.Attachment.Status ?? null,
            deleteOnTermination: eni.Attachment.DeleteOnTermination ?? null,
          }
        : null,
      securityGroups: mapGroups(eni.Groups),
      tags: tagsToRecord(eni.TagSet),
    }))
    return { networkInterfaces, nextToken: response.NextToken ?? null }
  })
}

export async function executeEc2DescribeVolumes(
  input: Ec2DescribeVolumesInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new DescribeVolumesCommand({
        ...(input.volumeIds && { VolumeIds: input.volumeIds }),
        ...(input.filters && { Filters: input.filters }),
        ...pageParams(input.volumeIds, input),
      }),
      { abortSignal: signal }
    )
    const volumes = (response.Volumes ?? []).map((volume) => ({
      volumeId: volume.VolumeId ?? '',
      volumeType: volume.VolumeType ?? null,
      size: volume.Size ?? null,
      state: volume.State ?? null,
      availabilityZone: volume.AvailabilityZone ?? null,
      iops: volume.Iops ?? null,
      throughput: volume.Throughput ?? null,
      encrypted: volume.Encrypted ?? false,
      kmsKeyId: volume.KmsKeyId ?? null,
      snapshotId: volume.SnapshotId || null,
      createTime: toIsoString(volume.CreateTime),
      multiAttachEnabled: volume.MultiAttachEnabled ?? false,
      attachments: (volume.Attachments ?? []).map((attachment) => ({
        instanceId: attachment.InstanceId ?? null,
        device: attachment.Device ?? null,
        state: attachment.State ?? null,
        attachTime: toIsoString(attachment.AttachTime),
        deleteOnTermination: attachment.DeleteOnTermination ?? null,
      })),
      tags: tagsToRecord(volume.Tags),
    }))
    return { volumes, nextToken: response.NextToken ?? null }
  })
}

export async function executeEc2DescribeSnapshots(
  input: Ec2DescribeSnapshotsInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new DescribeSnapshotsCommand({
        ...(input.snapshotIds && { SnapshotIds: input.snapshotIds }),
        // Without an owner scope a list call also returns every public snapshot in the region;
        // explicit snapshot IDs may name snapshots shared from another account.
        ...(input.ownerIds
          ? { OwnerIds: input.ownerIds }
          : !input.snapshotIds && { OwnerIds: ['self'] }),
        ...(input.filters && { Filters: input.filters }),
        ...pageParams(input.snapshotIds, input),
      }),
      { abortSignal: signal }
    )
    const snapshots = (response.Snapshots ?? []).map((snapshot) => ({
      snapshotId: snapshot.SnapshotId ?? '',
      volumeId: snapshot.VolumeId ?? null,
      volumeSize: snapshot.VolumeSize ?? null,
      state: snapshot.State ?? null,
      progress: snapshot.Progress ?? null,
      startTime: toIsoString(snapshot.StartTime),
      description: snapshot.Description || null,
      ownerId: snapshot.OwnerId ?? null,
      encrypted: snapshot.Encrypted ?? false,
      kmsKeyId: snapshot.KmsKeyId ?? null,
      storageTier: snapshot.StorageTier ?? null,
      tags: tagsToRecord(snapshot.Tags),
    }))
    return { snapshots, nextToken: response.NextToken ?? null }
  })
}

export async function executeEc2CreateSnapshot(
  input: Ec2CreateSnapshotInput,
  signal?: AbortSignal
) {
  return withClient(
    input,
    async (client) => {
      const response = await client.send(
        new CreateSnapshotCommand({
          VolumeId: input.volumeId,
          ...(input.description && { Description: input.description }),
          ...(input.tags &&
            Object.keys(input.tags).length > 0 && {
              TagSpecifications: [{ ResourceType: 'snapshot', Tags: recordToTags(input.tags) }],
            }),
        }),
        { abortSignal: signal }
      )
      return {
        snapshotId: response.SnapshotId ?? '',
        volumeId: response.VolumeId ?? input.volumeId,
        volumeSize: response.VolumeSize ?? null,
        state: response.State ?? null,
        startTime: toIsoString(response.StartTime),
        description: response.Description || null,
        encrypted: response.Encrypted ?? false,
        ownerId: response.OwnerId ?? null,
        tags: tagsToRecord(response.Tags),
      }
    },
    { maxAttempts: NON_IDEMPOTENT_MAX_ATTEMPTS }
  )
}

export async function executeEc2CreateTags(input: Ec2CreateTagsInput, signal?: AbortSignal) {
  return withClient(input, async (client) => {
    const tags = input.tags ?? {}
    await client.send(
      new CreateTagsCommand({ Resources: input.resourceIds, Tags: recordToTags(tags) }),
      { abortSignal: signal }
    )
    return { resourceIds: input.resourceIds, tags }
  })
}

export async function executeEc2DeleteTags(input: Ec2DeleteTagsInput, signal?: AbortSignal) {
  return withClient(input, async (client) => {
    await client.send(
      new DeleteTagsCommand({
        Resources: input.resourceIds,
        Tags: input.tagKeys.map((Key) => ({ Key })),
      }),
      { abortSignal: signal }
    )
    return { resourceIds: input.resourceIds, tagKeys: input.tagKeys }
  })
}

export async function executeEc2DescribeRegions(
  input: Ec2DescribeRegionsInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new DescribeRegionsCommand({
        ...(input.regionNames && { RegionNames: input.regionNames }),
        ...(input.allRegions !== undefined && { AllRegions: input.allRegions }),
        ...(input.filters && { Filters: input.filters }),
      }),
      { abortSignal: signal }
    )
    const regions = (response.Regions ?? []).map((region) => ({
      regionName: region.RegionName ?? '',
      endpoint: region.Endpoint ?? null,
      optInStatus: region.OptInStatus ?? null,
    }))
    return { regions }
  })
}

export async function executeEc2DescribeAvailabilityZones(
  input: Ec2DescribeAvailabilityZonesInput,
  signal?: AbortSignal
) {
  return withClient(input, async (client) => {
    const response = await client.send(
      new DescribeAvailabilityZonesCommand({
        ...(input.zoneNames && { ZoneNames: input.zoneNames }),
        ...(input.allAvailabilityZones !== undefined && {
          AllAvailabilityZones: input.allAvailabilityZones,
        }),
        ...(input.filters && { Filters: input.filters }),
      }),
      { abortSignal: signal }
    )
    const availabilityZones = (response.AvailabilityZones ?? []).map((zone) => ({
      zoneName: zone.ZoneName ?? '',
      zoneId: zone.ZoneId ?? null,
      zoneType: zone.ZoneType ?? null,
      state: zone.State ?? null,
      regionName: zone.RegionName ?? null,
      groupName: zone.GroupName ?? null,
      networkBorderGroup: zone.NetworkBorderGroup ?? null,
      optInStatus: zone.OptInStatus ?? null,
    }))
    return { availabilityZones }
  })
}
