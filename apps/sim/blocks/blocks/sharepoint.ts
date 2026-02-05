import { createLogger } from '@sim/logger'
import { MicrosoftSharepointIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import type { SharepointResponse } from '@/tools/sharepoint/types'

const logger = createLogger('SharepointBlock')

export const SharepointBlock: BlockConfig<SharepointResponse> = {
  type: 'sharepoint',
  name: 'Sharepoint',
  description: 'Work with pages and lists',
  authMode: AuthMode.OAuth,
  longDescription:
    'Integrate SharePoint into the workflow. Read/create pages, list sites, and work with lists (read, create, update items). Requires OAuth.',
  docsLink: 'https://docs.sim.ai/tools/sharepoint',
  category: 'tools',
  bgColor: '#E0E0E0',
  icon: MicrosoftSharepointIcon,
  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        { label: 'Create Page', id: 'create_page' },
        { label: 'Read Page', id: 'read_page' },
        { label: 'List Sites', id: 'list_sites' },
        { label: 'Create List', id: 'create_list' },
        { label: 'Read List', id: 'read_list' },
        { label: 'Update List', id: 'update_list' },
        { label: 'Add List Items', id: 'add_list_items' },
        { label: 'Upload File', id: 'upload_file' },
      ],
    },
    {
      id: 'credential',
      title: 'Microsoft Account',
      type: 'oauth-input',
      serviceId: 'sharepoint',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'Sites.Read.All',
        'Sites.ReadWrite.All',
        'Sites.Manage.All',
        'offline_access',
      ],
      placeholder: 'Select Microsoft account',
    },

    {
      id: 'siteSelector',
      title: 'Select Site',
      type: 'file-selector',
      canonicalParamId: 'siteId',
      serviceId: 'sharepoint',
      requiredScopes: [
        'openid',
        'profile',
        'email',
        'Files.Read',
        'Files.ReadWrite',
        'offline_access',
      ],
      mimeType: 'application/vnd.microsoft.graph.folder',
      placeholder: 'Select a site',
      dependsOn: ['credential'],
      mode: 'basic',
      condition: {
        field: 'operation',
        value: [
          'create_page',
          'read_page',
          'list_sites',
          'create_list',
          'read_list',
          'update_list',
          'add_list_items',
          'upload_file',
        ],
      },
    },

    {
      id: 'pageName',
      title: 'Page Name',
      type: 'short-input',
      placeholder: 'Name of the page',
      condition: { field: 'operation', value: ['create_page', 'read_page'] },
    },

    {
      id: 'pageId',
      title: 'Page ID',
      type: 'short-input',
      placeholder: 'Page ID (alternative to page name)',
      condition: { field: 'operation', value: 'read_page' },
      mode: 'advanced',
    },

    {
      id: 'listId',
      title: 'List ID',
      type: 'short-input',
      placeholder: 'Enter list ID (GUID). Required for Update; optional for Read.',
      canonicalParamId: 'listId',
      condition: { field: 'operation', value: ['read_list', 'update_list', 'add_list_items'] },
    },

    {
      id: 'listItemId',
      title: 'Item ID',
      type: 'short-input',
      placeholder: 'Enter item ID',
      canonicalParamId: 'itemId',
      condition: { field: 'operation', value: ['update_list'] },
    },

    {
      id: 'listDisplayName',
      title: 'List Display Name',
      type: 'short-input',
      placeholder: 'Name of the list',
      condition: { field: 'operation', value: 'create_list' },
    },

    {
      id: 'listTemplate',
      title: 'List Template',
      type: 'short-input',
      placeholder: "Template (e.g., 'genericList')",
      condition: { field: 'operation', value: 'create_list' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a SharePoint list template name based on the user's description.

### AVAILABLE TEMPLATES
- genericList - Standard list for general data (default)
- documentLibrary - For storing and managing documents
- survey - For creating surveys and polls
- links - For storing hyperlinks
- announcements - For news and announcements
- contacts - For contact information (name, email, phone)
- events - For calendar events and scheduling
- tasks - For task tracking and project management
- discussionBoard - For team discussions and forums
- pictureLibrary - For storing images and photos
- issue - For issue/bug tracking

### EXAMPLES
- "I want to track tasks" -> tasks
- "store documents" -> documentLibrary
- "team announcements" -> announcements
- "contact list" -> contacts
- "calendar events" -> events
- "general data" -> genericList
- "bug tracking" -> issue
- "photo gallery" -> pictureLibrary

Return ONLY the template name - no explanations, no quotes, no extra text.`,
        placeholder: 'Describe what kind of list you need...',
      },
    },

    {
      id: 'columnDefinitions',
      title: 'Column Definitions',
      type: 'long-input',
      placeholder: 'Optional: Define custom columns as JSON array',
      condition: { field: 'operation', value: ['create_list'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON array of SharePoint list column definitions based on the user's description.

### FORMAT
A JSON array of column definition objects. Each column needs at minimum a "name" and column type properties.

### COLUMN TYPES AND PROPERTIES

**Text Column:**
{"name": "ColumnName", "text": {}}
- For single line of text

**Multi-line Text:**
{"name": "ColumnName", "text": {"allowMultipleLines": true}}

**Number Column:**
{"name": "ColumnName", "number": {}}
- Optional: "minimum", "maximum", "decimalPlaces"

**DateTime Column:**
{"name": "ColumnName", "dateTime": {"format": "dateOnly"}}
- format: "dateOnly" or "dateTime"

**Boolean (Yes/No):**
{"name": "ColumnName", "boolean": {}}

**Choice Column:**
{"name": "ColumnName", "choice": {"choices": ["Option1", "Option2", "Option3"]}}

**Person Column:**
{"name": "ColumnName", "personOrGroup": {}}

**Currency:**
{"name": "ColumnName", "currency": {"locale": "en-US"}}

### EXAMPLES

"add columns for status (choice: Active, Completed, On Hold), due date, and priority number"
-> [
  {"name": "Status", "choice": {"choices": ["Active", "Completed", "On Hold"]}},
  {"name": "DueDate", "dateTime": {"format": "dateOnly"}},
  {"name": "Priority", "number": {"minimum": 1, "maximum": 5}}
]

"text column for description, yes/no for completed, date for start"
-> [
  {"name": "Description", "text": {"allowMultipleLines": true}},
  {"name": "Completed", "boolean": {}},
  {"name": "StartDate", "dateTime": {"format": "dateOnly"}}
]

"assignee (person), budget (currency), category (choice: Marketing, Sales, Engineering)"
-> [
  {"name": "Assignee", "personOrGroup": {}},
  {"name": "Budget", "currency": {"locale": "en-US"}},
  {"name": "Category", "choice": {"choices": ["Marketing", "Sales", "Engineering"]}}
]

Return ONLY the JSON array - no explanations, no markdown, no extra text.`,
        placeholder:
          'Describe the columns you want to add (e.g., "status dropdown, due date, priority number")...',
        generationType: 'json-object',
      },
    },
    {
      id: 'listDescription',
      title: 'List Description',
      type: 'long-input',
      placeholder: 'Optional description',
      condition: { field: 'operation', value: 'create_list' },
    },

    {
      id: 'manualSiteId',
      title: 'Site ID',
      type: 'short-input',
      canonicalParamId: 'siteId',
      placeholder: 'Enter site ID (leave empty for root site)',
      dependsOn: ['credential'],
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'create_page',
          'read_page',
          'list_sites',
          'create_list',
          'read_list',
          'update_list',
          'add_list_items',
          'upload_file',
        ],
      },
    },

    {
      id: 'listItemFields',
      title: 'List Item Fields',
      type: 'long-input',
      placeholder:
        'Enter list item fields as JSON (e.g., {"Title": "My Item", "Status": "Active"})',
      canonicalParamId: 'listItemFields',
      condition: { field: 'operation', value: ['update_list', 'add_list_items'] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object for SharePoint list item fields based on the user's description.

### FORMAT
A JSON object where keys are column internal names and values are the data to set.

### RULES
- Use the column's internal name (often same as display name, but spaces become _x0020_)
- Common field names: Title, Status, Description, Priority, DueDate, AssignedTo, Category
- Date fields should use ISO 8601 format: "2024-01-15" or "2024-01-15T10:30:00Z"
- Number fields should be numeric, not strings
- Boolean fields use true/false
- Choice fields use the exact choice value as a string
- Person fields use the person's email or ID

### READ-ONLY FIELDS (automatically filtered out)
Id, UniqueId, GUID, Created, Modified, Author, Editor, ContentTypeId

### EXAMPLES

"set title to Project Alpha and status to In Progress"
-> {"Title": "Project Alpha", "Status": "In Progress"}

"update priority to high and due date to next Friday"
-> {"Priority": "High", "DueDate": "2024-01-19"}

"add task with title Review Document, assigned to john@company.com"
-> {"Title": "Review Document", "AssignedToLookupId": "john@company.com"}

"create contact with name John Smith, email john@example.com, phone 555-1234"
-> {"Title": "John Smith", "Email": "john@example.com", "WorkPhone": "555-1234"}

"set completed to true and notes to Task finished successfully"
-> {"Completed": true, "Notes": "Task finished successfully"}

Return ONLY the JSON object - no explanations, no markdown, no extra text.`,
        placeholder: 'Describe the fields and values you want to set...',
        generationType: 'json-object',
      },
    },

    // Upload File operation fields
    {
      id: 'driveId',
      title: 'Document Library ID',
      type: 'short-input',
      placeholder: 'Enter document library (drive) ID',
      canonicalParamId: 'driveId',
      condition: { field: 'operation', value: 'upload_file' },
      mode: 'advanced',
    },
    {
      id: 'folderPath',
      title: 'Folder Path',
      type: 'short-input',
      placeholder: 'Optional folder path (e.g., /Documents/Subfolder)',
      condition: { field: 'operation', value: 'upload_file' },
      required: false,
    },
    {
      id: 'fileName',
      title: 'File Name',
      type: 'short-input',
      placeholder: 'Optional: override uploaded file name',
      condition: { field: 'operation', value: 'upload_file' },
      mode: 'advanced',
      required: false,
    },
    // File upload (basic mode)
    {
      id: 'uploadFiles',
      title: 'Files',
      type: 'file-upload',
      canonicalParamId: 'files',
      placeholder: 'Upload files to SharePoint',
      condition: { field: 'operation', value: 'upload_file' },
      mode: 'basic',
      multiple: true,
      required: false,
    },
    // Variable reference (advanced mode)
    {
      id: 'files',
      title: 'Files',
      type: 'short-input',
      canonicalParamId: 'files',
      placeholder: 'Reference files from previous blocks',
      condition: { field: 'operation', value: 'upload_file' },
      mode: 'advanced',
      required: false,
    },
  ],
  tools: {
    access: [
      'sharepoint_create_page',
      'sharepoint_read_page',
      'sharepoint_list_sites',
      'sharepoint_create_list',
      'sharepoint_get_list',
      'sharepoint_update_list',
      'sharepoint_add_list_items',
      'sharepoint_upload_file',
    ],
    config: {
      tool: (params) => {
        switch (params.operation) {
          case 'create_page':
            return 'sharepoint_create_page'
          case 'read_page':
            return 'sharepoint_read_page'
          case 'list_sites':
            return 'sharepoint_list_sites'
          case 'create_list':
            return 'sharepoint_create_list'
          case 'read_list':
            return 'sharepoint_get_list'
          case 'update_list':
            return 'sharepoint_update_list'
          case 'add_list_items':
            return 'sharepoint_add_list_items'
          case 'upload_file':
            return 'sharepoint_upload_file'
          default:
            throw new Error(`Invalid Sharepoint operation: ${params.operation}`)
        }
      },
      params: (params) => {
        const { credential, siteId, mimeType, ...rest } = params

        // siteId is the canonical param from siteSelector (basic) or manualSiteId (advanced)
        const effectiveSiteId = siteId ? String(siteId).trim() : ''

        const {
          itemId, // canonical param from listItemId
          listItemFields, // canonical param
          includeColumns,
          includeItems,
          files, // canonical param from uploadFiles (basic) or files (advanced)
          columnDefinitions,
          ...others
        } = rest as any

        let parsedItemFields: any = listItemFields
        if (typeof listItemFields === 'string' && listItemFields.trim()) {
          try {
            parsedItemFields = JSON.parse(listItemFields)
          } catch (error) {
            logger.error('Failed to parse listItemFields JSON', {
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
        if (typeof parsedItemFields !== 'object' || parsedItemFields === null) {
          parsedItemFields = undefined
        }

        // itemId is the canonical param from listItemId
        const sanitizedItemId =
          itemId === undefined || itemId === null ? undefined : String(itemId).trim() || undefined

        const coerceBoolean = (value: any) => {
          if (typeof value === 'boolean') return value
          if (typeof value === 'string') return value.toLowerCase() === 'true'
          return undefined
        }

        if (others.operation === 'update_list' || others.operation === 'add_list_items') {
          try {
            logger.info('SharepointBlock list item param check', {
              siteId: effectiveSiteId || undefined,
              listId: (others as any)?.listId,
              listTitle: (others as any)?.listTitle,
              itemId: sanitizedItemId,
              hasItemFields: !!parsedItemFields && typeof parsedItemFields === 'object',
              itemFieldKeys:
                parsedItemFields && typeof parsedItemFields === 'object'
                  ? Object.keys(parsedItemFields)
                  : [],
            })
          } catch {}
        }

        // Handle file upload files parameter using canonical param
        const normalizedFiles = normalizeFileInput(files)
        const baseParams: Record<string, any> = {
          credential,
          siteId: effectiveSiteId || undefined,
          pageSize: others.pageSize ? Number.parseInt(others.pageSize as string, 10) : undefined,
          mimeType: mimeType,
          ...others,
          itemId: sanitizedItemId,
          listItemFields: parsedItemFields,
          includeColumns: coerceBoolean(includeColumns),
          includeItems: coerceBoolean(includeItems),
        }

        // Add files if provided
        if (normalizedFiles) {
          baseParams.files = normalizedFiles
        }

        if (columnDefinitions) {
          baseParams.pageContent = columnDefinitions
        }

        return baseParams
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    credential: { type: 'string', description: 'Microsoft account credential' },
    pageName: { type: 'string', description: 'Page name' },
    columnDefinitions: {
      type: 'string',
      description: 'Column definitions for list creation (JSON array)',
    },
    pageTitle: { type: 'string', description: 'Page title' },
    pageId: { type: 'string', description: 'Page ID' },
    siteId: { type: 'string', description: 'Site ID' },
    pageSize: { type: 'number', description: 'Results per page' },
    listDisplayName: { type: 'string', description: 'List display name' },
    listDescription: { type: 'string', description: 'List description' },
    listTemplate: { type: 'string', description: 'List template' },
    listId: { type: 'string', description: 'List ID' },
    listTitle: { type: 'string', description: 'List title' },
    includeColumns: { type: 'boolean', description: 'Include columns in response' },
    includeItems: { type: 'boolean', description: 'Include items in response' },
    itemId: { type: 'string', description: 'List item ID (canonical param)' },
    listItemFields: { type: 'string', description: 'List item fields (canonical param)' },
    driveId: { type: 'string', description: 'Document library (drive) ID (canonical param)' },
    folderPath: { type: 'string', description: 'Folder path for file upload' },
    fileName: { type: 'string', description: 'File name override' },
    files: { type: 'array', description: 'Files to upload (canonical param)' },
  },
  outputs: {
    sites: {
      type: 'json',
      description:
        'An array of SharePoint site objects, each containing details such as id, name, and more.',
    },
    list: {
      type: 'json',
      description: 'SharePoint list object (id, displayName, name, webUrl, etc.)',
    },
    item: {
      type: 'json',
      description: 'SharePoint list item with fields',
    },
    items: {
      type: 'json',
      description: 'Array of SharePoint list items with fields',
    },
    uploadedFiles: {
      type: 'json',
      description: 'Array of uploaded file objects with id, name, webUrl, size',
    },
    fileCount: {
      type: 'number',
      description: 'Number of files uploaded',
    },
    success: {
      type: 'boolean',
      description: 'Success status',
    },
    error: {
      type: 'string',
      description: 'Error message',
    },
  },
}
