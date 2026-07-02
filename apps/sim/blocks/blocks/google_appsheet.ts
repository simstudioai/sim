import { GoogleAppsheetIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import type { GoogleAppsheetResponse } from '@/tools/google_appsheet/types'

export const GoogleAppsheetBlock: BlockConfig<GoogleAppsheetResponse> = {
  type: 'google_appsheet',
  name: 'Google AppSheet',
  description: 'Read, add, edit, and delete rows in a Google AppSheet table',
  authMode: AuthMode.ApiKey,
  longDescription:
    'Integrate Google AppSheet into your workflow. Find, add, edit, and delete rows in an AppSheet table using the AppSheet API. Requires an AppSheet Enterprise plan with the API enabled and an Application Access Key.',
  docsLink: 'https://docs.sim.ai/integrations/google_appsheet',
  category: 'tools',
  integrationType: IntegrationType.Databases,
  bgColor: '#FFFFFF',
  icon: GoogleAppsheetIcon,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Find Rows', id: 'google_appsheet_find_rows' },
        { label: 'Add Rows', id: 'google_appsheet_add_rows' },
        { label: 'Edit Rows', id: 'google_appsheet_edit_rows' },
        { label: 'Delete Rows', id: 'google_appsheet_delete_rows' },
      ],
      value: () => 'google_appsheet_find_rows',
    },
    {
      id: 'appId',
      title: 'App ID',
      type: 'short-input',
      placeholder: 'App > Settings > Integrations > IN',
      required: true,
    },
    {
      id: 'tableName',
      title: 'Table Name',
      type: 'short-input',
      placeholder: 'e.g. Orders',
      required: true,
    },
    // Find Rows operation inputs
    {
      id: 'selector',
      title: 'Selector',
      type: 'long-input',
      placeholder:
        'Optional expression, e.g. Filter(Orders, [Status] = "Open") or Top(OrderBy(Filter(Orders, true), [Date], true), 10)',
      condition: { field: 'operation', value: 'google_appsheet_find_rows' },
      mode: 'advanced',
    },
    // Add/Edit/Delete Rows operation inputs (shared JSON array field)
    {
      id: 'rows',
      title: 'Rows (JSON Array)',
      type: 'code',
      language: 'json',
      placeholder: 'For Add: `[{ "FirstName": "Jan", "LastName": "Jones" }]`',
      condition: {
        field: 'operation',
        value: [
          'google_appsheet_add_rows',
          'google_appsheet_edit_rows',
          'google_appsheet_delete_rows',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'google_appsheet_add_rows',
          'google_appsheet_edit_rows',
          'google_appsheet_delete_rows',
        ],
      },
      wandConfig: {
        enabled: true,
        prompt: `Generate an AppSheet rows JSON array based on the user's description.
Each element is an object mapping column names to values.

Current rows: {context}

For Add, provide the columns for each new row:
[{ "FirstName": "Jan", "LastName": "Jones" }]

For Edit, include the key column plus the columns to change:
[{ "RowID": "123", "Status": "Done" }]

For Delete, include only the key column:
[{ "RowID": "123" }]

Return ONLY the valid JSON array - no explanations, no markdown.`,
        placeholder: 'Describe the rows to add, edit, or delete...',
        generationType: 'json-object',
      },
    },
    {
      id: 'region',
      title: 'Region',
      type: 'dropdown',
      options: [
        { label: 'Global (www)', id: 'www' },
        { label: 'Europe (eu)', id: 'eu' },
        { label: 'Asia Pacific (asia-southeast)', id: 'asia-southeast' },
      ],
      value: () => 'www',
      mode: 'advanced',
    },
    // API Key (common to all operations)
    {
      id: 'apiKey',
      title: 'Application Access Key',
      type: 'short-input',
      placeholder: 'Enter your AppSheet Application Access Key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: [
      'google_appsheet_find_rows',
      'google_appsheet_add_rows',
      'google_appsheet_edit_rows',
      'google_appsheet_delete_rows',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const { rows, ...rest } = params
        const result: Record<string, unknown> = { ...rest }
        if (params.operation !== 'google_appsheet_find_rows' && rows) {
          try {
            result.rows = typeof rows === 'string' ? JSON.parse(rows) : rows
          } catch (error: any) {
            throw new Error(`Invalid JSON in Rows field: ${error.message}`)
          }
        }
        return result
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    appId: { type: 'string', description: 'AppSheet app ID' },
    tableName: { type: 'string', description: 'Name of the table to operate on' },
    region: { type: 'string', description: 'AppSheet region subdomain' },
    apiKey: { type: 'string', description: 'AppSheet Application Access Key' },
    selector: { type: 'string', description: 'Optional AppSheet Selector expression' },
    rows: { type: 'json', description: 'Array of row objects for the operation' },
  },

  outputs: {
    rows: { type: 'json', description: 'Rows returned by the AppSheet operation' },
    metadata: { type: 'json', description: 'Operation metadata, including row count' },
  },
}

export const GoogleAppsheetBlockMeta = {
  tags: ['spreadsheet', 'automation', 'google-workspace'],
  url: 'https://about.appsheet.com',
  templates: [
    {
      icon: GoogleAppsheetIcon,
      title: 'AppSheet order intake',
      prompt:
        'Build a workflow triggered by a form submission that adds a new row to an AppSheet Orders table, then posts a confirmation message to Slack with the order details.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: GoogleAppsheetIcon,
      title: 'AppSheet daily status digest',
      prompt:
        'Create a scheduled workflow that runs daily, finds all AppSheet rows where Status is "Open", summarizes them with an agent, and emails the summary to the operations team.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'monitoring'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: GoogleAppsheetIcon,
      title: 'AppSheet inventory sync',
      prompt:
        'Build a workflow that reads updated rows from an AppSheet Inventory table, transforms the quantities with an agent, and writes the reconciled totals into a Google Sheet.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['automation', 'analysis'],
      alsoIntegrations: ['google_sheets'],
    },
    {
      icon: GoogleAppsheetIcon,
      title: 'AppSheet ticket escalation',
      prompt:
        'Build a workflow that finds AppSheet rows where Priority is "High" and Status is not "Resolved", and edits each row to add an Escalated flag, then creates a Linear issue for each one.',
      modules: ['agent', 'workflows'],
      category: 'support',
      tags: ['automation', 'ticketing'],
      alsoIntegrations: ['linear'],
    },
    {
      icon: GoogleAppsheetIcon,
      title: 'AppSheet cleanup job',
      prompt:
        'Create a scheduled workflow that finds AppSheet rows older than 90 days with Status "Archived" and deletes them, then logs a summary of how many rows were removed to a table.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['automation'],
    },
    {
      icon: GoogleAppsheetIcon,
      title: 'AppSheet lead router',
      prompt:
        'Build a workflow that finds new AppSheet rows in a Leads table, uses an agent to classify each lead by region, and edits the row to assign the correct sales rep.',
      modules: ['agent', 'workflows'],
      category: 'sales',
      tags: ['automation', 'crm'],
    },
    {
      icon: GoogleAppsheetIcon,
      title: 'AppSheet field service report',
      prompt:
        'Build a workflow that finds all AppSheet rows completed today in a Work Orders table, generates a summary report with an agent, and saves it as a file for the team.',
      modules: ['agent', 'files', 'workflows'],
      category: 'operations',
      tags: ['automation', 'analysis'],
    },
  ],
} as const satisfies BlockMeta
