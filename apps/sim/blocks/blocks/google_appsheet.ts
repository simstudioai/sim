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
      wandConfig: {
        enabled: true,
        prompt: `Generate an AppSheet Selector expression based on the user's description. The table name in the expression is a placeholder - use the literal word matching the table being queried.

Format examples:
- Filter(TableName, [Status] = "Open")
- Filter(TableName, AND([Age] >= 21, [State] = "CA"))
- OrderBy(Filter(TableName, true), [LastName], true)
- Top(OrderBy(Filter(TableName, true), [Date], true), 10)

Return ONLY the Selector expression - no explanations, no quotes around the entire expression.`,
        placeholder: 'Describe the filter/sort criteria (e.g., "open orders sorted by date")...',
      },
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
    rows: {
      type: 'json',
      description: 'Rows returned by the AppSheet operation: [{ columnName: value, ... }]',
    },
    metadata: { type: 'json', description: 'Operation metadata: { rowCount: number }' },
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
  skills: [
    {
      name: 'add-appsheet-row',
      description: 'Add a new row to an AppSheet table in response to an external event.',
      content:
        '# Add AppSheet Row\n\nCreate a new row in an AppSheet table, e.g. when a form is submitted or an external event fires.\n\n## Steps\n1. Set App ID and Table Name for the target table.\n2. Provide the Rows JSON array with one object per new row, e.g. `[{ "FirstName": "Jan", "LastName": "Jones" }]`.\n3. Give the key column an explicit value, or omit it if its Initial value expression (e.g. UNIQUEID()) generates it automatically.\n4. Run the Add Rows operation and confirm the returned row includes the generated key.\n\n## Output\nThe newly created row(s), including any generated key values, plus a row count.',
    },
    {
      name: 'find-appsheet-rows',
      description:
        'Query an AppSheet table with a Selector expression to filter, sort, or limit rows.',
      content:
        '# Find AppSheet Rows\n\nRead rows from an AppSheet table, optionally filtered and sorted with a Selector expression.\n\n## Steps\n1. Set App ID and Table Name for the target table.\n2. Leave Selector blank to return every row, or provide an expression such as `Filter(TableName, [Status] = "Open")`.\n3. Combine `OrderBy()` and `Top()` to sort and limit results, e.g. `Top(OrderBy(Filter(TableName, true), [Date], true), 10)`.\n4. Run the Find Rows operation.\n\n## Output\nThe matching rows and a row count, ready to feed into an agent or a downstream integration.',
    },
    {
      name: 'sync-appsheet-updates-to-sheet',
      description:
        'Mirror updated AppSheet rows into a Google Sheet to maintain a real-time audit trail.',
      content:
        '# Sync AppSheet Updates to a Sheet\n\nKeep a Google Sheet in sync with changes to an AppSheet table, mirroring the pattern used in AppSheet-Zapier integrations for audit trails.\n\n## Steps\n1. Use Find Rows with a Selector expression that isolates recently changed rows (e.g. filtered by a LastModified column).\n2. For each row, append or update the corresponding row in a Google Sheet.\n3. Schedule the workflow to run on an interval so the sheet stays current.\n\n## Output\nA Google Sheet that reflects the latest AppSheet row data, useful as a shareable audit trail or reporting source.',
    },
  ],
} as const satisfies BlockMeta
