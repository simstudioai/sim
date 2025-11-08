import { SalesforceIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { SalesforceResponse } from '@/tools/salesforce/types'

export const SalesforceBlock: BlockConfig<SalesforceResponse> = {
  type: 'salesforce',
  name: 'Salesforce',
  description: 'Interact with Salesforce CRM',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Salesforce into your workflow. Manage accounts, contacts, leads, opportunities, and other CRM objects with powerful automation capabilities.',
  docsLink: 'https://docs.sim.ai/tools/salesforce',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: SalesforceIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [{ label: 'Get Accounts', id: 'get_accounts' }],
      value: () => 'get_accounts',
    },
    {
      id: 'credential',
      title: 'Salesforce Account',
      type: 'oauth-input',
      provider: 'salesforce',
      serviceId: 'salesforce',
      requiredScopes: ['api', 'full', 'openid', 'refresh_token', 'offline_access'],
      placeholder: 'Select Salesforce account',
      required: true,
    },
    {
      id: 'fields',
      title: 'Fields to Return',
      type: 'short-input',
      placeholder: 'Comma-separated list (e.g., "Id,Name,Industry,Phone,Website")',
      condition: { field: 'operation', value: ['get_accounts'] },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results (default: 100, max: 2000)',
      condition: { field: 'operation', value: ['get_accounts'] },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'Field and direction (e.g., "Name ASC" or "CreatedDate DESC")',
      condition: { field: 'operation', value: ['get_accounts'] },
    },
  ],
  tools: {
    access: ['salesforce_get_accounts'],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'get_accounts':
            return 'salesforce_get_accounts'
          default:
            throw new Error(`Unknown operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, operation, ...rest } = params

        const cleanParams: Record<string, any> = {
          credential,
        }

        // Add other params
        Object.entries(rest).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            cleanParams[key] = value
          }
        })

        return cleanParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Salesforce access token' },
    fields: {
      type: 'string',
      description: 'Comma-separated fields to return',
    },
    limit: { type: 'string', description: 'Maximum results (default: 100, max: 2000)' },
    orderBy: { type: 'string', description: 'Field and direction for ordering results' },
  },
  outputs: {
    accounts: { type: 'json', description: 'Array of account objects' },
    paging: { type: 'json', description: 'Pagination info with next records URL' },
    metadata: { type: 'json', description: 'Operation metadata' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
