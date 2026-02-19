import { MicrosoftDataverseIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import type { DataverseResponse } from '@/tools/microsoft_dataverse/types'

export const MicrosoftDataverseBlock: BlockConfig<DataverseResponse> = {
  type: 'microsoft_dataverse',
  name: 'Microsoft Dataverse',
  description: 'Manage records in Microsoft Dataverse tables',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Microsoft Dataverse into your workflow. Create, read, update, delete, upsert, associate, and query records in Dataverse tables using the Web API. Works with Dynamics 365, Power Platform, and custom Dataverse environments.',
  docsLink: 'https://docs.sim.ai/tools/microsoft_dataverse',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: MicrosoftDataverseIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'List Records', id: 'list_records' },
        { label: 'Get Record', id: 'get_record' },
        { label: 'Create Record', id: 'create_record' },
        { label: 'Update Record', id: 'update_record' },
        { label: 'Upsert Record', id: 'upsert_record' },
        { label: 'Delete Record', id: 'delete_record' },
        { label: 'Associate Records', id: 'associate' },
        { label: 'Disassociate Records', id: 'disassociate' },
        { label: 'WhoAmI', id: 'whoami' },
      ],
      value: () => 'list_records',
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      serviceId: 'microsoft-dataverse',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'https://dynamics.microsoft.com/user_impersonation',
        'offline_access',
      ],
      placeholder: 'Select Microsoft account',
      required: true,
    },
    {
      id: 'environmentUrl',
      title: 'Environment URL',
      type: 'short-input',
      placeholder: 'https://myorg.crm.dynamics.com',
      required: true,
    },
    {
      id: 'entitySetName',
      title: 'Entity Set Name',
      type: 'short-input',
      placeholder: 'Plural table name (e.g., accounts, contacts)',
      condition: {
        field: 'operation',
        value: 'whoami',
        not: true,
      },
      required: {
        field: 'operation',
        value: 'whoami',
        not: true,
      },
    },
    {
      id: 'recordId',
      title: 'Record ID',
      type: 'short-input',
      placeholder: 'Record GUID (e.g., 00000000-0000-0000-0000-000000000000)',
      condition: {
        field: 'operation',
        value: [
          'get_record',
          'update_record',
          'upsert_record',
          'delete_record',
          'associate',
          'disassociate',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'get_record',
          'update_record',
          'upsert_record',
          'delete_record',
          'associate',
          'disassociate',
        ],
      },
    },
    {
      id: 'data',
      title: 'Record Data',
      type: 'long-input',
      placeholder:
        'JSON object with column values (e.g., {"name": "Contoso", "telephone1": "555-0100"})',
      condition: { field: 'operation', value: ['create_record', 'update_record', 'upsert_record'] },
      required: { field: 'operation', value: ['create_record', 'update_record', 'upsert_record'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a Dataverse record JSON object based on the user's description.
The JSON should contain column logical names as keys and appropriate values.
Common Dataverse column naming conventions:
- Text: "name", "description", "emailaddress1", "telephone1"
- Lookup: "_primarycontactid_value" (read-only), use "primarycontactid@odata.bind": "/contacts(guid)" for setting
- Choice/OptionSet: integer values (e.g., "statecode": 0, "statuscode": 1)
- Date: ISO 8601 format (e.g., "createdon": "2024-01-15T00:00:00Z")
- Currency: decimal numbers (e.g., "revenue": 1000000.00)

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the record data you want to create or update...',
        generationType: 'json-object',
      },
    },
    {
      id: 'select',
      title: 'Select Columns',
      type: 'short-input',
      placeholder: 'Comma-separated columns (e.g., name,telephone1,emailaddress1)',
      condition: { field: 'operation', value: ['list_records', 'get_record'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of Dataverse column logical names based on the user's description.
Use lowercase logical names without spaces.
Common columns by table:
- Accounts: name, accountnumber, telephone1, emailaddress1, address1_city, revenue, industrycode
- Contacts: firstname, lastname, fullname, emailaddress1, telephone1, jobtitle, birthdate
- General: statecode, statuscode, createdon, modifiedon, ownerid, createdby

Return ONLY the comma-separated column names - no explanations.`,
        placeholder: 'Describe which columns you want to retrieve...',
        generationType: 'odata-expression',
      },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      placeholder: "OData filter (e.g., statecode eq 0 and contains(name,'Contoso'))",
      condition: { field: 'operation', value: 'list_records' },
      wandConfig: {
        enabled: true,
        prompt: `Generate an OData $filter expression for the Dataverse Web API based on the user's description.
OData filter syntax:
- Comparison: eq, ne, gt, ge, lt, le (e.g., "revenue gt 1000000")
- Logical: and, or, not (e.g., "statecode eq 0 and revenue gt 1000000")
- String functions: contains(name,'value'), startswith(name,'value'), endswith(name,'value')
- Date functions: year(createdon) eq 2024, month(createdon) eq 1
- Null check: fieldname eq null, fieldname ne null
- Status: statecode eq 0 (active), statecode eq 1 (inactive)

Return ONLY the filter expression - no $filter= prefix, no explanations.`,
        placeholder: 'Describe which records you want to filter for...',
        generationType: 'odata-expression',
      },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'e.g., name asc, createdon desc',
      condition: { field: 'operation', value: 'list_records' },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an OData $orderby expression for sorting Dataverse records based on the user's description.
Format: column_name asc|desc, separated by commas for multi-column sort.
Examples:
- "name asc" - Sort by name alphabetically
- "createdon desc" - Sort by creation date, newest first
- "name asc, createdon desc" - Sort by name, then by date

Return ONLY the orderby expression - no $orderby= prefix, no explanations.`,
        placeholder: 'Describe how you want to sort the results...',
        generationType: 'odata-expression',
      },
    },
    {
      id: 'top',
      title: 'Max Results',
      type: 'short-input',
      placeholder: 'Maximum number of records (default: 5000)',
      condition: { field: 'operation', value: 'list_records' },
      mode: 'advanced',
    },
    {
      id: 'expand',
      title: 'Expand',
      type: 'short-input',
      placeholder: 'Navigation properties to expand (e.g., primarycontactid)',
      condition: { field: 'operation', value: ['list_records', 'get_record'] },
      mode: 'advanced',
      wandConfig: {
        enabled: true,
        prompt: `Generate an OData $expand expression for the Dataverse Web API based on the user's description.
$expand retrieves related records through navigation properties.
Examples:
- "primarycontactid" - Expand the primary contact lookup
- "contact_customer_accounts" - Expand related contacts for an account
- "primarycontactid($select=fullname,emailaddress1)" - Expand with selected columns
- "contact_customer_accounts($select=fullname;$top=5;$orderby=fullname asc)" - Expand with query options

Return ONLY the expand expression - no $expand= prefix, no explanations.`,
        placeholder: 'Describe which related records you want to include...',
        generationType: 'odata-expression',
      },
    },
    {
      id: 'navigationProperty',
      title: 'Navigation Property',
      type: 'short-input',
      placeholder: 'e.g., contact_customer_accounts',
      condition: { field: 'operation', value: ['associate', 'disassociate'] },
      required: { field: 'operation', value: ['associate', 'disassociate'] },
    },
    {
      id: 'navigationType',
      title: 'Navigation Type',
      type: 'dropdown',
      options: [
        { label: 'Collection-valued (default)', id: 'collection' },
        { label: 'Single-valued (lookup)', id: 'single' },
      ],
      value: () => 'collection',
      condition: { field: 'operation', value: 'associate' },
      mode: 'advanced',
    },
    {
      id: 'targetEntitySetName',
      title: 'Target Entity Set',
      type: 'short-input',
      placeholder: 'Target table name (e.g., contacts)',
      condition: { field: 'operation', value: 'associate' },
      required: { field: 'operation', value: 'associate' },
    },
    {
      id: 'targetRecordId',
      title: 'Target Record ID',
      type: 'short-input',
      placeholder: 'Target record GUID',
      condition: { field: 'operation', value: ['associate', 'disassociate'] },
      required: { field: 'operation', value: 'associate' },
    },
  ],
  tools: {
    access: [
      'microsoft_dataverse_associate',
      'microsoft_dataverse_create_record',
      'microsoft_dataverse_delete_record',
      'microsoft_dataverse_disassociate',
      'microsoft_dataverse_get_record',
      'microsoft_dataverse_list_records',
      'microsoft_dataverse_update_record',
      'microsoft_dataverse_upsert_record',
      'microsoft_dataverse_whoami',
    ],
    config: {
      tool: (params) => `microsoft_dataverse_${params.operation}`,
      params: (params) => {
        const { credential, operation, ...rest } = params

        const cleanParams: Record<string, unknown> = {
          credential,
        }

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
    credential: { type: 'string', description: 'Microsoft Dataverse OAuth credential' },
    environmentUrl: { type: 'string', description: 'Dataverse environment URL' },
    entitySetName: { type: 'string', description: 'Entity set name (plural table name)' },
    recordId: { type: 'string', description: 'Record GUID' },
    data: { type: 'json', description: 'Record data as JSON object' },
    select: { type: 'string', description: 'Columns to return (comma-separated)' },
    filter: { type: 'string', description: 'OData $filter expression' },
    orderBy: { type: 'string', description: 'OData $orderby expression' },
    top: { type: 'string', description: 'Maximum number of records' },
    expand: { type: 'string', description: 'Navigation properties to expand' },
    navigationProperty: {
      type: 'string',
      description: 'Navigation property name for associations',
    },
    navigationType: {
      type: 'string',
      description:
        'Navigation property type: "collection" (default) or "single" (for lookup fields)',
    },
    targetEntitySetName: { type: 'string', description: 'Target entity set for association' },
    targetRecordId: { type: 'string', description: 'Target record GUID for association' },
  },
  outputs: {
    records: { type: 'json', description: 'Array of records (list operation)' },
    record: { type: 'json', description: 'Single record data' },
    recordId: { type: 'string', description: 'Record ID' },
    count: { type: 'number', description: 'Number of records returned in the current page' },
    totalCount: {
      type: 'number',
      description: 'Total matching records server-side (requires $count=true)',
    },
    nextLink: { type: 'string', description: 'URL for next page of results' },
    created: { type: 'boolean', description: 'Whether a new record was created (upsert)' },
    userId: { type: 'string', description: 'Authenticated user ID (WhoAmI)' },
    businessUnitId: { type: 'string', description: 'Business unit ID (WhoAmI)' },
    organizationId: { type: 'string', description: 'Organization ID (WhoAmI)' },
    entitySetName: {
      type: 'string',
      description: 'Source entity set name (associate/disassociate)',
    },
    navigationProperty: {
      type: 'string',
      description: 'Navigation property used (associate/disassociate)',
    },
    targetEntitySetName: { type: 'string', description: 'Target entity set name (associate)' },
    targetRecordId: { type: 'string', description: 'Target record GUID (associate/disassociate)' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
