import { TailscaleIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

export const TailscaleBlock: BlockConfig = {
  type: 'tailscale',
  name: 'Tailscale',
  description: 'Manage devices and network settings in your Tailscale tailnet',
  longDescription:
    'Interact with the Tailscale API to manage devices, DNS, ACLs, auth keys, users, and routes across your tailnet.',
  docsLink: 'https://docs.sim.ai/tools/tailscale',
  category: 'tools',
  integrationType: IntegrationType.Security,
  tags: ['monitoring'],
  bgColor: '#2E2D2D',
  icon: TailscaleIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Devices', id: 'list_devices' },
        { label: 'Get Device', id: 'get_device' },
        { label: 'Delete Device', id: 'delete_device' },
        { label: 'Authorize Device', id: 'authorize_device' },
        { label: 'Set Device Tags', id: 'set_device_tags' },
        { label: 'Get Device Routes', id: 'get_device_routes' },
        { label: 'Set Device Routes', id: 'set_device_routes' },
        { label: 'Update Device Key', id: 'update_device_key' },
        { label: 'List DNS Nameservers', id: 'list_dns_nameservers' },
        { label: 'Set DNS Nameservers', id: 'set_dns_nameservers' },
        { label: 'Get DNS Preferences', id: 'get_dns_preferences' },
        { label: 'Set DNS Preferences', id: 'set_dns_preferences' },
        { label: 'Get DNS Search Paths', id: 'get_dns_searchpaths' },
        { label: 'Set DNS Search Paths', id: 'set_dns_searchpaths' },
        { label: 'List Users', id: 'list_users' },
        { label: 'Create Auth Key', id: 'create_auth_key' },
        { label: 'List Auth Keys', id: 'list_auth_keys' },
        { label: 'Get Auth Key', id: 'get_auth_key' },
        { label: 'Delete Auth Key', id: 'delete_auth_key' },
        { label: 'Get ACL', id: 'get_acl' },
      ],
      value: () => 'list_devices',
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      password: true,
      placeholder: 'tskey-api-...',
      required: true,
    },
    {
      id: 'tailnet',
      title: 'Tailnet',
      type: 'short-input',
      placeholder: 'example.com or "-" for default',
      required: true,
    },
    {
      id: 'deviceId',
      title: 'Device ID',
      type: 'short-input',
      placeholder: 'Enter device ID',
      condition: {
        field: 'operation',
        value: [
          'get_device',
          'delete_device',
          'authorize_device',
          'set_device_tags',
          'get_device_routes',
          'set_device_routes',
          'update_device_key',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_device',
          'delete_device',
          'authorize_device',
          'set_device_tags',
          'get_device_routes',
          'set_device_routes',
          'update_device_key',
        ],
      },
    },
    {
      id: 'authorized',
      title: 'Authorized',
      type: 'dropdown',
      options: [
        { label: 'Authorize', id: 'true' },
        { label: 'Deauthorize', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'authorize_device' },
    },
    {
      id: 'keyExpiryDisabled',
      title: 'Key Expiry Disabled',
      type: 'dropdown',
      options: [
        { label: 'Disable Expiry', id: 'true' },
        { label: 'Enable Expiry', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'update_device_key' },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'tag:server,tag:production',
      condition: { field: 'operation', value: ['set_device_tags', 'create_auth_key'] },
      required: { field: 'operation', value: 'set_device_tags' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of Tailscale ACL tags. Each tag must start with "tag:" (e.g., tag:server,tag:production). Return ONLY the comma-separated tags - no explanations, no extra text.',
      },
    },
    {
      id: 'routes',
      title: 'Routes',
      type: 'short-input',
      placeholder: '10.0.0.0/24,192.168.1.0/24',
      condition: { field: 'operation', value: 'set_device_routes' },
      required: { field: 'operation', value: 'set_device_routes' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of subnet routes in CIDR notation (e.g., 10.0.0.0/24,192.168.1.0/24). Return ONLY the comma-separated routes - no explanations, no extra text.',
      },
    },
    {
      id: 'dnsServers',
      title: 'DNS Nameservers',
      type: 'short-input',
      placeholder: '8.8.8.8,8.8.4.4',
      condition: { field: 'operation', value: 'set_dns_nameservers' },
      required: { field: 'operation', value: 'set_dns_nameservers' },
    },
    {
      id: 'magicDNS',
      title: 'MagicDNS',
      type: 'dropdown',
      options: [
        { label: 'Enable', id: 'true' },
        { label: 'Disable', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'set_dns_preferences' },
    },
    {
      id: 'searchPaths',
      title: 'Search Paths',
      type: 'short-input',
      placeholder: 'corp.example.com,internal.example.com',
      condition: { field: 'operation', value: 'set_dns_searchpaths' },
      required: { field: 'operation', value: 'set_dns_searchpaths' },
    },
    {
      id: 'keyId',
      title: 'Auth Key ID',
      type: 'short-input',
      placeholder: 'Enter auth key ID',
      condition: { field: 'operation', value: ['get_auth_key', 'delete_auth_key'] },
      required: { field: 'operation', value: ['get_auth_key', 'delete_auth_key'] },
    },
    {
      id: 'reusable',
      title: 'Reusable',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'create_auth_key' },
      mode: 'advanced',
    },
    {
      id: 'ephemeral',
      title: 'Ephemeral',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      value: () => 'false',
      condition: { field: 'operation', value: 'create_auth_key' },
      mode: 'advanced',
    },
    {
      id: 'preauthorized',
      title: 'Preauthorized',
      type: 'dropdown',
      options: [
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => 'true',
      condition: { field: 'operation', value: 'create_auth_key' },
      mode: 'advanced',
    },
    {
      id: 'authKeyDescription',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Auth key description',
      condition: { field: 'operation', value: 'create_auth_key' },
      mode: 'advanced',
    },
    {
      id: 'expirySeconds',
      title: 'Expiry (seconds)',
      type: 'short-input',
      placeholder: '7776000 (90 days)',
      condition: { field: 'operation', value: 'create_auth_key' },
      mode: 'advanced',
    },
  ],

  tools: {
    access: [
      'tailscale_list_devices',
      'tailscale_get_device',
      'tailscale_delete_device',
      'tailscale_authorize_device',
      'tailscale_set_device_tags',
      'tailscale_get_device_routes',
      'tailscale_set_device_routes',
      'tailscale_update_device_key',
      'tailscale_list_dns_nameservers',
      'tailscale_set_dns_nameservers',
      'tailscale_get_dns_preferences',
      'tailscale_set_dns_preferences',
      'tailscale_get_dns_searchpaths',
      'tailscale_set_dns_searchpaths',
      'tailscale_list_users',
      'tailscale_create_auth_key',
      'tailscale_list_auth_keys',
      'tailscale_get_auth_key',
      'tailscale_delete_auth_key',
      'tailscale_get_acl',
    ],
    config: {
      tool: (params) => `tailscale_${params.operation}`,
      params: (params) => {
        const mapped: Record<string, unknown> = {
          apiKey: params.apiKey,
          tailnet: params.tailnet,
        }
        if (params.deviceId) mapped.deviceId = params.deviceId
        if (params.keyId) mapped.keyId = params.keyId
        if (params.tags) mapped.tags = params.tags
        if (params.routes) mapped.routes = params.routes
        if (params.dnsServers) mapped.dns = params.dnsServers
        if (params.searchPaths) mapped.searchPaths = params.searchPaths
        if (params.authorized !== undefined) mapped.authorized = params.authorized === 'true'
        if (params.keyExpiryDisabled !== undefined)
          mapped.keyExpiryDisabled = params.keyExpiryDisabled === 'true'
        if (params.magicDNS !== undefined) mapped.magicDNS = params.magicDNS === 'true'
        if (params.authKeyDescription) mapped.description = params.authKeyDescription
        if (params.reusable !== undefined) mapped.reusable = params.reusable === 'true'
        if (params.ephemeral !== undefined) mapped.ephemeral = params.ephemeral === 'true'
        if (params.preauthorized !== undefined)
          mapped.preauthorized = params.preauthorized === 'true'
        if (params.expirySeconds) mapped.expirySeconds = Number(params.expirySeconds)
        return mapped
      },
    },
  },

  inputs: {
    apiKey: { type: 'string', description: 'Tailscale API key' },
    tailnet: { type: 'string', description: 'Tailnet name' },
    deviceId: { type: 'string', description: 'Device ID' },
    keyId: { type: 'string', description: 'Auth key ID' },
    authorized: { type: 'string', description: 'Authorization status' },
    keyExpiryDisabled: { type: 'string', description: 'Whether to disable key expiry' },
    tags: { type: 'string', description: 'Comma-separated tags' },
    routes: { type: 'string', description: 'Comma-separated subnet routes' },
    dnsServers: { type: 'string', description: 'Comma-separated DNS nameserver IPs' },
    magicDNS: { type: 'string', description: 'Enable or disable MagicDNS' },
    searchPaths: { type: 'string', description: 'Comma-separated DNS search path domains' },
    reusable: { type: 'string', description: 'Whether the auth key is reusable' },
    ephemeral: { type: 'string', description: 'Whether devices are ephemeral' },
    preauthorized: { type: 'string', description: 'Whether devices are pre-authorized' },
    authKeyDescription: { type: 'string', description: 'Auth key description' },
    expirySeconds: { type: 'string', description: 'Auth key expiry in seconds' },
  },

  outputs: {
    devices: { type: 'json', description: 'List of devices in the tailnet' },
    count: { type: 'number', description: 'Total count of items returned' },
    id: { type: 'string', description: 'Device or auth key ID' },
    name: { type: 'string', description: 'Device name' },
    hostname: { type: 'string', description: 'Device hostname' },
    user: { type: 'string', description: 'Associated user' },
    os: { type: 'string', description: 'Operating system' },
    clientVersion: { type: 'string', description: 'Tailscale client version' },
    addresses: { type: 'json', description: 'Tailscale IP addresses' },
    tags: { type: 'json', description: 'Device or auth key tags' },
    authorized: { type: 'boolean', description: 'Whether the device is authorized' },
    blocksIncomingConnections: {
      type: 'boolean',
      description: 'Whether the device blocks incoming connections',
    },
    lastSeen: { type: 'string', description: 'Last seen timestamp' },
    created: { type: 'string', description: 'Creation timestamp' },
    enabledRoutes: { type: 'json', description: 'Enabled subnet routes' },
    advertisedRoutes: { type: 'json', description: 'Advertised subnet routes' },
    isExternal: { type: 'boolean', description: 'Whether the device is external' },
    updateAvailable: { type: 'boolean', description: 'Whether an update is available' },
    machineKey: { type: 'string', description: 'Machine key' },
    nodeKey: { type: 'string', description: 'Node key' },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    deviceId: { type: 'string', description: 'Device ID' },
    keyExpiryDisabled: { type: 'boolean', description: 'Whether key expiry is disabled' },
    dns: { type: 'json', description: 'DNS nameserver addresses' },
    magicDNS: { type: 'boolean', description: 'Whether MagicDNS is enabled' },
    searchPaths: { type: 'json', description: 'DNS search paths' },
    users: { type: 'json', description: 'List of users in the tailnet' },
    keys: { type: 'json', description: 'List of auth keys' },
    key: { type: 'string', description: 'Auth key value (only at creation)' },
    keyId: { type: 'string', description: 'Auth key ID' },
    description: { type: 'string', description: 'Auth key description' },
    expires: { type: 'string', description: 'Expiration timestamp' },
    revoked: { type: 'string', description: 'Revocation timestamp' },
    capabilities: { type: 'json', description: 'Auth key capabilities' },
    acl: { type: 'string', description: 'ACL policy as JSON string' },
    etag: { type: 'string', description: 'ACL ETag for conditional updates' },
  },
}
