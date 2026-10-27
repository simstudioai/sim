import { TailscaleIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

const SWITCH_DEFAULTS = {
  authorize_device: { authorized: true },
  update_device_key: { keyExpiryDisabled: true },
  set_dns_preferences: { magicDNS: true },
  create_auth_key: { reusable: false, ephemeral: false, preauthorized: true },
  list_auth_keys: { all: true },
  get_acl: { details: false },
} as const

export const TailscaleBlock: BlockConfig = {
  type: 'tailscale',
  name: 'Tailscale',
  description: 'Manage devices and network settings in your Tailscale tailnet',
  longDescription:
    'Manage Tailscale devices, user access, posture attributes, DNS configuration, policy files, keys, subnet routes, and tailnet settings.',
  docsLink: 'https://docs.sim.ai/integrations/tailscale',
  category: 'tools',
  integrationType: IntegrationType.Security,
  bgColor: '#2E2D2D',
  icon: TailscaleIcon,
  authMode: AuthMode.ApiKey,
  canvasPresentation: {
    defaultTitle: 'Tailscale',
    sentences: {
      byOperation: {
        list_devices: ['List every device in the tailnet'],
        get_device: [{ text: 'Fetch details for device', field: 'deviceId', core: true }],
        delete_device: [
          { text: 'Remove device', field: 'deviceId', core: true, after: 'from the tailnet' },
        ],
        authorize_device: [
          { text: 'Set device', field: 'deviceId', core: true },
          { text: 'to', field: 'authorized' },
        ],
        set_device_tags: [
          { text: 'Tag device', field: 'deviceId', core: true },
          { text: 'with', field: 'tags' },
        ],
        get_device_routes: [
          { text: 'Read the subnet routes of device', field: 'deviceId', core: true },
        ],
        set_device_routes: [
          { text: 'Set the subnet routes of device', field: 'deviceId', core: true },
          { text: 'to', field: 'routes' },
        ],
        update_device_key: [
          { text: 'Set key expiry on device', field: 'deviceId', core: true },
          { text: 'to', field: 'keyExpiryDisabled' },
        ],
        expire_device_key: [
          { text: 'Expire the node key of device', field: 'deviceId', core: true },
        ],
        list_dns_nameservers: ['List the DNS nameservers of the tailnet'],
        set_dns_nameservers: [
          { text: 'Set the tailnet DNS nameservers to', field: 'dnsServers', core: true },
        ],
        get_dns_preferences: ['Read DNS preferences, including MagicDNS status'],
        set_dns_preferences: [
          {
            text: 'Set MagicDNS to',
            field: 'magicDNS',
            core: true,
          },
        ],
        get_dns_searchpaths: ['Read the DNS search paths of the tailnet'],
        set_dns_searchpaths: [
          { text: 'Set the tailnet DNS search paths to', field: 'searchPaths', core: true },
        ],
        list_users: ['List every user in the tailnet'],
        suspend_user: [{ text: 'Suspend tailnet access for user', field: 'userId', core: true }],
        delete_user: [
          { text: 'Delete user', field: 'userId', core: true, after: 'from the tailnet' },
        ],
        create_auth_key: [
          'Create an auth key',
          { text: 'for', field: 'authKeyDescription' },
          { text: 'tagged', field: 'tags' },
          { text: ', expiring in', field: 'expirySeconds', after: 'seconds' },
        ],
        list_auth_keys: ['List active tailnet keys and trust credentials'],
        get_auth_key: [{ text: 'Fetch auth key', field: 'keyId', core: true }],
        delete_auth_key: [{ text: 'Revoke auth key', field: 'keyId', core: true }],
        set_device_name: [
          { text: 'Rename device', field: 'deviceId', core: true },
          { text: 'to', field: 'name' },
        ],
        get_device_attributes: [
          { text: 'Read posture attributes for device', field: 'deviceId', core: true },
        ],
        set_device_attribute: [
          { text: 'Set posture attribute', field: 'attributeKey', core: true },
          { text: 'on device', field: 'deviceId', core: true },
          { text: 'to', field: 'attributeValue' },
        ],
        delete_device_attribute: [
          { text: 'Delete posture attribute', field: 'attributeKey', core: true },
          { text: 'from device', field: 'deviceId', core: true },
        ],
        get_user: [{ text: 'Read tailnet user', field: 'userId', core: true }],
        approve_user: [{ text: 'Approve tailnet access for user', field: 'userId', core: true }],
        restore_user: [{ text: 'Restore tailnet access for user', field: 'userId', core: true }],
        set_user_role: [
          { text: 'Set role for user', field: 'userId', core: true },
          { text: 'to', field: 'role', core: true },
        ],
        get_split_dns: ['Read split DNS resolvers'],
        set_split_dns: ['Replace all split DNS resolvers'],
        update_split_dns: ['Update selected split DNS resolvers'],
        get_dns_configuration: ['Read the full tailnet DNS configuration'],
        set_dns_configuration: ['Replace the full tailnet DNS configuration'],
        get_tailnet_settings: ['Read tailnet settings'],
        update_tailnet_settings: ['Update selected tailnet settings'],
        validate_acl: ['Validate a policy file or run ACL tests'],
        get_acl: ['Read the tailnet ACL policy'],
        set_acl: [
          'Replace the tailnet ACL policy',
          { text: ', if the ETag matches', field: 'ifMatch' },
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
        { label: 'List Devices', id: 'list_devices' },
        { label: 'Get Device', id: 'get_device' },
        { label: 'Set Device Name', id: 'set_device_name' },
        { label: 'Delete Device', id: 'delete_device' },
        { label: 'Authorize Device', id: 'authorize_device' },
        { label: 'Set Device Tags', id: 'set_device_tags' },
        { label: 'Get Device Routes', id: 'get_device_routes' },
        { label: 'Set Device Routes', id: 'set_device_routes' },
        { label: 'Update Device Key', id: 'update_device_key' },
        { label: 'Expire Device Key', id: 'expire_device_key' },
        { label: 'Get Device Attributes', id: 'get_device_attributes' },
        { label: 'Set Device Attribute', id: 'set_device_attribute' },
        { label: 'Delete Device Attribute', id: 'delete_device_attribute' },
        { label: 'List DNS Nameservers', id: 'list_dns_nameservers' },
        { label: 'Set DNS Nameservers', id: 'set_dns_nameservers' },
        { label: 'Get DNS Preferences', id: 'get_dns_preferences' },
        { label: 'Set DNS Preferences', id: 'set_dns_preferences' },
        { label: 'Get DNS Search Paths', id: 'get_dns_searchpaths' },
        { label: 'Set DNS Search Paths', id: 'set_dns_searchpaths' },
        { label: 'Get Split DNS', id: 'get_split_dns' },
        { label: 'Update Split DNS', id: 'update_split_dns' },
        { label: 'Set Split DNS', id: 'set_split_dns' },
        { label: 'Get DNS Configuration', id: 'get_dns_configuration' },
        { label: 'Set DNS Configuration', id: 'set_dns_configuration' },
        { label: 'List Users', id: 'list_users' },
        { label: 'Get User', id: 'get_user' },
        { label: 'Set User Role', id: 'set_user_role' },
        { label: 'Approve User', id: 'approve_user' },
        { label: 'Suspend User', id: 'suspend_user' },
        { label: 'Restore User', id: 'restore_user' },
        { label: 'Delete User', id: 'delete_user' },
        { label: 'Create Auth Key', id: 'create_auth_key' },
        { label: 'List Keys', id: 'list_auth_keys' },
        { label: 'Get Auth Key', id: 'get_auth_key' },
        { label: 'Delete Auth Key', id: 'delete_auth_key' },
        { label: 'Get ACL', id: 'get_acl' },
        { label: 'Validate ACL', id: 'validate_acl' },
        { label: 'Set ACL', id: 'set_acl' },
        { label: 'Get Tailnet Settings', id: 'get_tailnet_settings' },
        { label: 'Update Tailnet Settings', id: 'update_tailnet_settings' },
      ],
      value: () => 'list_devices',
    },
    {
      id: 'apiKey',
      title: 'API Access Token',
      type: 'short-input',
      password: true,
      placeholder: 'Enter a Tailscale API or OAuth access token',
      required: true,
    },
    {
      id: 'tailnet',
      title: 'Tailnet',
      type: 'short-input',
      placeholder: 'Tailnet ID or - for the token’s default tailnet',
      value: () => '-',
      condition: {
        field: 'operation',
        value: [
          'create_auth_key',
          'delete_auth_key',
          'get_acl',
          'get_auth_key',
          'get_dns_configuration',
          'get_dns_preferences',
          'get_dns_searchpaths',
          'get_split_dns',
          'get_tailnet_settings',
          'list_auth_keys',
          'list_devices',
          'list_dns_nameservers',
          'list_users',
          'set_acl',
          'set_dns_configuration',
          'set_dns_nameservers',
          'set_dns_preferences',
          'set_dns_searchpaths',
          'set_split_dns',
          'update_split_dns',
          'update_tailnet_settings',
          'validate_acl',
        ],
      },
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
          'delete_device_attribute',
          'set_device_attribute',
          'get_device_attributes',
          'set_device_name',
          'delete_device',
          'authorize_device',
          'set_device_tags',
          'get_device_routes',
          'set_device_routes',
          'update_device_key',
          'expire_device_key',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_device',
          'delete_device_attribute',
          'set_device_attribute',
          'get_device_attributes',
          'set_device_name',
          'delete_device',
          'authorize_device',
          'set_device_tags',
          'get_device_routes',
          'set_device_routes',
          'update_device_key',
          'expire_device_key',
        ],
      },
    },
    {
      id: 'authorized',
      required: true,
      title: 'Authorized',
      type: 'switch',
      value: () => String(SWITCH_DEFAULTS.authorize_device.authorized),
      condition: { field: 'operation', value: 'authorize_device' },
    },
    {
      id: 'keyExpiryDisabled',
      required: true,
      title: 'Key Expiry Disabled',
      type: 'switch',
      value: () => String(SWITCH_DEFAULTS.update_device_key.keyExpiryDisabled),
      condition: { field: 'operation', value: 'update_device_key' },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'tag:server,tag:production or [] to clear',
      condition: { field: 'operation', value: ['set_device_tags', 'create_auth_key'] },
      required: { field: 'operation', value: 'set_device_tags' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of Tailscale ACL tags. Each tag must start with "tag:" (e.g., tag:server,tag:production). Return ONLY the comma-separated tags.',
        placeholder: 'Describe the tags you need',
      },
    },
    {
      id: 'routes',
      title: 'Routes',
      type: 'short-input',
      placeholder: '10.0.0.0/24,192.168.1.0/24 or [] to clear',
      condition: { field: 'operation', value: 'set_device_routes' },
      required: { field: 'operation', value: 'set_device_routes' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of subnet routes in CIDR notation (e.g., 10.0.0.0/24,192.168.1.0/24). Return ONLY the comma-separated routes.',
        placeholder: 'Describe the routes you need',
      },
    },
    {
      id: 'dnsServers',
      title: 'DNS Nameservers',
      type: 'short-input',
      placeholder: '8.8.8.8,8.8.4.4 or [] to clear',
      condition: { field: 'operation', value: 'set_dns_nameservers' },
      required: { field: 'operation', value: 'set_dns_nameservers' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of DNS nameserver IP addresses (e.g., 8.8.8.8,8.8.4.4). Return ONLY the comma-separated IP addresses.',
        placeholder: 'Describe the IP addresses you need',
      },
    },
    {
      id: 'magicDNS',
      required: true,
      title: 'MagicDNS',
      type: 'switch',
      value: () => String(SWITCH_DEFAULTS.set_dns_preferences.magicDNS),
      condition: { field: 'operation', value: 'set_dns_preferences' },
    },
    {
      id: 'searchPaths',
      title: 'Search Paths',
      type: 'short-input',
      placeholder: 'corp.example.com,internal.example.com or [] to clear',
      condition: { field: 'operation', value: 'set_dns_searchpaths' },
      required: { field: 'operation', value: 'set_dns_searchpaths' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a comma-separated list of DNS search path domains (e.g., corp.example.com,internal.example.com). Return ONLY the comma-separated domains.',
        placeholder: 'Describe the domains you need',
      },
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
      type: 'switch',
      value: () => String(SWITCH_DEFAULTS.create_auth_key.reusable),
      condition: { field: 'operation', value: 'create_auth_key' },
      mode: 'advanced',
    },
    {
      id: 'ephemeral',
      title: 'Ephemeral',
      type: 'switch',
      value: () => String(SWITCH_DEFAULTS.create_auth_key.ephemeral),
      condition: { field: 'operation', value: 'create_auth_key' },
      mode: 'advanced',
    },
    {
      id: 'preauthorized',
      title: 'Preauthorized',
      type: 'switch',
      value: () => String(SWITCH_DEFAULTS.create_auth_key.preauthorized),
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
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'Enter user ID',
      condition: {
        field: 'operation',
        value: [
          'get_user',
          'approve_user',
          'suspend_user',
          'restore_user',
          'delete_user',
          'set_user_role',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_user',
          'approve_user',
          'suspend_user',
          'restore_user',
          'delete_user',
          'set_user_role',
        ],
      },
    },
    {
      id: 'acl',
      title: 'ACL Policy',
      type: 'long-input',
      placeholder:
        '{"acls": [{"action": "accept", "src": ["tag:server"], "dst": ["tag:database:5432"]}]}',
      condition: { field: 'operation', value: ['set_acl', 'validate_acl'] },
      required: { field: 'operation', value: ['set_acl', 'validate_acl'] },
    },
    {
      id: 'ifMatch',
      title: 'If-Match ETag',
      type: 'short-input',
      placeholder: 'ETag from Get ACL, or "ts-default"',
      condition: { field: 'operation', value: 'set_acl' },
      mode: 'advanced',
    },
    {
      id: 'details',
      title: 'Policy Diagnostics',
      type: 'switch',
      value: () => String(SWITCH_DEFAULTS.get_acl.details),
      condition: { field: 'operation', value: 'get_acl' },
      mode: 'advanced',
    },
    {
      id: 'roleFilter',
      title: 'Filter by Role',
      type: 'dropdown',
      options: [
        {
          label: 'Any Role',
          id: '',
        },
        {
          label: 'Owner',
          id: 'owner',
        },
        {
          label: 'Member',
          id: 'member',
        },
        {
          label: 'Admin',
          id: 'admin',
        },
        {
          label: 'It Admin',
          id: 'it-admin',
        },
        {
          label: 'Network Admin',
          id: 'network-admin',
        },
        {
          label: 'Billing Admin',
          id: 'billing-admin',
        },
        {
          label: 'Auditor',
          id: 'auditor',
        },
      ],
      condition: {
        field: 'operation',
        value: 'list_users',
      },
      mode: 'advanced',
    },
    {
      id: 'fields',
      title: 'Device Fields',
      type: 'dropdown',
      options: [
        {
          label: 'Default',
          id: 'default',
        },
        {
          label: 'All',
          id: 'all',
        },
      ],
      condition: {
        field: 'operation',
        value: ['list_devices', 'get_device'],
      },
      mode: 'advanced',
      value: () => 'default',
    },
    {
      id: 'filters',
      title: 'Device Filters',
      type: 'long-input',
      placeholder: 'isEphemeral=true&tags=tag:server',
      condition: {
        field: 'operation',
        value: 'list_devices',
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        placeholder: 'Describe the devices to include',
        prompt:
          'Generate URL query filters for top-level Tailscale device properties, for example isEphemeral=true&tags=tag:server. Repeat a parameter to require multiple tag values. Return ONLY the URL query string.',
      },
    },
    {
      id: 'all',
      title: 'Include All Tailnet Keys',
      type: 'switch',
      condition: {
        field: 'operation',
        value: 'list_auth_keys',
      },
      mode: 'advanced',
      value: () => String(SWITCH_DEFAULTS.list_auth_keys.all),
    },
    {
      id: 'userType',
      title: 'User Type',
      type: 'dropdown',
      options: [
        {
          label: 'Member',
          id: 'member',
        },
        {
          label: 'Shared',
          id: 'shared',
        },
        {
          label: 'All',
          id: 'all',
        },
      ],
      condition: {
        field: 'operation',
        value: 'list_users',
      },
      mode: 'advanced',
      value: () => 'member',
    },
    {
      id: 'role',
      title: 'User Role',
      type: 'dropdown',
      options: [
        {
          label: 'Owner',
          id: 'owner',
        },
        {
          label: 'Member',
          id: 'member',
        },
        {
          label: 'Admin',
          id: 'admin',
        },
        {
          label: 'It Admin',
          id: 'it-admin',
        },
        {
          label: 'Network Admin',
          id: 'network-admin',
        },
        {
          label: 'Billing Admin',
          id: 'billing-admin',
        },
        {
          label: 'Auditor',
          id: 'auditor',
        },
      ],
      condition: {
        field: 'operation',
        value: 'set_user_role',
      },
      required: {
        field: 'operation',
        value: 'set_user_role',
      },
    },
    {
      id: 'name',
      title: 'Device Name',
      type: 'short-input',
      placeholder: 'New name; leave empty to reset to the OS hostname',
      condition: {
        field: 'operation',
        value: 'set_device_name',
      },
    },
    {
      id: 'attributeKey',
      title: 'Attribute Key',
      type: 'short-input',
      placeholder: 'custom:diskEncryption',
      condition: {
        field: 'operation',
        value: ['set_device_attribute', 'delete_device_attribute'],
      },
      required: true,
    },
    {
      id: 'attributeValue',
      title: 'Attribute Value (JSON)',
      type: 'short-input',
      placeholder: 'true, 100, or "encrypted"',
      condition: {
        field: 'operation',
        value: 'set_device_attribute',
      },
      required: true,
    },
    {
      id: 'expiry',
      title: 'Attribute Expiry',
      type: 'short-input',
      placeholder: '2026-12-01T00:00:00Z; no expiry by default',
      condition: {
        field: 'operation',
        value: 'set_device_attribute',
      },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        generationType: 'timestamp',
        placeholder: 'When should the attribute expire?',
        prompt:
          'Generate the expiry time for a Tailscale posture attribute. Return ONLY the RFC 3339 timestamp.',
      },
    },
    {
      id: 'comment',
      title: 'Audit Comment',
      type: 'short-input',
      placeholder: 'Reason for setting this attribute (optional)',
      condition: {
        field: 'operation',
        value: 'set_device_attribute',
      },
      mode: 'advanced',
    },
    {
      id: 'splitDns',
      title: 'Split DNS (JSON)',
      type: 'long-input',
      placeholder: '{"corp.example.com": ["10.0.0.53"]}',
      condition: {
        field: 'operation',
        value: ['set_split_dns', 'update_split_dns'],
      },
      required: true,
      wandConfig: {
        enabled: true,
        generationType: 'json-object',
        placeholder: 'Describe the domains and DNS resolvers',
        prompt:
          'Generate a Tailscale split DNS map of domain names to arrays of nameserver IP addresses. Use null to delete a domain in an update. Return ONLY the JSON object.',
      },
    },
    {
      id: 'dnsConfiguration',
      title: 'DNS Configuration (JSON)',
      type: 'long-input',
      placeholder:
        '{"nameservers": [{"address": "1.1.1.1", "useWithExitNode": true}], "splitDNS": {}, "searchPaths": [], "preferences": {"magicDNS": true, "overrideLocalDNS": true}}',
      condition: {
        field: 'operation',
        value: 'set_dns_configuration',
      },
      required: true,
    },
    {
      id: 'settings',
      title: 'Tailnet Settings (JSON)',
      type: 'long-input',
      placeholder: '{"devicesApprovalOn": true, "devicesKeyDurationDays": 90}',
      condition: {
        field: 'operation',
        value: 'update_tailnet_settings',
      },
      required: true,
    },
  ],

  tools: {
    access: [
      'tailscale_list_devices',
      'tailscale_get_device',
      'tailscale_set_device_name',
      'tailscale_delete_device',
      'tailscale_authorize_device',
      'tailscale_set_device_tags',
      'tailscale_get_device_routes',
      'tailscale_set_device_routes',
      'tailscale_update_device_key',
      'tailscale_expire_device_key',
      'tailscale_get_device_attributes',
      'tailscale_set_device_attribute',
      'tailscale_delete_device_attribute',
      'tailscale_list_dns_nameservers',
      'tailscale_set_dns_nameservers',
      'tailscale_get_dns_preferences',
      'tailscale_set_dns_preferences',
      'tailscale_get_dns_searchpaths',
      'tailscale_set_dns_searchpaths',
      'tailscale_get_split_dns',
      'tailscale_update_split_dns',
      'tailscale_set_split_dns',
      'tailscale_get_dns_configuration',
      'tailscale_set_dns_configuration',
      'tailscale_list_users',
      'tailscale_get_user',
      'tailscale_set_user_role',
      'tailscale_approve_user',
      'tailscale_suspend_user',
      'tailscale_restore_user',
      'tailscale_delete_user',
      'tailscale_create_auth_key',
      'tailscale_list_auth_keys',
      'tailscale_get_auth_key',
      'tailscale_delete_auth_key',
      'tailscale_get_acl',
      'tailscale_validate_acl',
      'tailscale_set_acl',
      'tailscale_get_tailnet_settings',
      'tailscale_update_tailnet_settings',
    ],
    config: {
      tool: (params) => `tailscale_${params.operation}`,
      params: (params) => {
        const mapped: Record<string, unknown> = {
          ...params,
          dns: params.dnsServers,
          description: params.authKeyDescription,
          name: params.name ?? '',
          role: params.operation === 'list_users' ? params.roleFilter || undefined : params.role,
        }
        const defaults =
          Object.entries(SWITCH_DEFAULTS).find(
            ([operation]) => operation === params.operation
          )?.[1] ?? {}
        for (const [field, defaultValue] of Object.entries(defaults)) {
          const value = params[field]
          if (value == null || value === '') {
            mapped[field] = defaultValue
          } else if (typeof value === 'boolean') {
            mapped[field] = value
          } else if (value === 'true' || value === 'false') {
            mapped[field] = value === 'true'
          } else {
            throw new Error(`${field} must be true or false`)
          }
        }
        if (
          params.operation === 'create_auth_key' &&
          params.expirySeconds != null &&
          params.expirySeconds !== ''
        ) {
          const expirySeconds = Number(params.expirySeconds)
          if (!Number.isFinite(expirySeconds)) throw new Error('Expiry must be a finite number')
          mapped.expirySeconds = expirySeconds
        }
        return mapped
      },
    },
  },

  inputs: {
    roleFilter: { type: 'string', description: 'Filter the user list by role' },
    details: { type: 'boolean', description: 'Include HuJSON policy warnings and errors' },
    settings: { type: 'string', description: 'Tailnet Settings (JSON)' },
    dnsConfiguration: { type: 'string', description: 'DNS Configuration (JSON)' },
    splitDns: { type: 'string', description: 'Split DNS (JSON)' },
    comment: { type: 'string', description: 'Audit Comment' },
    expiry: { type: 'string', description: 'Attribute Expiry' },
    attributeValue: { type: 'string', description: 'Attribute Value (JSON)' },
    attributeKey: { type: 'string', description: 'Attribute Key' },
    name: { type: 'string', description: 'Device Name' },
    role: { type: 'string', description: 'User Role' },
    userType: { type: 'string', description: 'User Type' },
    all: { type: 'boolean', description: 'Include All Tailnet Keys' },
    filters: { type: 'string', description: 'Device Filters' },
    fields: { type: 'string', description: 'Device Fields' },
    apiKey: { type: 'string', description: 'Tailscale API access token or OAuth access token' },
    tailnet: { type: 'string', description: 'Tailnet ID, legacy name, or - for default' },
    deviceId: { type: 'string', description: 'Device ID' },
    keyId: { type: 'string', description: 'Auth key ID' },
    userId: { type: 'string', description: 'User ID' },
    acl: { type: 'string', description: 'ACL policy file as a JSON string' },
    ifMatch: { type: 'string', description: 'ETag for optimistic concurrency on ACL updates' },
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
    warnings: { type: 'json', description: 'Policy warning strings from detailed Get ACL' },
    errors: { type: 'json', description: 'Policy parsing error strings from detailed Get ACL' },
    connectedToControl: { type: 'boolean', description: 'connectedToControl' },
    multipleConnections: { type: 'boolean', description: 'multipleConnections' },
    clientConnectivity: {
      type: 'json',
      description:
        'Device connectivity (endpoints, mappingVariesByDestIP, latency, clientSupports)',
    },
    tailnetLockError: { type: 'string', description: 'tailnetLockError' },
    tailnetLockKey: { type: 'string', description: 'tailnetLockKey' },
    sshEnabled: { type: 'boolean', description: 'sshEnabled' },
    postureIdentity: { type: 'json', description: 'Posture identity (serialNumbers, disabled)' },
    postureStatus: {
      type: 'json',
      description: 'Posture status (passing, impacting, failingAssertions)',
    },
    isEphemeral: { type: 'boolean', description: 'isEphemeral' },
    distro: { type: 'json', description: 'OS distribution (name, version, codeName)' },
    keyType: { type: 'string', description: 'keyType' },
    expirySeconds: { type: 'number', description: 'expirySeconds' },
    updated: { type: 'string', description: 'updated' },
    scopes: { type: 'json', description: 'scopes' },
    invalid: { type: 'boolean', description: 'invalid' },
    audience: { type: 'string', description: 'audience' },
    issuer: { type: 'string', description: 'issuer' },
    subject: { type: 'string', description: 'subject' },
    customClaimRules: { type: 'json', description: 'customClaimRules' },
    tailnetId: { type: 'string', description: 'Tailnet ID for a user' },
    displayName: { type: 'string', description: 'User display name' },
    loginName: { type: 'string', description: 'User login name' },
    profilePicURL: { type: 'string', description: 'User profile picture URL' },
    role: { type: 'string', description: 'User role' },
    status: { type: 'string', description: 'User status' },
    type: { type: 'string', description: 'User relationship to the tailnet' },
    deviceCount: { type: 'number', description: 'Number of devices owned by a user' },
    currentlyConnected: {
      type: 'boolean',
      description: 'Whether a user has a device connected to the control server',
    },
    attributeKey: { type: 'string', description: 'Deleted custom posture attribute key' },
    attributes: {
      type: 'json',
      description: 'Map of posture attribute names to string, number, or boolean values',
    },
    expiries: { type: 'json', description: 'Map of posture attribute names to expiry timestamps' },
    splitDns: { type: 'json', description: 'Map of domain names to DNS resolver arrays or null' },
    valid: {
      type: 'boolean',
      description: 'Whether ACL validation and tests passed without warnings',
    },
    message: { type: 'string', description: 'ACL validation summary' },
    results: { type: 'json', description: 'ACL test diagnostics [{user, errors, warnings}]' },
    settings: {
      type: 'json',
      description:
        'Tailnet settings (device and user approval, key expiry, updates, policy management, logging, routing, HTTPS)',
    },
    dnsConfiguration: {
      type: 'json',
      description: 'Full DNS configuration (nameservers, splitDNS, searchPaths, preferences)',
    },

    devices: {
      type: 'json',
      description:
        'Devices [{id, nodeId, hostname, user, os, tags, authorized, lastSeen, connectedToControl, updateAvailable}]',
    },
    count: { type: 'number', description: 'Total count of items returned' },
    id: { type: 'string', description: 'Device or auth key ID' },
    nodeId: { type: 'string', description: 'Preferred device ID' },
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
    users: {
      type: 'json',
      description:
        'Users [{id, displayName, loginName, role, status, type, tailnetId, deviceCount, currentlyConnected}]',
    },
    keys: {
      type: 'json',
      description:
        'Active keys [{id, keyType, userId, description, created, expires, scopes, tags, capabilities}]',
    },
    key: { type: 'string', description: 'Auth key value (only at creation)' },
    keyId: { type: 'string', description: 'Auth key ID' },
    description: { type: 'string', description: 'Auth key description' },
    expires: { type: 'string', description: 'Device key or auth key expiration timestamp' },
    revoked: { type: 'string', description: 'Revocation timestamp' },
    capabilities: {
      type: 'json',
      description: 'Device enrollment capabilities (reusable, ephemeral, preauthorized, tags)',
    },
    acl: { type: 'string', description: 'Policy as JSON or original HuJSON for detailed Get ACL' },
    etag: { type: 'string', description: 'ACL ETag for conditional updates' },
    userId: { type: 'string', description: 'User ID' },
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
        'Create a scheduled workflow that diffs Tailscale ACLs against the source of truth, validates the proposed policy with Validate ACL, alerts on drift to Slack, and, on approval, pushes the corrected policy back with Set ACL.',
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
        "Create a workflow that on a Workday termination deletes the departing engineer's Tailscale devices, revokes their auth keys, suspends their tailnet user account, and writes the security audit log.",
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
      name: 'synchronize-device-posture',
      description:
        'Publish custom device posture signals with an expiry so access rules can use current compliance data.',
      content:
        '# Synchronize Device Posture\n\n1. Find the device nodeId with List Devices.\n2. Use Get Device Attributes to inspect the current signals.\n3. Use Set Device Attribute with a custom: key and a JSON scalar value from your compliance source. Set Attribute Expiry so stale signals disappear automatically, and add an audit comment.\n4. Read the attributes again to verify the value and expiry; use Delete Device Attribute to remove a signal.\n\nReturn the device ID, attribute value, and expiry.',
    },
    {
      name: 'manage-private-dns-routes',
      description:
        'Maintain split DNS resolvers for private domains without replacing unrelated DNS routes.',
      content:
        '# Manage Private DNS Routes\n\n1. Use Get Split DNS to read the current domain-to-resolver map.\n2. Use Update Split DNS with only the domains being changed. Supply null for a domain to remove it.\n3. Use Get DNS Configuration when resolver behavior with exit nodes or overrideLocalDNS matters.\n4. Read the configuration again and report the affected domains and resolvers.\n\nUse Set Split DNS or Set DNS Configuration only when replacing the full corresponding configuration is intended.',
    },
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
      description:
        "Deauthorize or remove a departing user's devices and auth keys, then suspend or delete their tailnet account.",
      content:
        '# Offboard a Tailscale Device\n\nRemove a device from the tailnet during offboarding so access is cut cleanly.\n\n## Steps\n1. Use List Devices to find the deviceId tied to the departing user.\n2. To immediately cut access use Authorize Device set to Deauthorize, or Delete Device to remove it entirely.\n3. Use List Keys and filter for keyType auth and the departing userId before revoking any enrollment keys with Delete Auth Key.\n4. Use List Users to find the userId, then Suspend User to freeze access reversibly, or Delete User to remove the account entirely.\n5. Capture the device detail with Get Device before deletion if you need an audit record.\n\n## Output\nConfirm the device was deauthorized or deleted, the auth keys were revoked, and the user account was suspended or deleted for the offboarding audit log.',
    },
    {
      name: 'update-tailnet-acl',
      description:
        'Push an updated ACL policy file to the tailnet using ETag-guarded writes to avoid clobbering concurrent edits.',
      content:
        '# Update the Tailnet ACL as Policy-as-Code\n\nApply a reviewed ACL change programmatically instead of editing it by hand in the admin console.\n\n## Steps\n1. Use Get ACL to fetch the current policy file and its etag.\n2. Compute or generate the new policy JSON from your source of truth (git, agent-authored rules, etc.).\n3. Run Validate ACL with the proposed policy, then use Set ACL with the new ACL Policy JSON, passing the etag from step 1 in If-Match to guard against concurrent updates (use "ts-default" instead if you only want to replace an untouched default policy).\n4. If the write fails with a precondition error, re-fetch the ACL and retry.\n\n## Output\nReturn the updated ACL JSON and its new etag, plus a summary of what changed for the change-management record.',
    },
    {
      name: 'lock-down-compromised-device',
      description:
        "Immediately expire a suspected-compromised device's node key so it must re-authenticate before rejoining the tailnet.",
      content:
        "# Lock Down a Compromised Device\n\nCut off a device the moment it looks compromised, without waiting for its key to expire naturally.\n\n## Steps\n1. Use Get Device or List Devices to confirm the deviceId and review its tags, addresses, and lastSeen.\n2. Use Expire Device Key to immediately invalidate the device's node key so it can no longer connect until it re-authenticates.\n3. For a harder block, follow up with Authorize Device set to Deauthorize, or Delete Device to remove it outright.\n4. Log the deviceId, hostname, and user in the incident record.\n\n## Output\nConfirm the key was expired (and the device deauthorized/deleted if applicable) for the security incident log.",
    },
  ],
} as const satisfies BlockMeta
