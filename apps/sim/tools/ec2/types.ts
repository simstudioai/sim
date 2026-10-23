import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface Ec2ConnectionParams {
  awsRegion: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
}

export const EC2_TAGS_OUTPUT: OutputProperty = {
  type: 'json',
  description: 'Resource tags as key/value pairs',
}

export const EC2_NEXT_TOKEN_OUTPUT: OutputProperty = {
  type: 'string',
  description: 'Pagination token for the next page, or null when there are no more results',
  nullable: true,
}

export interface Ec2DescribeInstancesParams extends Ec2ConnectionParams {
  instanceIds?: string | null
  filters?: unknown | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeInstancesResponse extends ToolResponse {
  output: {
    instances: {
      instanceId: string
      instanceType: string | null
      state: string | null
      stateReason: string | null
      launchTime: string | null
      availabilityZone: string | null
      vpcId: string | null
      subnetId: string | null
      privateIpAddress: string | null
      publicIpAddress: string | null
      privateDnsName: string | null
      publicDnsName: string | null
      imageId: string | null
      keyName: string | null
      platformDetails: string | null
      architecture: string | null
      iamInstanceProfileArn: string | null
      securityGroups: {
        groupId: string | null
        groupName: string | null
      }[]
      tags: Record<string, string>
    }[]
    nextToken: string | null
  }
}

export interface Ec2DescribeInstanceStatusParams extends Ec2ConnectionParams {
  instanceIds?: string | null
  filters?: unknown | null
  includeAllInstances?: boolean | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeInstanceStatusResponse extends ToolResponse {
  output: {
    instanceStatuses: {
      instanceId: string
      availabilityZone: string | null
      instanceState: string | null
      instanceStatus: string | null
      systemStatus: string | null
      attachedEbsStatus: string | null
      events: {
        code: string | null
        description: string | null
        notBefore: string | null
        notAfter: string | null
      }[]
    }[]
    nextToken: string | null
  }
}

export interface Ec2StartInstancesParams extends Ec2ConnectionParams {
  instanceIds: string
}

export interface Ec2StartInstancesResponse extends ToolResponse {
  output: {
    instances: {
      instanceId: string
      currentState: string | null
      previousState: string | null
    }[]
  }
}

export interface Ec2StopInstancesParams extends Ec2ConnectionParams {
  instanceIds: string
  hibernate?: boolean | null
  force?: boolean | null
}

export interface Ec2StopInstancesResponse extends ToolResponse {
  output: {
    instances: {
      instanceId: string
      currentState: string | null
      previousState: string | null
    }[]
  }
}

export interface Ec2RebootInstancesParams extends Ec2ConnectionParams {
  instanceIds: string
}

export interface Ec2RebootInstancesResponse extends ToolResponse {
  output: {
    rebooted: boolean
    instanceIds: string[]
  }
}

export interface Ec2TerminateInstancesParams extends Ec2ConnectionParams {
  instanceIds: string
}

export interface Ec2TerminateInstancesResponse extends ToolResponse {
  output: {
    instances: {
      instanceId: string
      currentState: string | null
      previousState: string | null
    }[]
  }
}

export interface Ec2DescribeAddressesParams extends Ec2ConnectionParams {
  publicIps?: string | null
  allocationIds?: string | null
  filters?: unknown | null
}

export interface Ec2DescribeAddressesResponse extends ToolResponse {
  output: {
    addresses: {
      publicIp: string | null
      allocationId: string | null
      associationId: string | null
      domain: string | null
      instanceId: string | null
      networkInterfaceId: string | null
      networkInterfaceOwnerId: string | null
      privateIpAddress: string | null
      publicIpv4Pool: string | null
      networkBorderGroup: string | null
      serviceManaged: string | null
      tags: Record<string, string>
    }[]
  }
}

export interface Ec2AllocateAddressParams extends Ec2ConnectionParams {
  networkBorderGroup?: string | null
  publicIpv4Pool?: string | null
  tags?: unknown | null
}

export interface Ec2AllocateAddressResponse extends ToolResponse {
  output: {
    allocationId: string
    publicIp: string
    domain: string | null
    networkBorderGroup: string | null
    publicIpv4Pool: string | null
  }
}

export interface Ec2AssociateAddressParams extends Ec2ConnectionParams {
  allocationId: string
  instanceId?: string | null
  networkInterfaceId?: string | null
  privateIpAddress?: string | null
  allowReassociation?: boolean | null
}

export interface Ec2AssociateAddressResponse extends ToolResponse {
  output: {
    associationId: string
  }
}

export interface Ec2DisassociateAddressParams extends Ec2ConnectionParams {
  associationId: string
}

export interface Ec2DisassociateAddressResponse extends ToolResponse {
  output: {
    disassociated: boolean
    associationId: string
  }
}

export interface Ec2ReleaseAddressParams extends Ec2ConnectionParams {
  allocationId: string
  networkBorderGroup?: string | null
}

export interface Ec2ReleaseAddressResponse extends ToolResponse {
  output: {
    released: boolean
    allocationId: string
  }
}

export interface Ec2DescribeNatGatewaysParams extends Ec2ConnectionParams {
  natGatewayIds?: string | null
  filters?: unknown | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeNatGatewaysResponse extends ToolResponse {
  output: {
    natGateways: {
      natGatewayId: string
      state: string | null
      connectivityType: string | null
      vpcId: string | null
      subnetId: string | null
      createTime: string | null
      deleteTime: string | null
      failureCode: string | null
      failureMessage: string | null
      addresses: {
        allocationId: string | null
        networkInterfaceId: string | null
        privateIp: string | null
        publicIp: string | null
        associationId: string | null
        isPrimary: boolean | null
        status: string | null
      }[]
      tags: Record<string, string>
    }[]
    nextToken: string | null
  }
}

export interface Ec2DescribeRouteTablesParams extends Ec2ConnectionParams {
  routeTableIds?: string | null
  filters?: unknown | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeRouteTablesResponse extends ToolResponse {
  output: {
    routeTables: {
      routeTableId: string
      vpcId: string | null
      ownerId: string | null
      routes: {
        destinationCidrBlock: string | null
        destinationIpv6CidrBlock: string | null
        destinationPrefixListId: string | null
        gatewayId: string | null
        natGatewayId: string | null
        transitGatewayId: string | null
        vpcPeeringConnectionId: string | null
        networkInterfaceId: string | null
        instanceId: string | null
        egressOnlyInternetGatewayId: string | null
        state: string | null
        origin: string | null
      }[]
      associations: {
        associationId: string | null
        main: boolean
        subnetId: string | null
        gatewayId: string | null
        state: string | null
      }[]
      tags: Record<string, string>
    }[]
    nextToken: string | null
  }
}

export interface Ec2DescribeVpcsParams extends Ec2ConnectionParams {
  vpcIds?: string | null
  filters?: unknown | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeVpcsResponse extends ToolResponse {
  output: {
    vpcs: {
      vpcId: string
      cidrBlock: string | null
      cidrBlocks: string[]
      ipv6CidrBlocks: string[]
      state: string | null
      isDefault: boolean
      instanceTenancy: string | null
      dhcpOptionsId: string | null
      ownerId: string | null
      tags: Record<string, string>
    }[]
    nextToken: string | null
  }
}

export interface Ec2DescribeSubnetsParams extends Ec2ConnectionParams {
  subnetIds?: string | null
  filters?: unknown | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeSubnetsResponse extends ToolResponse {
  output: {
    subnets: {
      subnetId: string
      subnetArn: string | null
      vpcId: string | null
      cidrBlock: string | null
      ipv6CidrBlocks: string[]
      availabilityZone: string | null
      availabilityZoneId: string | null
      availableIpAddressCount: number | null
      state: string | null
      defaultForAz: boolean
      mapPublicIpOnLaunch: boolean
      ownerId: string | null
      tags: Record<string, string>
    }[]
    nextToken: string | null
  }
}

export interface Ec2DescribeSecurityGroupsParams extends Ec2ConnectionParams {
  groupIds?: string | null
  filters?: unknown | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeSecurityGroupsResponse extends ToolResponse {
  output: {
    securityGroups: {
      groupId: string
      groupName: string | null
      description: string | null
      vpcId: string | null
      ownerId: string | null
      ingressRules: {
        ipProtocol: string | null
        fromPort: number | null
        toPort: number | null
        ipv4Ranges: {
          cidr: string | null
          description: string | null
        }[]
        ipv6Ranges: {
          cidr: string | null
          description: string | null
        }[]
        referencedGroups: {
          groupId: string | null
          userId: string | null
          description: string | null
        }[]
        prefixListIds: string[]
      }[]
      egressRules: {
        ipProtocol: string | null
        fromPort: number | null
        toPort: number | null
        ipv4Ranges: {
          cidr: string | null
          description: string | null
        }[]
        ipv6Ranges: {
          cidr: string | null
          description: string | null
        }[]
        referencedGroups: {
          groupId: string | null
          userId: string | null
          description: string | null
        }[]
        prefixListIds: string[]
      }[]
      tags: Record<string, string>
    }[]
    nextToken: string | null
  }
}

export interface Ec2DescribeInternetGatewaysParams extends Ec2ConnectionParams {
  internetGatewayIds?: string | null
  filters?: unknown | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeInternetGatewaysResponse extends ToolResponse {
  output: {
    internetGateways: {
      internetGatewayId: string
      ownerId: string | null
      attachments: {
        vpcId: string | null
        state: string | null
      }[]
      tags: Record<string, string>
    }[]
    nextToken: string | null
  }
}

export interface Ec2DescribeNetworkInterfacesParams extends Ec2ConnectionParams {
  networkInterfaceIds?: string | null
  filters?: unknown | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeNetworkInterfacesResponse extends ToolResponse {
  output: {
    networkInterfaces: {
      networkInterfaceId: string
      interfaceType: string | null
      status: string | null
      description: string | null
      vpcId: string | null
      subnetId: string | null
      availabilityZone: string | null
      privateIpAddress: string | null
      privateIpAddresses: string[]
      publicIp: string | null
      macAddress: string | null
      requesterManaged: boolean
      attachment: {
        attachmentId: string | null
        instanceId: string | null
        deviceIndex: number | null
        status: string | null
        deleteOnTermination: boolean | null
      } | null
      securityGroups: {
        groupId: string | null
        groupName: string | null
      }[]
      tags: Record<string, string>
    }[]
    nextToken: string | null
  }
}

export interface Ec2DescribeVolumesParams extends Ec2ConnectionParams {
  volumeIds?: string | null
  filters?: unknown | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeVolumesResponse extends ToolResponse {
  output: {
    volumes: {
      volumeId: string
      volumeType: string | null
      size: number | null
      state: string | null
      availabilityZone: string | null
      iops: number | null
      throughput: number | null
      encrypted: boolean
      kmsKeyId: string | null
      snapshotId: string | null
      createTime: string | null
      multiAttachEnabled: boolean
      attachments: {
        instanceId: string | null
        device: string | null
        state: string | null
        attachTime: string | null
        deleteOnTermination: boolean | null
      }[]
      tags: Record<string, string>
    }[]
    nextToken: string | null
  }
}

export interface Ec2DescribeSnapshotsParams extends Ec2ConnectionParams {
  snapshotIds?: string | null
  ownerIds?: string | null
  filters?: unknown | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeSnapshotsResponse extends ToolResponse {
  output: {
    snapshots: {
      snapshotId: string
      volumeId: string | null
      volumeSize: number | null
      state: string | null
      progress: string | null
      startTime: string | null
      description: string | null
      ownerId: string | null
      encrypted: boolean
      kmsKeyId: string | null
      storageTier: string | null
      tags: Record<string, string>
    }[]
    nextToken: string | null
  }
}

export interface Ec2CreateSnapshotParams extends Ec2ConnectionParams {
  volumeId: string
  description?: string | null
  tags?: unknown | null
}

export interface Ec2CreateSnapshotResponse extends ToolResponse {
  output: {
    snapshotId: string
    volumeId: string
    volumeSize: number | null
    state: string | null
    startTime: string | null
    description: string | null
    encrypted: boolean
    ownerId: string | null
    tags: Record<string, string>
  }
}

export interface Ec2CreateTagsParams extends Ec2ConnectionParams {
  resourceIds: string
  tags: unknown
}

export interface Ec2CreateTagsResponse extends ToolResponse {
  output: {
    resourceIds: string[]
    tags: Record<string, string>
  }
}

export interface Ec2DeleteTagsParams extends Ec2ConnectionParams {
  resourceIds: string
  tagKeys: string
}

export interface Ec2DeleteTagsResponse extends ToolResponse {
  output: {
    resourceIds: string[]
    tagKeys: string[]
  }
}

export interface Ec2DescribeRegionsParams extends Ec2ConnectionParams {
  regionNames?: string | null
  allRegions?: boolean | null
  filters?: unknown | null
}

export interface Ec2DescribeRegionsResponse extends ToolResponse {
  output: {
    regions: {
      regionName: string
      endpoint: string | null
      optInStatus: string | null
    }[]
  }
}

export interface Ec2DescribeAvailabilityZonesParams extends Ec2ConnectionParams {
  zoneNames?: string | null
  allAvailabilityZones?: boolean | null
  filters?: unknown | null
}

export interface Ec2DescribeAvailabilityZonesResponse extends ToolResponse {
  output: {
    availabilityZones: {
      zoneName: string
      zoneId: string | null
      zoneType: string | null
      state: string | null
      regionName: string | null
      groupName: string | null
      networkBorderGroup: string | null
      optInStatus: string | null
    }[]
  }
}

export interface Ec2DescribeNetworkAclsParams extends Ec2ConnectionParams {
  networkAclIds?: string | null
  filters?: unknown | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeNetworkAclsResponse extends ToolResponse {
  output: {
    networkAcls: {
      networkAclId: string
      vpcId: string | null
      isDefault: boolean
      ownerId: string | null
      entries: {
        ruleNumber: number | null
        egress: boolean
        ruleAction: string | null
        protocol: string | null
        cidrBlock: string | null
        ipv6CidrBlock: string | null
        fromPort: number | null
        toPort: number | null
        icmpType: number | null
        icmpCode: number | null
      }[]
      associations: {
        associationId: string | null
        subnetId: string | null
      }[]
      tags: Record<string, string>
    }[]
    nextToken: string | null
  }
}

export interface Ec2DescribeVpcEndpointsParams extends Ec2ConnectionParams {
  vpcEndpointIds?: string | null
  filters?: unknown | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeVpcEndpointsResponse extends ToolResponse {
  output: {
    vpcEndpoints: {
      vpcEndpointId: string
      vpcEndpointType: string | null
      vpcId: string | null
      serviceName: string | null
      state: string | null
      privateDnsEnabled: boolean
      routeTableIds: string[]
      subnetIds: string[]
      networkInterfaceIds: string[]
      securityGroupIds: string[]
      dnsNames: string[]
      creationTimestamp: string | null
      ownerId: string | null
      tags: Record<string, string>
    }[]
    nextToken: string | null
  }
}

export interface Ec2DescribeVpcPeeringConnectionsParams extends Ec2ConnectionParams {
  vpcPeeringConnectionIds?: string | null
  filters?: unknown | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeVpcPeeringConnectionsResponse extends ToolResponse {
  output: {
    vpcPeeringConnections: {
      vpcPeeringConnectionId: string
      status: string | null
      statusMessage: string | null
      requesterVpc: {
        vpcId: string | null
        ownerId: string | null
        region: string | null
        cidrBlock: string | null
      }
      accepterVpc: {
        vpcId: string | null
        ownerId: string | null
        region: string | null
        cidrBlock: string | null
      }
      expirationTime: string | null
      tags: Record<string, string>
    }[]
    nextToken: string | null
  }
}

export interface Ec2DescribeImagesParams extends Ec2ConnectionParams {
  imageIds?: string | null
  owners?: string | null
  filters?: unknown | null
  maxResults?: number | null
  nextToken?: string | null
}

export interface Ec2DescribeImagesResponse extends ToolResponse {
  output: {
    images: {
      imageId: string
      name: string | null
      description: string | null
      state: string | null
      ownerId: string | null
      ownerAlias: string | null
      public: boolean
      architecture: string | null
      platformDetails: string | null
      rootDeviceType: string | null
      virtualizationType: string | null
      creationDate: string | null
      deprecationTime: string | null
      lastLaunchedTime: string | null
      tags: Record<string, string>
    }[]
    nextToken: string | null
  }
}

export interface Ec2DescribeKeyPairsParams extends Ec2ConnectionParams {
  keyNames?: string | null
  keyPairIds?: string | null
  filters?: unknown | null
}

export interface Ec2DescribeKeyPairsResponse extends ToolResponse {
  output: {
    keyPairs: {
      keyPairId: string
      keyName: string | null
      keyType: string | null
      keyFingerprint: string | null
      createTime: string | null
      tags: Record<string, string>
    }[]
  }
}

export interface Ec2AuthorizeSecurityGroupIngressParams extends Ec2ConnectionParams {
  groupId: string
  ipProtocol: string
  fromPort?: number | null
  toPort?: number | null
  cidrIp?: string | null
  cidrIpv6?: string | null
  sourceGroupId?: string | null
  description?: string | null
}

export interface Ec2AuthorizeSecurityGroupIngressResponse extends ToolResponse {
  output: {
    authorized: boolean
    securityGroupRules: {
      securityGroupRuleId: string
      groupId: string
      ipProtocol: string | null
      fromPort: number | null
      toPort: number | null
      cidrIpv4: string | null
      cidrIpv6: string | null
      referencedGroupId: string | null
      description: string | null
    }[]
  }
}

export interface Ec2RevokeSecurityGroupIngressParams extends Ec2ConnectionParams {
  groupId: string
  ipProtocol?: string | null
  fromPort?: number | null
  toPort?: number | null
  cidrIp?: string | null
  cidrIpv6?: string | null
  sourceGroupId?: string | null
  securityGroupRuleIds?: string | null
}

export interface Ec2RevokeSecurityGroupIngressResponse extends ToolResponse {
  output: {
    revoked: boolean
    revokedRules: {
      securityGroupRuleId: string
      ipProtocol: string | null
      fromPort: number | null
      toPort: number | null
      cidrIpv4: string | null
      cidrIpv6: string | null
      referencedGroupId: string | null
      description: string | null
    }[]
    unmatchedRuleCount: number
  }
}

export interface Ec2DeleteVolumeParams extends Ec2ConnectionParams {
  volumeId: string
}

export interface Ec2DeleteVolumeResponse extends ToolResponse {
  output: {
    deleted: boolean
    volumeId: string
  }
}

export interface Ec2DeleteSnapshotParams extends Ec2ConnectionParams {
  snapshotId: string
}

export interface Ec2DeleteSnapshotResponse extends ToolResponse {
  output: {
    deleted: boolean
    snapshotId: string
  }
}
