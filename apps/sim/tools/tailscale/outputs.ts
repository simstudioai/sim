import type { OutputProperty } from '@/tools/types'

export const DEVICE_OUTPUT_PROPERTIES = {
  addresses: {
    type: 'array',
    description: 'Tailscale IP addresses',
    items: {
      type: 'string',
    },
  },
  id: {
    type: 'string',
    description: 'Resource ID',
    nullable: true,
  },
  nodeId: {
    type: 'string',
    description: 'Preferred device ID',
    nullable: true,
  },
  user: {
    type: 'string',
    description: 'User who registered the device',
    nullable: true,
  },
  name: {
    type: 'string',
    description: 'Device MagicDNS name',
    nullable: true,
  },
  hostname: {
    type: 'string',
    description: 'Device machine name',
    nullable: true,
  },
  clientVersion: {
    type: 'string',
    description: 'Tailscale client version',
    nullable: true,
  },
  updateAvailable: {
    type: 'boolean',
    description: 'Whether a client update is available',
    nullable: true,
  },
  os: {
    type: 'string',
    description: 'Operating system',
    nullable: true,
  },
  created: {
    type: 'string',
    description: 'Creation timestamp',
    nullable: true,
  },
  connectedToControl: {
    type: 'boolean',
    description: 'Whether the device is connected to the control server',
    nullable: true,
  },
  lastSeen: {
    type: 'string',
    description: 'Last seen timestamp; a connected device may omit it',
    nullable: true,
  },
  keyExpiryDisabled: {
    type: 'boolean',
    description: 'Whether device key expiry is disabled',
    nullable: true,
  },
  expires: {
    type: 'string',
    description: 'Key expiration timestamp',
    nullable: true,
  },
  authorized: {
    type: 'boolean',
    description: 'Whether the device is authorized',
    nullable: true,
  },
  isExternal: {
    type: 'boolean',
    description: 'Whether the device is shared from another tailnet',
    nullable: true,
  },
  multipleConnections: {
    type: 'boolean',
    description: 'Whether multiple devices are using the same node key',
    nullable: true,
  },
  machineKey: {
    type: 'string',
    description: 'Machine public key',
    nullable: true,
  },
  nodeKey: {
    type: 'string',
    description: 'Node public key',
    nullable: true,
  },
  blocksIncomingConnections: {
    type: 'boolean',
    description: 'Whether incoming connections are blocked',
    nullable: true,
  },
  enabledRoutes: {
    type: 'array',
    description: 'Approved subnet routes',
    items: {
      type: 'string',
    },
  },
  advertisedRoutes: {
    type: 'array',
    description: 'Advertised subnet routes',
    items: {
      type: 'string',
    },
  },
  clientConnectivity: {
    type: 'json',
    description: 'Connectivity report',
    properties: {
      endpoints: {
        type: 'array',
        description: "Client's magicsock UDP IP:port endpoints (IPv4 or IPv6)",
        optional: true,
        items: {
          type: 'string',
        },
      },
      mappingVariesByDestIP: {
        type: 'boolean',
        description: "'true' if the host's NAT mappings vary based on the destination IP",
        optional: true,
      },
      latency: {
        type: 'json',
        description: 'Map of DERP server locations and their current latency',
        optional: true,
      },
      clientSupports: {
        type: 'json',
        description: 'Identifies features supported by the client',
        optional: true,
        properties: {
          hairPinning: {
            type: 'boolean',
            description: 'This information is no longer tracked and will always be null',
            optional: true,
            nullable: true,
          },
          ipv6: {
            type: 'boolean',
            description:
              "'true' if the device OS supports IPv6, regardless of whether IPv6 internet connectivity is available",
            optional: true,
            nullable: true,
          },
          pcp: {
            type: 'boolean',
            description: "'true' if PCP port-mapping service exists on your router",
            optional: true,
            nullable: true,
          },
          pmp: {
            type: 'boolean',
            description: "'true' if NAT-PMP port-mapping service exists on your router",
            optional: true,
            nullable: true,
          },
          udp: {
            type: 'boolean',
            description:
              "'true' if UDP traffic is enabled on the current network; if 'false', Tailscale may be unable to make direct connections, and will rely on our DERP servers",
            optional: true,
            nullable: true,
          },
          upnp: {
            type: 'boolean',
            description: "'true' if UPnP port-mapping service exists on your router",
            optional: true,
            nullable: true,
          },
        },
      },
    },
    nullable: true,
  },
  tags: {
    type: 'array',
    description: 'Assigned tags',
    items: {
      type: 'string',
    },
  },
  tailnetLockError: {
    type: 'string',
    description: 'Tailnet lock signature error',
    nullable: true,
  },
  tailnetLockKey: {
    type: 'string',
    description: 'Tailnet lock public key',
    nullable: true,
  },
  sshEnabled: {
    type: 'boolean',
    description: 'Whether Tailscale SSH is enabled',
    nullable: true,
  },
  postureIdentity: {
    type: 'json',
    description: 'Device posture identity',
    properties: {
      serialNumbers: {
        type: 'array',
        description: 'Serial numbers',
        optional: true,
        items: {
          type: 'string',
        },
      },
      disabled: {
        type: 'boolean',
        description: 'Disabled',
        optional: true,
      },
    },
    nullable: true,
  },
  postureStatus: {
    type: 'json',
    description: 'Device posture status',
    properties: {
      passing: {
        type: 'boolean',
        description: 'Reports whether the device is passing this posture',
        optional: true,
      },
      impacting: {
        type: 'boolean',
        description: 'Whether the status of this posture affects the connectivity of the device',
        optional: true,
      },
      failingAssertions: {
        type: 'array',
        description: 'List of posture assertions the device is failing',
        optional: true,
        items: {
          type: 'string',
        },
      },
    },
    nullable: true,
  },
  isEphemeral: {
    type: 'boolean',
    description: 'Whether the device is ephemeral',
    nullable: true,
  },
  distro: {
    type: 'json',
    description: 'Operating system distribution',
    properties: {
      name: {
        type: 'string',
        description: 'Operating system distribution name',
        optional: true,
      },
      version: {
        type: 'string',
        description: 'The operating system distribution version that the device is running',
        optional: true,
      },
      codeName: {
        type: 'string',
        description: 'The operating system distribution code name that the device is running',
        optional: true,
      },
    },
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const KEY_OUTPUT_PROPERTIES = {
  id: {
    type: 'string',
    description: 'Resource ID',
    nullable: true,
  },
  keyType: {
    type: 'string',
    description: 'Credential type: auth, api, client, or federated',
    nullable: true,
  },
  expirySeconds: {
    type: 'number',
    description: 'Auth key lifetime in seconds',
    nullable: true,
  },
  created: {
    type: 'string',
    description: 'Creation timestamp',
    nullable: true,
  },
  updated: {
    type: 'string',
    description: 'Last update timestamp',
    nullable: true,
  },
  expires: {
    type: 'string',
    description: 'Key expiration timestamp',
    nullable: true,
  },
  revoked: {
    type: 'string',
    description: 'Revocation timestamp',
    nullable: true,
  },
  capabilities: {
    type: 'json',
    description: 'Device enrollment capabilities',
    properties: {
      reusable: {
        type: 'boolean',
        description:
          'reusable for auth keys only; reusable auth keys can be used multiple times to register different devices',
      },
      ephemeral: {
        type: 'boolean',
        description:
          'ephemeral for auth keys only; ephemeral keys are used to connect and then clean up short-lived devices',
      },
      preauthorized: {
        type: 'boolean',
        description:
          'preauthorized for auth keys only; these are also referred to as "pre-approved" keys',
      },
      tags: {
        type: 'array',
        description: 'Assigned tags',
        items: {
          type: 'string',
        },
      },
    },
  },
  scopes: {
    type: 'array',
    description: 'Granted API scopes',
    items: {
      type: 'string',
    },
  },
  tags: {
    type: 'array',
    description: 'Assigned tags',
    items: {
      type: 'string',
    },
  },
  description: {
    type: 'string',
    description: 'Key description',
    nullable: true,
  },
  invalid: {
    type: 'boolean',
    description: 'Whether the key is expired or revoked',
    nullable: true,
  },
  userId: {
    type: 'string',
    description: 'Creating user ID; empty for a tailnet-owned key',
    nullable: true,
  },
  audience: {
    type: 'string',
    description: 'Federated identity audience',
    nullable: true,
  },
  issuer: {
    type: 'string',
    description: 'Federated identity issuer',
    nullable: true,
  },
  subject: {
    type: 'string',
    description: 'Federated identity subject pattern',
    nullable: true,
  },
  customClaimRules: {
    type: 'json',
    description: 'Map of custom OIDC claims to matching patterns',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

export const USER_OUTPUT_PROPERTIES = {
  id: {
    type: 'string',
    description: 'Resource ID',
    nullable: true,
  },
  displayName: {
    type: 'string',
    description: 'User display name',
    nullable: true,
  },
  loginName: {
    type: 'string',
    description: 'User login name',
    nullable: true,
  },
  tailnetId: {
    type: 'string',
    description: 'Owning tailnet ID',
    nullable: true,
  },
  created: {
    type: 'string',
    description: 'Creation timestamp',
    nullable: true,
  },
  type: {
    type: 'string',
    description: 'User relationship: member or shared',
    nullable: true,
  },
  role: {
    type: 'string',
    description: 'User role',
    nullable: true,
  },
  status: {
    type: 'string',
    description: 'User status',
    nullable: true,
  },
  deviceCount: {
    type: 'number',
    description: 'Number of devices owned by the user',
    nullable: true,
  },
  lastSeen: {
    type: 'string',
    description: 'Last time a user device connected or the user authenticated',
    nullable: true,
  },
  currentlyConnected: {
    type: 'boolean',
    description: 'Whether the user has a device connected to the control server',
    nullable: true,
  },
  profilePicURL: {
    type: 'string',
    description: 'User profile picture URL',
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>
