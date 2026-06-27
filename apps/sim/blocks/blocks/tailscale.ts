import { TailscaleIcon } from '@/components/icons'
import { TailscaleBlockDisplay } from '@/blocks/blocks/tailscale.display'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'

export const TailscaleBlock: BlockConfig = {
  ...TailscaleBlockDisplay,
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

export const TailscaleBlockMeta = {
  tags: ['monitoring'],
  url: 'https://tailscale.com',
  templates: [
    {
      icon: TailscaleIcon,
      title: 'Tailscale device inventory',
      prompt:
        'Build a scheduled workflow that pulls Tailscale device inventory daily, identifies stale or non-compliant nodes, and writes a security review table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
    },
    {
      icon: TailscaleIcon,
      title: 'Tailscale ACL drift detector',
      prompt:
        'Create a scheduled workflow that diffs Tailscale ACLs against the source of truth, alerts on drift, and writes the drift report to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TailscaleIcon,
      title: 'Tailscale new-hire provisioner',
      prompt:
        'Build a workflow that on a Workday new-hire event creates a scoped Tailscale auth key for the engineer, sets the right device tags, and writes the access record.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: TailscaleIcon,
      title: 'Tailscale offboarder',
      prompt:
        "Create a workflow that on a Workday termination deletes the departing engineer's Tailscale devices, revokes their auth keys, and writes the security audit log.",
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: TailscaleIcon,
      title: 'Tailscale unauthorized-tag watcher',
      prompt:
        'Build a scheduled workflow that polls Tailscale device tags and the ACL for unauthorized changes, posts a Slack alert to the security channel, and writes the audit.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'monitoring'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TailscaleIcon,
      title: 'Tailscale key-expiry sweeper',
      prompt:
        'Create a scheduled workflow that lists Tailscale auth keys expiring in 14 days, notifies owners, and rotates keys past their grace period.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'engineering',
      tags: ['devops', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: TailscaleIcon,
      title: 'Tailscale access audit',
      prompt:
        'Build a scheduled monthly workflow that produces a Tailscale access-review report — devices, tags, ACL effective access — for the security team.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
  ],
  skills: [
    {
      name: 'audit-tailnet-devices',
      description:
        'List every device in the tailnet and flag stale, unauthorized, or update-pending nodes.',
      content:
        '# Audit Tailnet Devices\n\nProduce a clean inventory of the devices on your tailnet and surface the ones that need attention.\n\n## Steps\n1. Use the List Devices operation with your API key and tailnet (use "-" for the default tailnet).\n2. For each device review lastSeen, authorized, updateAvailable, and the assigned tags.\n3. Flag nodes not seen in 30+ days, devices still pending authorization, and any with an update available.\n4. Use Get Device with a deviceId to pull full detail on anything suspicious.\n\n## Output\nReturn a table of devices with hostname, user, OS, last seen, and authorization status, plus a short list of nodes that need review.',
    },
    {
      name: 'provision-auth-key',
      description:
        'Create a scoped Tailscale auth key with the right tags, reusability, and expiry for onboarding.',
      content:
        '# Provision a Tailscale Auth Key\n\nGenerate an auth key so a new device or user can join the tailnet with the correct access.\n\n## Steps\n1. Use the Create Auth Key operation with your API key and tailnet.\n2. Set Tags (for example tag:server,tag:production) so devices joining with the key get the intended ACL access.\n3. Choose Reusable, Ephemeral, and Preauthorized values to match the use case (ephemeral for short-lived CI nodes).\n4. Set an Expiry in seconds (for example 7776000 for 90 days) and a clear Description.\n\n## Output\nReturn the generated key value once (it is only shown at creation), the key ID, its tags, and the expiry timestamp.',
    },
    {
      name: 'offboard-device',
      description: 'Deauthorize or remove a departing user device and revoke its auth keys.',
      content:
        '# Offboard a Tailscale Device\n\nRemove a device from the tailnet during offboarding so access is cut cleanly.\n\n## Steps\n1. Use List Devices to find the deviceId tied to the departing user.\n2. To immediately cut access use Authorize Device set to Deauthorize, or Delete Device to remove it entirely.\n3. Use List Auth Keys to find any keys the user created, then Delete Auth Key for each.\n4. Capture the device detail with Get Device before deletion if you need an audit record.\n\n## Output\nConfirm the device was deauthorized or deleted and list the revoked auth keys for the offboarding audit log.',
    },
  ],
} as const satisfies BlockMeta
