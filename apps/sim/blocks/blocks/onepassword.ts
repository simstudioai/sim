import { OnePasswordIcon } from '@/components/icons'
import { AuthMode, type BlockConfig } from '@/blocks/types'

export const OnePasswordBlock: BlockConfig = {
  type: 'onepassword',
  name: '1Password',
  description: 'Manage secrets and items in 1Password vaults',
  longDescription:
    'Access and manage secrets stored in 1Password vaults using the Connect API or Service Account SDK. List vaults, retrieve items with their fields and secrets, create new items, update existing ones, delete items, and resolve secret references.',
  docsLink: 'https://docs.sim.ai/tools/onepassword',
  category: 'tools',
  bgColor: '#E0E0E0',
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
      required: { field: 'connectionMode', value: 'connect' },
      condition: { field: 'connectionMode', value: 'connect' },
    },
    {
      id: 'apiKey',
      title: 'Connect Token',
      type: 'short-input',
      placeholder: 'Enter your 1Password Connect token',
      password: true,
      required: { field: 'connectionMode', value: 'connect' },
      condition: { field: 'connectionMode', value: 'connect' },
    },
    {
      id: 'secretReference',
      title: 'Secret Reference',
      type: 'short-input',
      placeholder: 'op://vault-name/item-name/field-name',
      required: { field: 'operation', value: 'resolve_secret' },
      condition: { field: 'operation', value: 'resolve_secret' },
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
        value: ['get_item', 'replace_item', 'update_item', 'delete_item'],
      },
      condition: {
        field: 'operation',
        value: ['get_item', 'replace_item', 'update_item', 'delete_item'],
      },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'SCIM filter (e.g., name eq "My Vault")',
      condition: { field: 'operation', value: ['list_vaults', 'list_items'] },
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
      title: 'Fields (JSON)',
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
      description: 'Operation response data',
    },
  },
}
