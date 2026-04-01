import { RipplingIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

/** Operations that support the filter query parameter */
const FILTER_OPS = ['list_workers', 'list_business_partners', 'list_supergroups'] as const

/** Operations that support the expand query parameter */
const EXPAND_OPS = [
  'list_workers',
  'list_business_partners',
  'list_business_partner_groups',
  'list_companies',
  'list_departments',
  'list_teams',
  'list_supergroup_members',
  'list_supergroup_inclusion_members',
  'list_supergroup_exclusion_members',
  'get_worker',
  'get_business_partner',
  'get_business_partner_group',
  'get_current_user',
  'get_department',
  'get_team',
] as const

/** Operations that support the order_by query parameter */
const ORDER_BY_OPS = [
  'list_workers',
  'list_business_partners',
  'list_business_partner_groups',
  'list_companies',
  'list_custom_fields',
  'list_custom_settings',
  'list_departments',
  'list_employment_types',
  'list_job_functions',
  'list_supergroups',
  'list_teams',
  'list_titles',
  'list_users',
  'list_work_locations',
  'list_supergroup_members',
  'list_supergroup_inclusion_members',
  'list_supergroup_exclusion_members',
] as const

/** Operations that support cursor pagination */
const CURSOR_OPS = [
  'list_workers',
  'list_business_partners',
  'list_business_partner_groups',
  'list_companies',
  'list_custom_fields',
  'list_custom_settings',
  'list_departments',
  'list_employment_types',
  'list_job_functions',
  'list_teams',
  'list_titles',
  'list_users',
  'list_work_locations',
  'query_custom_object_records',
] as const

/** Operations that require a resource ID */
const ID_OPS = [
  'get_worker',
  'get_user',
  'get_department',
  'update_department',
  'get_team',
  'get_employment_type',
  'get_title',
  'update_title',
  'delete_title',
  'get_job_function',
  'get_work_location',
  'update_work_location',
  'delete_work_location',
  'get_business_partner',
  'delete_business_partner',
  'get_business_partner_group',
  'delete_business_partner_group',
  'get_supergroup',
  'list_supergroup_members',
  'list_supergroup_inclusion_members',
  'list_supergroup_exclusion_members',
  'update_supergroup_inclusion_members',
  'update_supergroup_exclusion_members',
  'get_custom_object',
  'update_custom_object',
  'delete_custom_object',
  'get_custom_object_field',
  'update_custom_object_field',
  'delete_custom_object_field',
  'get_custom_object_record',
  'update_custom_object_record',
  'delete_custom_object_record',
  'get_custom_app',
  'update_custom_app',
  'delete_custom_app',
  'get_custom_page',
  'update_custom_page',
  'delete_custom_page',
  'get_custom_setting',
  'update_custom_setting',
  'delete_custom_setting',
  'get_object_category',
  'update_object_category',
  'delete_object_category',
  'get_report_run',
  'trigger_report_run',
] as const

/** Operations that accept a name field */
const NAME_OPS = [
  'create_department',
  'update_department',
  'create_title',
  'update_title',
  'create_work_location',
  'update_work_location',
  'create_business_partner_group',
  'create_custom_object',
  'update_custom_object',
  'create_custom_object_field',
  'update_custom_object_field',
  'create_custom_app',
  'update_custom_app',
  'create_custom_page',
  'update_custom_page',
  'create_object_category',
  'update_object_category',
] as const

/** Operations that require customObjectId */
const CUSTOM_OBJECT_ID_OPS = [
  'list_custom_object_fields',
  'get_custom_object_field',
  'create_custom_object_field',
  'update_custom_object_field',
  'delete_custom_object_field',
  'list_custom_object_records',
  'get_custom_object_record',
  'get_custom_object_record_by_external_id',
  'query_custom_object_records',
  'create_custom_object_record',
  'update_custom_object_record',
  'delete_custom_object_record',
  'bulk_create_custom_object_records',
  'bulk_update_custom_object_records',
  'bulk_delete_custom_object_records',
] as const

/** Operations that accept a JSON data body */
const DATA_OPS = [
  'create_department',
  'update_department',
  'create_title',
  'update_title',
  'create_work_location',
  'update_work_location',
  'create_business_partner',
  'create_business_partner_group',
  'create_custom_object',
  'update_custom_object',
  'create_custom_object_field',
  'update_custom_object_field',
  'create_custom_object_record',
  'update_custom_object_record',
  'create_custom_app',
  'update_custom_app',
  'create_custom_setting',
  'update_custom_setting',
  'create_object_category',
  'update_object_category',
  'update_supergroup_inclusion_members',
  'update_supergroup_exclusion_members',
  'create_draft_hires',
] as const

export const RipplingBlock: BlockConfig = {
  type: 'rippling',
  name: 'Rippling',
  description: 'Manage workers, departments, custom objects, and company data in Rippling',
  longDescription:
    'Integrate Rippling Platform into your workflow. Manage workers, users, departments, teams, titles, work locations, business partners, supergroups, custom objects, custom apps, custom pages, custom settings, object categories, reports, and draft hires.',
  docsLink: 'https://docs.sim.ai/tools/rippling',
  category: 'tools',
  integrationType: IntegrationType.HR,
  tags: ['hiring'],
  bgColor: '#FFCC1C',
  icon: RipplingIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Workers
        { label: 'List Workers', id: 'list_workers' },
        { label: 'Get Worker', id: 'get_worker' },
        // Users
        { label: 'List Users', id: 'list_users' },
        { label: 'Get User', id: 'get_user' },
        // Companies
        { label: 'List Companies', id: 'list_companies' },
        // Current User
        { label: 'Get Current User', id: 'get_current_user' },
        // Entitlements
        { label: 'List Entitlements', id: 'list_entitlements' },
        // Departments
        { label: 'List Departments', id: 'list_departments' },
        { label: 'Get Department', id: 'get_department' },
        { label: 'Create Department', id: 'create_department' },
        { label: 'Update Department', id: 'update_department' },
        // Teams
        { label: 'List Teams', id: 'list_teams' },
        { label: 'Get Team', id: 'get_team' },
        // Employment Types
        { label: 'List Employment Types', id: 'list_employment_types' },
        { label: 'Get Employment Type', id: 'get_employment_type' },
        // Titles
        { label: 'List Titles', id: 'list_titles' },
        { label: 'Get Title', id: 'get_title' },
        { label: 'Create Title', id: 'create_title' },
        { label: 'Update Title', id: 'update_title' },
        { label: 'Delete Title', id: 'delete_title' },
        // Custom Fields
        { label: 'List Custom Fields', id: 'list_custom_fields' },
        // Job Functions
        { label: 'List Job Functions', id: 'list_job_functions' },
        { label: 'Get Job Function', id: 'get_job_function' },
        // Work Locations
        { label: 'List Work Locations', id: 'list_work_locations' },
        { label: 'Get Work Location', id: 'get_work_location' },
        { label: 'Create Work Location', id: 'create_work_location' },
        { label: 'Update Work Location', id: 'update_work_location' },
        { label: 'Delete Work Location', id: 'delete_work_location' },
        // Business Partners
        { label: 'List Business Partners', id: 'list_business_partners' },
        { label: 'Get Business Partner', id: 'get_business_partner' },
        { label: 'Create Business Partner', id: 'create_business_partner' },
        { label: 'Delete Business Partner', id: 'delete_business_partner' },
        // Business Partner Groups
        { label: 'List Business Partner Groups', id: 'list_business_partner_groups' },
        { label: 'Get Business Partner Group', id: 'get_business_partner_group' },
        { label: 'Create Business Partner Group', id: 'create_business_partner_group' },
        { label: 'Delete Business Partner Group', id: 'delete_business_partner_group' },
        // Supergroups
        { label: 'List Supergroups', id: 'list_supergroups' },
        { label: 'Get Supergroup', id: 'get_supergroup' },
        { label: 'List Supergroup Members', id: 'list_supergroup_members' },
        { label: 'List Supergroup Inclusion Members', id: 'list_supergroup_inclusion_members' },
        { label: 'List Supergroup Exclusion Members', id: 'list_supergroup_exclusion_members' },
        { label: 'Update Supergroup Inclusion Members', id: 'update_supergroup_inclusion_members' },
        { label: 'Update Supergroup Exclusion Members', id: 'update_supergroup_exclusion_members' },
        // Custom Objects
        { label: 'List Custom Objects', id: 'list_custom_objects' },
        { label: 'Get Custom Object', id: 'get_custom_object' },
        { label: 'Create Custom Object', id: 'create_custom_object' },
        { label: 'Update Custom Object', id: 'update_custom_object' },
        { label: 'Delete Custom Object', id: 'delete_custom_object' },
        // Custom Object Fields
        { label: 'List Custom Object Fields', id: 'list_custom_object_fields' },
        { label: 'Get Custom Object Field', id: 'get_custom_object_field' },
        { label: 'Create Custom Object Field', id: 'create_custom_object_field' },
        { label: 'Update Custom Object Field', id: 'update_custom_object_field' },
        { label: 'Delete Custom Object Field', id: 'delete_custom_object_field' },
        // Custom Object Records
        { label: 'List Custom Object Records', id: 'list_custom_object_records' },
        { label: 'Get Custom Object Record', id: 'get_custom_object_record' },
        {
          label: 'Get Custom Object Record by External ID',
          id: 'get_custom_object_record_by_external_id',
        },
        { label: 'Query Custom Object Records', id: 'query_custom_object_records' },
        { label: 'Create Custom Object Record', id: 'create_custom_object_record' },
        { label: 'Update Custom Object Record', id: 'update_custom_object_record' },
        { label: 'Delete Custom Object Record', id: 'delete_custom_object_record' },
        { label: 'Bulk Create Custom Object Records', id: 'bulk_create_custom_object_records' },
        { label: 'Bulk Update Custom Object Records', id: 'bulk_update_custom_object_records' },
        { label: 'Bulk Delete Custom Object Records', id: 'bulk_delete_custom_object_records' },
        // Custom Apps
        { label: 'List Custom Apps', id: 'list_custom_apps' },
        { label: 'Get Custom App', id: 'get_custom_app' },
        { label: 'Create Custom App', id: 'create_custom_app' },
        { label: 'Update Custom App', id: 'update_custom_app' },
        { label: 'Delete Custom App', id: 'delete_custom_app' },
        // Custom Pages
        { label: 'List Custom Pages', id: 'list_custom_pages' },
        { label: 'Get Custom Page', id: 'get_custom_page' },
        { label: 'Create Custom Page', id: 'create_custom_page' },
        { label: 'Update Custom Page', id: 'update_custom_page' },
        { label: 'Delete Custom Page', id: 'delete_custom_page' },
        // Custom Settings
        { label: 'List Custom Settings', id: 'list_custom_settings' },
        { label: 'Get Custom Setting', id: 'get_custom_setting' },
        { label: 'Create Custom Setting', id: 'create_custom_setting' },
        { label: 'Update Custom Setting', id: 'update_custom_setting' },
        { label: 'Delete Custom Setting', id: 'delete_custom_setting' },
        // Object Categories
        { label: 'List Object Categories', id: 'list_object_categories' },
        { label: 'Get Object Category', id: 'get_object_category' },
        { label: 'Create Object Category', id: 'create_object_category' },
        { label: 'Update Object Category', id: 'update_object_category' },
        { label: 'Delete Object Category', id: 'delete_object_category' },
        // Report Runs
        { label: 'Get Report Run', id: 'get_report_run' },
        { label: 'Trigger Report Run', id: 'trigger_report_run' },
        // Draft Hires
        { label: 'Create Draft Hires', id: 'create_draft_hires' },
      ],
      value: () => 'list_workers',
    },
    {
      id: 'id',
      title: 'Resource ID',
      type: 'short-input',
      placeholder: 'Enter the resource ID',
      condition: { field: 'operation', value: [...ID_OPS] },
      required: { field: 'operation', value: [...ID_OPS] },
    },
    {
      id: 'customObjectId',
      title: 'Custom Object ID',
      type: 'short-input',
      placeholder: 'Enter the custom object ID',
      condition: { field: 'operation', value: [...CUSTOM_OBJECT_ID_OPS] },
      required: { field: 'operation', value: [...CUSTOM_OBJECT_ID_OPS] },
    },
    {
      id: 'externalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'Enter the external ID',
      condition: { field: 'operation', value: 'get_custom_object_record_by_external_id' },
      required: { field: 'operation', value: 'get_custom_object_record_by_external_id' },
    },
    {
      id: 'name',
      title: 'Name',
      type: 'short-input',
      placeholder: 'Enter the resource name',
      condition: { field: 'operation', value: [...NAME_OPS] },
      required: {
        field: 'operation',
        value: [
          'create_department',
          'create_title',
          'create_work_location',
          'create_business_partner_group',
          'create_custom_object',
          'create_custom_object_field',
          'create_custom_app',
          'create_custom_page',
          'create_object_category',
        ],
      },
    },
    {
      id: 'parentId',
      title: 'Parent ID',
      type: 'short-input',
      placeholder: 'Enter the parent resource ID',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_department', 'update_department'],
      },
    },
    {
      id: 'referenceCode',
      title: 'Reference Code',
      type: 'short-input',
      placeholder: 'Enter reference code',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: ['create_department', 'update_department'],
      },
    },
    {
      id: 'data',
      title: 'Data (JSON)',
      type: 'long-input',
      placeholder: '{ "key": "value" }',
      condition: { field: 'operation', value: [...DATA_OPS] },
      required: {
        field: 'operation',
        value: [
          'create_custom_object_record',
          'update_custom_object_record',
          'create_custom_setting',
          'update_custom_setting',
          'create_draft_hires',
          'update_supergroup_inclusion_members',
          'update_supergroup_exclusion_members',
        ],
      },
    },
    {
      id: 'records',
      title: 'Records (JSON)',
      type: 'long-input',
      placeholder: '[{ "fields": { ... } }, ...]',
      condition: {
        field: 'operation',
        value: [
          'bulk_create_custom_object_records',
          'bulk_update_custom_object_records',
          'bulk_delete_custom_object_records',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'bulk_create_custom_object_records',
          'bulk_update_custom_object_records',
          'bulk_delete_custom_object_records',
        ],
      },
    },
    {
      id: 'query',
      title: 'Query',
      type: 'long-input',
      placeholder: 'Enter query expression',
      condition: { field: 'operation', value: 'query_custom_object_records' },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results to return',
      mode: 'advanced',
      condition: { field: 'operation', value: 'query_custom_object_records' },
    },
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'OData filter expression',
      mode: 'advanced',
      condition: { field: 'operation', value: [...FILTER_OPS] },
    },
    {
      id: 'expand',
      title: 'Expand',
      type: 'short-input',
      placeholder: 'Fields to expand',
      mode: 'advanced',
      condition: { field: 'operation', value: [...EXPAND_OPS] },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'e.g., name asc',
      mode: 'advanced',
      condition: { field: 'operation', value: [...ORDER_BY_OPS] },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from previous response',
      mode: 'advanced',
      condition: { field: 'operation', value: [...CURSOR_OPS] },
    },
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Rippling API key',
      required: true,
      password: true,
    },
  ],

  tools: {
    access: [
      // Workers
      'rippling_list_workers',
      'rippling_get_worker',
      // Users
      'rippling_list_users',
      'rippling_get_user',
      // Companies
      'rippling_list_companies',
      // Current User
      'rippling_get_current_user',
      // Entitlements
      'rippling_list_entitlements',
      // Departments
      'rippling_list_departments',
      'rippling_get_department',
      'rippling_create_department',
      'rippling_update_department',
      // Teams
      'rippling_list_teams',
      'rippling_get_team',
      // Employment Types
      'rippling_list_employment_types',
      'rippling_get_employment_type',
      // Titles
      'rippling_list_titles',
      'rippling_get_title',
      'rippling_create_title',
      'rippling_update_title',
      'rippling_delete_title',
      // Custom Fields
      'rippling_list_custom_fields',
      // Job Functions
      'rippling_list_job_functions',
      'rippling_get_job_function',
      // Work Locations
      'rippling_list_work_locations',
      'rippling_get_work_location',
      'rippling_create_work_location',
      'rippling_update_work_location',
      'rippling_delete_work_location',
      // Business Partners
      'rippling_list_business_partners',
      'rippling_get_business_partner',
      'rippling_create_business_partner',
      'rippling_delete_business_partner',
      // Business Partner Groups
      'rippling_list_business_partner_groups',
      'rippling_get_business_partner_group',
      'rippling_create_business_partner_group',
      'rippling_delete_business_partner_group',
      // Supergroups
      'rippling_list_supergroups',
      'rippling_get_supergroup',
      'rippling_list_supergroup_members',
      'rippling_list_supergroup_inclusion_members',
      'rippling_list_supergroup_exclusion_members',
      'rippling_update_supergroup_inclusion_members',
      'rippling_update_supergroup_exclusion_members',
      // Custom Objects
      'rippling_list_custom_objects',
      'rippling_get_custom_object',
      'rippling_create_custom_object',
      'rippling_update_custom_object',
      'rippling_delete_custom_object',
      // Custom Object Fields
      'rippling_list_custom_object_fields',
      'rippling_get_custom_object_field',
      'rippling_create_custom_object_field',
      'rippling_update_custom_object_field',
      'rippling_delete_custom_object_field',
      // Custom Object Records
      'rippling_list_custom_object_records',
      'rippling_get_custom_object_record',
      'rippling_get_custom_object_record_by_external_id',
      'rippling_query_custom_object_records',
      'rippling_create_custom_object_record',
      'rippling_update_custom_object_record',
      'rippling_delete_custom_object_record',
      'rippling_bulk_create_custom_object_records',
      'rippling_bulk_update_custom_object_records',
      'rippling_bulk_delete_custom_object_records',
      // Custom Apps
      'rippling_list_custom_apps',
      'rippling_get_custom_app',
      'rippling_create_custom_app',
      'rippling_update_custom_app',
      'rippling_delete_custom_app',
      // Custom Pages
      'rippling_list_custom_pages',
      'rippling_get_custom_page',
      'rippling_create_custom_page',
      'rippling_update_custom_page',
      'rippling_delete_custom_page',
      // Custom Settings
      'rippling_list_custom_settings',
      'rippling_get_custom_setting',
      'rippling_create_custom_setting',
      'rippling_update_custom_setting',
      'rippling_delete_custom_setting',
      // Object Categories
      'rippling_list_object_categories',
      'rippling_get_object_category',
      'rippling_create_object_category',
      'rippling_update_object_category',
      'rippling_delete_object_category',
      // Report Runs
      'rippling_get_report_run',
      'rippling_trigger_report_run',
      // Draft Hires
      'rippling_create_draft_hires',
    ],
    config: {
      tool: (params) => `rippling_${params.operation}`,
      params: (params) => {
        const mapped: Record<string, unknown> = {
          apiKey: params.apiKey,
        }

        if (params.id) mapped.id = params.id
        if (params.customObjectId) mapped.customObjectId = params.customObjectId
        if (params.externalId) mapped.externalId = params.externalId
        if (params.name) mapped.name = params.name
        if (params.parentId) mapped.parentId = params.parentId
        if (params.referenceCode) mapped.referenceCode = params.referenceCode
        if (params.filter) mapped.filter = params.filter
        if (params.expand) mapped.expand = params.expand
        if (params.orderBy) mapped.orderBy = params.orderBy
        if (params.cursor) mapped.cursor = params.cursor
        if (params.limit) mapped.limit = Number(params.limit)

        if (params.data) {
          try {
            mapped.data = typeof params.data === 'string' ? JSON.parse(params.data) : params.data
          } catch {
            throw new Error('Invalid JSON in "Data (JSON)" field. Expected a valid JSON object.')
          }
        }

        if (params.records) {
          try {
            mapped.records =
              typeof params.records === 'string' ? JSON.parse(params.records) : params.records
          } catch {
            throw new Error('Invalid JSON in "Records (JSON)" field. Expected a valid JSON array.')
          }
        }

        if (params.query) {
          mapped.query = params.query
        }

        const op = params.operation as string

        // Custom object tools expect customObjectApiName, not customObjectId
        if (mapped.customObjectId) {
          mapped.customObjectApiName = mapped.customObjectId
          mapped.customObjectId = undefined
        }

        // Supergroup member tools expect groupId, not id
        if (
          [
            'list_supergroup_members',
            'list_supergroup_inclusion_members',
            'list_supergroup_exclusion_members',
            'update_supergroup_inclusion_members',
            'update_supergroup_exclusion_members',
          ].includes(op)
        ) {
          if (mapped.id) {
            mapped.groupId = mapped.id
            mapped.id = undefined
          }
        }

        // Custom object get/update/delete expect customObjectApiName for the object itself
        if (['get_custom_object', 'update_custom_object', 'delete_custom_object'].includes(op)) {
          if (mapped.id) {
            mapped.customObjectApiName = mapped.id
            mapped.id = undefined
          }
        }

        // Custom object field tools expect fieldApiName, not id
        if (
          [
            'get_custom_object_field',
            'update_custom_object_field',
            'delete_custom_object_field',
          ].includes(op)
        ) {
          if (mapped.id) {
            mapped.fieldApiName = mapped.id
            mapped.id = undefined
          }
        }

        // Custom object record tools expect codrId, not id
        if (
          [
            'get_custom_object_record',
            'update_custom_object_record',
            'delete_custom_object_record',
          ].includes(op)
        ) {
          if (mapped.id) {
            mapped.codrId = mapped.id
            mapped.id = undefined
          }
        }

        // Report run tools
        if (op === 'get_report_run') {
          if (mapped.id) {
            mapped.runId = mapped.id
            mapped.id = undefined
          }
        }
        if (op === 'trigger_report_run') {
          if (mapped.id) {
            mapped.reportId = mapped.id
            mapped.id = undefined
          }
        }

        // Bulk operations: map records to specific param names
        if (op === 'bulk_create_custom_object_records' && mapped.records) {
          mapped.rowsToWrite = mapped.records
          mapped.records = undefined
        }
        if (op === 'bulk_update_custom_object_records' && mapped.records) {
          mapped.rowsToUpdate = mapped.records
          mapped.records = undefined
        }
        if (op === 'bulk_delete_custom_object_records' && mapped.records) {
          mapped.rowsToDelete = mapped.records
          mapped.records = undefined
        }

        // Draft hires: map data to draftHires
        if (op === 'create_draft_hires' && mapped.data) {
          mapped.draftHires = mapped.data
          mapped.data = undefined
        }

        // Supergroup member updates: map data to operations
        if (
          ['update_supergroup_inclusion_members', 'update_supergroup_exclusion_members'].includes(
            op
          ) &&
          mapped.data
        ) {
          mapped.operations = mapped.data
          mapped.data = undefined
        }

        // For create/update operations that accept data JSON:
        // Spread data fields directly into mapped params so tools receive them as individual params
        if (mapped.data && typeof mapped.data === 'object') {
          const spreadOps = [
            'create_department',
            'update_department',
            'create_title',
            'update_title',
            'create_work_location',
            'update_work_location',
            'create_business_partner',
            'create_business_partner_group',
            'create_custom_object',
            'update_custom_object',
            'create_custom_object_field',
            'update_custom_object_field',
            'create_custom_app',
            'update_custom_app',
            'create_object_category',
            'update_object_category',
          ]
          if (spreadOps.includes(op)) {
            const dataFields = mapped.data as Record<string, unknown>
            for (const [key, value] of Object.entries(dataFields)) {
              if (!(key in mapped)) {
                mapped[key] = value
              }
            }
            mapped.data = undefined
          }
        }

        return mapped
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    id: { type: 'string', description: 'Resource ID' },
    customObjectId: { type: 'string', description: 'Custom object ID' },
    externalId: { type: 'string', description: 'External ID for custom object record lookup' },
    name: { type: 'string', description: 'Resource name' },
    parentId: { type: 'string', description: 'Parent resource ID' },
    referenceCode: { type: 'string', description: 'Reference code' },
    data: { type: 'json', description: 'JSON data body for create/update operations' },
    records: { type: 'json', description: 'JSON array of records for bulk operations' },
    query: { type: 'string', description: 'Query expression for custom object record queries' },
    limit: { type: 'number', description: 'Max results to return' },
    filter: { type: 'string', description: 'OData filter expression' },
    expand: { type: 'string', description: 'Fields to expand in the response' },
    orderBy: { type: 'string', description: 'Ordering expression' },
    cursor: { type: 'string', description: 'Pagination cursor' },
    apiKey: { type: 'string', description: 'Rippling API key' },
  },

  outputs: {
    id: { type: 'string', description: 'Resource ID' },
    name: { type: 'string', description: 'Resource name' },
    status: { type: 'string', description: 'Resource status' },
    created_at: { type: 'string', description: 'Creation timestamp' },
    updated_at: { type: 'string', description: 'Last update timestamp' },
    workers: { type: 'array', description: 'List of workers' },
    users: { type: 'array', description: 'List of users' },
    companies: { type: 'array', description: 'List of companies' },
    departments: { type: 'array', description: 'List of departments' },
    teams: { type: 'array', description: 'List of teams' },
    items: { type: 'array', description: 'List of returned items' },
    totalCount: { type: 'number', description: 'Total number of items returned' },
    nextLink: { type: 'string', description: 'URL or cursor for the next page of results' },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
  },
}
