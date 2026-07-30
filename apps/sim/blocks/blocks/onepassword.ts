import { OnePasswordIcon } from '@/components/icons'
import { AuthMode, type BlockConfig, type BlockMeta, IntegrationType } from '@/blocks/types'

export const OnePasswordBlock: BlockConfig = {
  type: 'onepassword',
  name: '1Password',
  description: 'Manage secrets and items in 1Password vaults',
  longDescription:
    'Access and manage secrets stored in 1Password vaults using the Connect API or Service Account SDK. List vaults, retrieve items with their fields and secrets, download attached files, create new items, update existing ones, delete items, and resolve secret references.',
  docsLink: 'https://docs.sim.ai/integrations/onepassword',
  category: 'tools',
  integrationType: IntegrationType.Security,
  bgColor: '#FFFFFF',
  icon: OnePasswordIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Vaults', id: 'list_vaults' },
        { label: 'Get Vault', id: 'get_vault' },
        { label: 'List Items', id: 'list_items' },
        { label: 'Get Item', id: 'get_item' },
        { label: 'Get Item File', id: 'get_item_file' },
        { label: 'Create Item', id: 'create_item' },
        { label: 'Replace Item', id: 'replace_item' },
        { label: 'Update Item', id: 'update_item' },
        { label: 'Delete Item', id: 'delete_item' },
        { label: 'Resolve Secret', id: 'resolve_secret' },
      ],
      value: () => 'get_item',
    },
    {
      id: 'connectionMode',
      title: 'Connection Mode',
      type: 'dropdown',
      options: [
        { label: 'Service Account', id: 'service_account' },
        { label: 'Connect Server', id: 'connect' },
      ],
      value: () => 'service_account',
    },
    {
      id: 'serviceAccountToken',
      title: 'Service Account Token',
      type: 'short-input',
      placeholder: 'Enter your 1Password Service Account token',
      password: true,
      required: { field: 'connectionMode', value: 'service_account' },
      condition: { field: 'connectionMode', value: 'service_account' },
    },
    {
      id: 'serverUrl',
      title: 'Server URL',
      type: 'short-input',
      placeholder: 'http://localhost:8080',
      required: {
        field: 'connectionMode',
        value: 'connect',
        and: { field: 'operation', value: 'resolve_secret', not: true },
      },
      condition: {
        field: 'connectionMode',
        value: 'connect',
        and: { field: 'operation', value: 'resolve_secret', not: true },
      },
    },
    {
      id: 'apiKey',
      title: 'Connect Token',
      type: 'short-input',
      placeholder: 'Enter your 1Password Connect token',
      password: true,
      required: {
        field: 'connectionMode',
        value: 'connect',
        and: { field: 'operation', value: 'resolve_secret', not: true },
      },
      condition: {
        field: 'connectionMode',
        value: 'connect',
        and: { field: 'operation', value: 'resolve_secret', not: true },
      },
    },
    {
      id: 'secretReference',
      title: 'Secret Reference',
      type: 'short-input',
      placeholder: 'op://vault-name-or-id/item-name-or-id/field-name',
      required: { field: 'operation', value: 'resolve_secret' },
      condition: { field: 'operation', value: 'resolve_secret' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a 1Password secret reference URI based on the user's description.
The format is: op://vault-name-or-id/item-name-or-id/field-name
You can also use: op://vault/item/section/field for fields inside sections.
Examples:
- op://Development/AWS/access-key
- op://Production/Database/password
- op://MyVault/Stripe/API Keys/secret-key

Return ONLY the op:// URI - no explanations, no quotes, no markdown.`,
      },
    },
    {
      id: 'vaultId',
      title: 'Vault ID',
      type: 'short-input',
      placeholder: 'Enter vault UUID',
      required: {
        field: 'operation',
        value: [
          'get_vault',
          'list_items',
          'get_item',
          'get_item_file',
          'create_item',
          'replace_item',
          'update_item',
          'delete_item',
        ],
      },
      condition: {
        field: 'operation',
        value: ['list_vaults', 'resolve_secret'],
        not: true,
      },
    },
    {
      id: 'itemId',
      title: 'Item ID',
      type: 'short-input',
      placeholder: 'Enter item UUID',
      required: {
        field: 'operation',
        value: ['get_item', 'get_item_file', 'replace_item', 'update_item', 'delete_item'],
      },
      condition: {
        field: 'operation',
        value: ['get_item', 'get_item_file', 'replace_item', 'update_item', 'delete_item'],
      },
    },
    {
      id: 'fileId',
      title: 'File ID',
      type: 'short-input',
      placeholder: 'Enter file ID (from Get Item output)',
      required: { field: 'operation', value: 'get_item_file' },
      condition: { field: 'operation', value: 'get_item_file' },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'SCIM filter (e.g., name eq "My Vault")',
      condition: { field: 'operation', value: ['list_vaults', 'list_items'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a SCIM filter expression for a 1Password vault or item list based on the user's description.
Examples:
- name eq "My Vault"
- title eq "API Key"
- tag eq "production"

Return ONLY the SCIM filter expression - no explanations, no quotes, no markdown.`,
      },
    },
    {
      id: 'category',
      title: 'Category',
      type: 'dropdown',
      options: [
        { label: 'Login', id: 'LOGIN' },
        { label: 'Password', id: 'PASSWORD' },
        { label: 'API Credential', id: 'API_CREDENTIAL' },
        { label: 'Secure Note', id: 'SECURE_NOTE' },
        { label: 'Server', id: 'SERVER' },
        { label: 'Database', id: 'DATABASE' },
        { label: 'Credit Card', id: 'CREDIT_CARD' },
        { label: 'Identity', id: 'IDENTITY' },
        { label: 'SSH Key', id: 'SSH_KEY' },
        { label: 'Software License', id: 'SOFTWARE_LICENSE' },
        { label: 'Email Account', id: 'EMAIL_ACCOUNT' },
        { label: 'Membership', id: 'MEMBERSHIP' },
        { label: 'Passport', id: 'PASSPORT' },
        { label: 'Reward Program', id: 'REWARD_PROGRAM' },
        { label: 'Driver License', id: 'DRIVER_LICENSE' },
        { label: 'Bank Account', id: 'BANK_ACCOUNT' },
        { label: 'Medical Record', id: 'MEDICAL_RECORD' },
        { label: 'Outdoor License', id: 'OUTDOOR_LICENSE' },
        { label: 'Wireless Router', id: 'WIRELESS_ROUTER' },
        { label: 'Social Security Number', id: 'SOCIAL_SECURITY_NUMBER' },
      ],
      value: () => 'LOGIN',
      required: { field: 'operation', value: 'create_item' },
      condition: { field: 'operation', value: 'create_item' },
    },
    {
      id: 'title',
      title: 'Title',
      type: 'short-input',
      placeholder: 'Item title',
      condition: { field: 'operation', value: 'create_item' },
    },
    {
      id: 'tags',
      title: 'Tags',
      type: 'short-input',
      placeholder: 'Comma-separated tags (e.g., production, api)',
      condition: { field: 'operation', value: 'create_item' },
    },
    {
      id: 'fields',
      title: 'Fields',
      type: 'code',
      placeholder:
        '[\n  {\n    "label": "username",\n    "value": "admin",\n    "type": "STRING",\n    "purpose": "USERNAME"\n  }\n]',
      condition: { field: 'operation', value: 'create_item' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a 1Password item fields JSON array based on the user's description.
Each field object can have: label, value, type (STRING, CONCEALED, EMAIL, URL, TOTP, DATE), purpose (USERNAME, PASSWORD, NOTES, or empty).
Examples:
- [{"label":"username","value":"admin","type":"STRING","purpose":"USERNAME"},{"label":"password","value":"secret123","type":"CONCEALED","purpose":"PASSWORD"}]
- [{"label":"API Key","value":"sk-abc123","type":"CONCEALED"}]

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
      },
    },
    {
      id: 'item',
      title: 'Item (JSON)',
      type: 'code',
      placeholder:
        '{\n  "vault": {"id": "..."},\n  "category": "LOGIN",\n  "title": "My Item",\n  "fields": []\n}',
      required: { field: 'operation', value: 'replace_item' },
      condition: { field: 'operation', value: 'replace_item' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a full 1Password item JSON object based on the user's description.
The object must include vault.id, category, and optionally title, tags, fields, and sections.
Categories: LOGIN, PASSWORD, API_CREDENTIAL, SECURE_NOTE, SERVER, DATABASE, CREDIT_CARD, IDENTITY, SSH_KEY.
Field types: STRING, CONCEALED, EMAIL, URL, TOTP, DATE. Purposes: USERNAME, PASSWORD, NOTES, or empty.
Example: {"vault":{"id":"abc123"},"category":"LOGIN","title":"My Login","fields":[{"label":"username","value":"admin","type":"STRING","purpose":"USERNAME"}]}

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
      },
    },
    {
      id: 'operations',
      title: 'Patch Operations (JSON)',
      type: 'code',
      placeholder:
        '[\n  {\n    "op": "replace",\n    "path": "/title",\n    "value": "New Title"\n  }\n]',
      required: { field: 'operation', value: 'update_item' },
      condition: { field: 'operation', value: 'update_item' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of RFC6902 patch operations for a 1Password item based on the user's description.
Each operation has: op (add, remove, replace), path (JSON pointer), and value.
Examples:
- [{"op":"replace","path":"/title","value":"New Title"}]
- [{"op":"replace","path":"/fields/username/value","value":"newuser"}]
- [{"op":"add","path":"/tags/-","value":"production"}]

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
      },
    },
  ],

  tools: {
    access: [
      'onepassword_list_vaults',
      'onepassword_get_vault',
      'onepassword_list_items',
      'onepassword_get_item',
      'onepassword_get_item_file',
      'onepassword_create_item',
      'onepassword_replace_item',
      'onepassword_update_item',
      'onepassword_delete_item',
      'onepassword_resolve_secret',
    ],
    config: {
      tool: (params) => `onepassword_${params.operation}`,
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    connectionMode: { type: 'string', description: 'Connection mode: service_account or connect' },
    serviceAccountToken: { type: 'string', description: '1Password Service Account token' },
    serverUrl: { type: 'string', description: '1Password Connect server URL' },
    apiKey: { type: 'string', description: '1Password Connect token' },
    secretReference: { type: 'string', description: 'Secret reference URI (op://...)' },
    vaultId: { type: 'string', description: 'Vault UUID' },
    itemId: { type: 'string', description: 'Item UUID' },
    fileId: { type: 'string', description: 'File ID of an attachment on the item' },
    filter: { type: 'string', description: 'SCIM filter expression' },
    category: { type: 'string', description: 'Item category' },
    title: { type: 'string', description: 'Item title' },
    tags: { type: 'string', description: 'Comma-separated tags' },
    fields: { type: 'string', description: 'JSON array of field objects' },
    item: { type: 'string', description: 'Full item JSON for replacement' },
    operations: { type: 'string', description: 'JSON array of patch operations' },
  },

  outputs: {
    response: {
      type: 'json',
      description:
        'Deprecated — kept for backward compatibility with workflows saved before per-operation outputs were added below. Never populated; use the operation-specific outputs instead.',
    },
    vaults: {
      type: 'json',
      description:
        'List of accessible vaults [{id, name, description, items, type, createdAt, updatedAt}]',
      condition: { field: 'operation', value: 'list_vaults' },
    },
    id: {
      type: 'string',
      description: 'Vault or item ID',
      condition: {
        field: 'operation',
        value: ['get_vault', 'get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    name: {
      type: 'string',
      description: 'Vault name',
      condition: { field: 'operation', value: 'get_vault' },
    },
    description: {
      type: 'string',
      description: 'Vault description',
      condition: { field: 'operation', value: 'get_vault' },
    },
    items: {
      type: 'json',
      description:
        'Number of items in the vault (Get Vault) or item summaries [{id, title, category, tags, favorite, version, updatedAt}] (List Items)',
      condition: { field: 'operation', value: ['get_vault', 'list_items'] },
    },
    type: {
      type: 'string',
      description: 'Vault type (USER_CREATED, PERSONAL, or EVERYONE)',
      condition: { field: 'operation', value: 'get_vault' },
    },
    title: {
      type: 'string',
      description: 'Item title',
      condition: {
        field: 'operation',
        value: ['get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    category: {
      type: 'string',
      description: 'Item category (e.g., LOGIN, API_CREDENTIAL, SECURE_NOTE)',
      condition: {
        field: 'operation',
        value: ['get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    vault: {
      type: 'json',
      description: 'Vault reference the item belongs to {id}',
      condition: {
        field: 'operation',
        value: ['get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    fields: {
      type: 'json',
      description: 'Item fields including secrets [{id, label, type, purpose, value}]',
      condition: {
        field: 'operation',
        value: ['get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    sections: {
      type: 'json',
      description: 'Item sections [{id, label}]',
      condition: {
        field: 'operation',
        value: ['get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    files: {
      type: 'json',
      description:
        'Files attached to the item [{id, name, size, section}] — fetch content with Get Item File',
      condition: {
        field: 'operation',
        value: ['get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    tags: {
      type: 'json',
      description: 'Item tags',
      condition: {
        field: 'operation',
        value: ['get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    urls: {
      type: 'json',
      description: 'URLs associated with the item [{href, label, primary}]',
      condition: {
        field: 'operation',
        value: ['get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    favorite: {
      type: 'boolean',
      description: 'Whether the item is favorited',
      condition: {
        field: 'operation',
        value: ['get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    version: {
      type: 'number',
      description: 'Item version number',
      condition: {
        field: 'operation',
        value: ['get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    state: {
      type: 'string',
      description: 'Item state (ARCHIVED, or absent/null when active)',
      condition: {
        field: 'operation',
        value: ['get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    lastEditedBy: {
      type: 'string',
      description: 'ID of the last editor',
      condition: {
        field: 'operation',
        value: ['get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    createdAt: {
      type: 'string',
      description: 'Creation timestamp',
      condition: {
        field: 'operation',
        value: ['get_vault', 'get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    updatedAt: {
      type: 'string',
      description: 'Last update timestamp',
      condition: {
        field: 'operation',
        value: ['get_vault', 'get_item', 'create_item', 'replace_item', 'update_item'],
      },
    },
    success: {
      type: 'boolean',
      description: 'Whether the item was successfully deleted',
      condition: { field: 'operation', value: 'delete_item' },
    },
    value: {
      type: 'string',
      description: 'The resolved secret value',
      condition: { field: 'operation', value: 'resolve_secret' },
    },
    reference: {
      type: 'string',
      description: 'The original secret reference URI',
      condition: { field: 'operation', value: 'resolve_secret' },
    },
    file: {
      type: 'file',
      description: 'Downloaded file attachment',
      condition: { field: 'operation', value: 'get_item_file' },
    },
  },
}

export const OnePasswordBlockMeta = {
  tags: ['secrets-management', 'identity'],
  url: 'https://1password.com',
  templates: [
    {
      icon: OnePasswordIcon,
      title: '1Password vault audit',
      prompt:
        'Build a scheduled monthly workflow that scans 1Password vaults for weak or reused passwords, expired items, and unused secrets, and writes a remediation queue.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
    },
    {
      icon: OnePasswordIcon,
      title: '1Password offboarding sweep',
      prompt:
        'Create a workflow that on a Workday termination rotates the shared 1Password secrets the departing employee had access to, updates the affected items, and writes the action log.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'enterprise'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: OnePasswordIcon,
      title: '1Password access-review automator',
      prompt:
        'Build a scheduled quarterly workflow that inventories 1Password items per vault, requires owner re-attestation in Slack, and writes the audit log to a compliance table.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: OnePasswordIcon,
      title: '1Password secret rotation watcher',
      prompt:
        'Create a scheduled workflow that finds 1Password items older than the rotation policy, opens a Linear ticket per item to rotate, and writes the rotation status back.',
      modules: ['scheduled', 'tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'monitoring'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: OnePasswordIcon,
      title: '1Password onboarding kit',
      prompt:
        'Build a workflow that when a new hire is provisioned creates their starter 1Password items based on role and team, and writes the access record to the onboarding table.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['hr', 'automation'],
      alsoIntegrations: ['workday'],
    },
    {
      icon: OnePasswordIcon,
      title: '1Password Slack secret-share guard',
      prompt:
        'Create a workflow that monitors Slack for accidental secret sharing, redacts the message, and posts a polite reminder to use 1Password Secret Sharing instead.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['enterprise', 'communication'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: OnePasswordIcon,
      title: '1Password compliance reporter',
      prompt:
        'Build a scheduled workflow that produces a 1Password compliance report — item counts, ages, and categories per vault — and writes the report file for auditors.',
      modules: ['scheduled', 'agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['legal', 'enterprise'],
    },
  ],
  skills: [
    {
      name: 'fetch-secret-for-runtime',
      description:
        'Retrieve a secret (API key, token, or credential) from a 1Password vault to pass into a downstream step.',
      content:
        '# Fetch Secret for Runtime\n\nSecurely read a credential from 1Password so a later step can authenticate without hardcoding it.\n\n## Steps\n1. Identify the vault and item that holds the needed secret.\n2. Read the specific field (password, token, or key) from that item.\n3. Pass the value to the downstream tool or request that needs it.\n\n## Output\nConfirm the secret was retrieved without printing its value. Never echo, log, or include the raw secret in any summary or message.',
    },
    {
      name: 'audit-vault-items',
      description:
        'List items in a 1Password vault and report metadata like titles, categories, and last-updated dates.',
      content:
        '# Audit Vault Items\n\nProduce an inventory of items in a 1Password vault for review.\n\n## Steps\n1. List the items in the specified vault.\n2. For each item collect non-sensitive metadata: title, category, tags, and last-updated date.\n3. Flag items that look stale or duplicated based on titles and dates.\n\n## Output\nA table of items with metadata only. Do not retrieve or display any secret values, just the item references.',
    },
    {
      name: 'create-credential-item',
      description:
        'Store a new credential (login, API key, or token) as an item in a 1Password vault.',
      content:
        '# Create Credential Item\n\nSave a new secret into 1Password so it is centrally managed.\n\n## Steps\n1. Determine the target vault and the item category (login, API credential, secure note).\n2. Set the title and the secret fields from the provided values.\n3. Create the item in the vault.\n\n## Output\nConfirm the item was created with its title and vault. Do not repeat the secret value back in the response.',
    },
  ],
} as const satisfies BlockMeta
