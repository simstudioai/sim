import { MicrosoftDataverseIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { DataverseResponse } from '@/tools/microsoft_dataverse/types'

export const MicrosoftDataverseBlock: BlockConfig<DataverseResponse> = {
  type: 'microsoft_dataverse',
  name: 'Microsoft Dataverse',
  description: 'Manage records in Microsoft Dataverse tables',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate Microsoft Dataverse into your workflow. Create, read, update, delete, upsert, associate, query, search, and execute actions and functions against Dataverse tables using the Web API. Supports bulk operations, FetchXML, file uploads, and relevance search. Works with Dynamics 365, Power Platform, and custom Dataverse environments.',
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
        { label: 'Create Multiple', id: 'create_multiple' },
        { label: 'Update Multiple', id: 'update_multiple' },
        { label: 'FetchXML Query', id: 'fetchxml_query' },
        { label: 'Search', id: 'search' },
        { label: 'Execute Action', id: 'execute_action' },
        { label: 'Execute Function', id: 'execute_function' },
        { label: 'Upload File', id: 'upload_file' },
        { label: 'Download File', id: 'download_file' },
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
        value: ['whoami', 'search'],
        not: true,
      },
      required: {
        field: 'operation',
        value: ['whoami', 'search', 'execute_action', 'execute_function'],
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
          'upload_file',
          'download_file',
          'execute_action',
          'execute_function',
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
          'upload_file',
          'download_file',
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
    // FetchXML Query
    {
      id: 'fetchXml',
      title: 'FetchXML',
      type: 'long-input',
      placeholder:
        '<fetch top="50"><entity name="account"><attribute name="name"/><filter><condition attribute="statecode" operator="eq" value="0"/></filter></entity></fetch>',
      condition: { field: 'operation', value: 'fetchxml_query' },
      required: { field: 'operation', value: 'fetchxml_query' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a FetchXML query for the Microsoft Dataverse Web API based on the user's description.
FetchXML structure:
- Root: <fetch top="N" aggregate="true|false" distinct="true|false">
- Entity: <entity name="logical_name"> (singular table name, e.g., "account")
- Attributes: <attribute name="column"/> or <all-attributes/>
- Filter: <filter type="and|or"><condition attribute="name" operator="eq" value="val"/></filter>
- Order: <order attribute="name" descending="true|false"/>
- Link-entity: <link-entity name="contact" from="parentcustomerid" to="accountid" alias="c">
- Aggregation: <attribute name="revenue" aggregate="sum" alias="total"/>

Operators: eq, ne, gt, ge, lt, le, like, not-like, in, not-in, null, not-null, between, not-between, contains, not-contain

Return ONLY valid FetchXML - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the query you want to run...',
        generationType: 'json-object',
      },
    },
    // Search
    {
      id: 'searchTerm',
      title: 'Search Term',
      type: 'short-input',
      placeholder: 'Search text (e.g., Contoso)',
      condition: { field: 'operation', value: 'search' },
      required: { field: 'operation', value: 'search' },
    },
    {
      id: 'searchEntities',
      title: 'Search Entities',
      type: 'long-input',
      placeholder:
        'JSON array of entity configs (e.g., [{"Name":"account","SelectColumns":["name"],"SearchColumns":["name"]}])',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'searchMode',
      title: 'Search Mode',
      type: 'dropdown',
      options: [
        { label: 'Any (match any term)', id: 'any' },
        { label: 'All (match all terms)', id: 'all' },
      ],
      value: () => 'any',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    {
      id: 'searchType',
      title: 'Query Type',
      type: 'dropdown',
      options: [
        { label: 'Simple (default)', id: 'simple' },
        { label: 'Lucene (regex, fuzzy, proximity)', id: 'lucene' },
      ],
      value: () => 'simple',
      condition: { field: 'operation', value: 'search' },
      mode: 'advanced',
    },
    // Execute Action
    {
      id: 'actionName',
      title: 'Action Name',
      type: 'short-input',
      placeholder: 'e.g., Merge, GrantAccess, SendEmail',
      condition: { field: 'operation', value: 'execute_action' },
      required: { field: 'operation', value: 'execute_action' },
    },
    // Execute Function
    {
      id: 'functionName',
      title: 'Function Name',
      type: 'short-input',
      placeholder: 'e.g., RetrievePrincipalAccess, RetrieveTotalRecordCount',
      condition: { field: 'operation', value: 'execute_function' },
      required: { field: 'operation', value: 'execute_function' },
    },
    {
      id: 'functionParameters',
      title: 'Function Parameters',
      type: 'short-input',
      placeholder: "e.g., LocalizedStandardName='Pacific Standard Time',LocaleId=1033",
      condition: { field: 'operation', value: 'execute_function' },
      mode: 'advanced',
    },
    // Action/Function parameters (shared JSON body for actions)
    {
      id: 'parameters',
      title: 'Action Parameters',
      type: 'long-input',
      placeholder:
        'JSON object with action parameters (e.g., {"Target": {"@odata.type": "Microsoft.Dynamics.CRM.account", "accountid": "..."}})',
      condition: { field: 'operation', value: 'execute_action' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object containing parameters for a Microsoft Dataverse action based on the user's description.
For entity references, include @odata.type annotations:
- {"Target": {"@odata.type": "Microsoft.Dynamics.CRM.account", "accountid": "guid"}}
- {"EntityMoniker": {"@odata.type": "Microsoft.Dynamics.CRM.contact", "contactid": "guid"}}
For simple values, just use the parameter name and value.

Return ONLY valid JSON - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the action parameters...',
        generationType: 'json-object',
      },
    },
    // Bulk operations
    {
      id: 'entityLogicalName',
      title: 'Table Logical Name',
      type: 'short-input',
      placeholder: 'Singular table name (e.g., account, contact)',
      condition: { field: 'operation', value: ['create_multiple', 'update_multiple'] },
      required: { field: 'operation', value: ['create_multiple', 'update_multiple'] },
    },
    {
      id: 'records',
      title: 'Records',
      type: 'long-input',
      placeholder: 'JSON array of records (e.g., [{"name": "Contoso"}, {"name": "Fabrikam"}])',
      condition: { field: 'operation', value: ['create_multiple', 'update_multiple'] },
      required: { field: 'operation', value: ['create_multiple', 'update_multiple'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of Dataverse records based on the user's description.
Each record should be an object with column logical names as keys.
For UpdateMultiple, each record must include its primary key (e.g., accountid).
Common column naming conventions:
- Text: "name", "description", "emailaddress1", "telephone1"
- Choice/OptionSet: integer values (e.g., "statecode": 0)
- Date: ISO 8601 format (e.g., "2024-01-15T00:00:00Z")

Return ONLY a valid JSON array - no explanations, no markdown code blocks.`,
        placeholder: 'Describe the records you want to create or update...',
        generationType: 'json-object',
      },
    },
    // File operations
    {
      id: 'fileColumn',
      title: 'File Column',
      type: 'short-input',
      placeholder: 'File column logical name (e.g., entityimage, cr_document)',
      condition: { field: 'operation', value: ['upload_file', 'download_file'] },
      required: { field: 'operation', value: ['upload_file', 'download_file'] },
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'e.g., document.pdf',
      condition: { field: 'operation', value: 'upload_file' },
      required: { field: 'operation', value: 'upload_file' },
    },
    {
      id: 'uploadFile',
      title: 'File',
      type: 'file-upload',
      canonicalParamId: 'file',
      placeholder: 'Upload a file',
      condition: { field: 'operation', value: 'upload_file' },
      mode: 'basic',
      multiple: false,
      required: { field: 'operation', value: 'upload_file' },
    },
    {
      id: 'fileReference',
      title: 'File',
      type: 'short-input',
      canonicalParamId: 'file',
      placeholder: 'Reference a file from previous blocks (e.g., {{block_1.output.file}})',
      condition: { field: 'operation', value: 'upload_file' },
      mode: 'advanced',
      required: { field: 'operation', value: 'upload_file' },
    },
    // OData query options (list_records)
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
      condition: { field: 'operation', value: ['list_records', 'search'] },
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
      condition: { field: 'operation', value: ['list_records', 'search'] },
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
      condition: { field: 'operation', value: ['list_records', 'search'] },
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
    // Associate/Disassociate
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
      'microsoft_dataverse_create_multiple',
      'microsoft_dataverse_create_record',
      'microsoft_dataverse_delete_record',
      'microsoft_dataverse_disassociate',
      'microsoft_dataverse_download_file',
      'microsoft_dataverse_execute_action',
      'microsoft_dataverse_execute_function',
      'microsoft_dataverse_fetchxml_query',
      'microsoft_dataverse_get_record',
      'microsoft_dataverse_list_records',
      'microsoft_dataverse_search',
      'microsoft_dataverse_update_multiple',
      'microsoft_dataverse_update_record',
      'microsoft_dataverse_upload_file',
      'microsoft_dataverse_upsert_record',
      'microsoft_dataverse_whoami',
    ],
    config: {
      tool: (params) => `microsoft_dataverse_${params.operation}`,
      params: (params) => {
        const { credential, operation, file, ...rest } = params

        const cleanParams: Record<string, unknown> = {
          credential,
        }

        // Normalize file input from basic (uploadFile) or advanced (fileReference) mode
        const normalizedFile = normalizeFileInput(file, { single: true })
        if (normalizedFile) {
          cleanParams.file = normalizedFile
        }

        // Map block subBlock IDs to tool param names where they differ
        if (rest.searchEntities) {
          cleanParams.entities = rest.searchEntities
          rest.searchEntities = undefined
        }
        if (rest.functionParameters) {
          cleanParams.parameters = rest.functionParameters
          rest.functionParameters = undefined
          // Prevent stale action parameters from overwriting mapped function parameters
          rest.parameters = undefined
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
    fetchXml: { type: 'string', description: 'FetchXML query string' },
    searchTerm: { type: 'string', description: 'Search text for relevance search' },
    searchEntities: { type: 'string', description: 'JSON array of search entity configurations' },
    searchMode: { type: 'string', description: 'Search mode: "any" or "all"' },
    searchType: { type: 'string', description: 'Query type: "simple" or "lucene"' },
    actionName: { type: 'string', description: 'Dataverse action name to execute' },
    functionName: { type: 'string', description: 'Dataverse function name to execute' },
    functionParameters: {
      type: 'string',
      description: 'Function parameters as URL-encoded string',
    },
    parameters: { type: 'json', description: 'Action parameters as JSON object' },
    entityLogicalName: { type: 'string', description: 'Table logical name for @odata.type' },
    records: { type: 'json', description: 'Array of record objects for bulk operations' },
    fileColumn: { type: 'string', description: 'File or image column logical name' },
    fileName: { type: 'string', description: 'Name of the file to upload' },
    file: { type: 'json', description: 'File to upload (canonical param)' },
  },
  outputs: {
    records: { type: 'json', description: 'Array of records (list/fetchxml/search)' },
    record: { type: 'json', description: 'Single record data' },
    recordId: { type: 'string', description: 'Record ID' },
    count: { type: 'number', description: 'Number of records returned in the current page' },
    totalCount: {
      type: 'number',
      description: 'Total matching records server-side',
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
    result: { type: 'json', description: 'Action/function result data' },
    ids: { type: 'json', description: 'Array of created record IDs (create multiple)' },
    fetchXmlPagingCookie: { type: 'string', description: 'Paging cookie for FetchXML pagination' },
    moreRecords: { type: 'boolean', description: 'Whether more records are available (FetchXML)' },
    results: { type: 'json', description: 'Search results array' },
    facets: { type: 'json', description: 'Facet results for search (when facets requested)' },
    fileContent: { type: 'string', description: 'Base64-encoded downloaded file content' },
    fileName: { type: 'string', description: 'Downloaded file name' },
    fileSize: { type: 'number', description: 'File size in bytes' },
    mimeType: { type: 'string', description: 'File MIME type' },
    fileColumn: { type: 'string', description: 'File column name' },
  },
}
