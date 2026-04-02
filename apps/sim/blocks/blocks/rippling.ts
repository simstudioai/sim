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

/** Operations that accept a description field */
const DESCRIPTION_OPS = [
  'create_custom_object',
  'update_custom_object',
  'create_custom_object_field',
  'update_custom_object_field',
  'create_custom_app',
  'update_custom_app',
  'create_object_category',
  'update_object_category',
] as const

/** Operations for work location address fields */
const WORK_LOCATION_WRITE_OPS = ['create_work_location', 'update_work_location'] as const

/** Operations for custom object create/update */
const CUSTOM_OBJECT_WRITE_OPS = ['create_custom_object', 'update_custom_object'] as const

/** Operations for custom object field configuration */
const CUSTOM_OBJECT_FIELD_WRITE_OPS = [
  'create_custom_object_field',
  'update_custom_object_field',
] as const

/** Operations for custom setting fields */
const CUSTOM_SETTING_WRITE_OPS = ['create_custom_setting', 'update_custom_setting'] as const

/** Operations where data JSON is passed through directly (not spread) */
const DATA_PASSTHROUGH_OPS = [
  'create_custom_object_record',
  'update_custom_object_record',
  'create_draft_hires',
  'update_supergroup_inclusion_members',
  'update_supergroup_exclusion_members',
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
        {
          label: 'Update Supergroup Inclusion Members',
          id: 'update_supergroup_inclusion_members',
        },
        {
          label: 'Update Supergroup Exclusion Members',
          id: 'update_supergroup_exclusion_members',
        },
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
        {
          label: 'Bulk Create Custom Object Records',
          id: 'bulk_create_custom_object_records',
        },
        {
          label: 'Bulk Update Custom Object Records',
          id: 'bulk_update_custom_object_records',
        },
        {
          label: 'Bulk Delete Custom Object Records',
          id: 'bulk_delete_custom_object_records',
        },
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
      title: 'Custom Object API Name',
      type: 'short-input',
      placeholder: 'Enter the custom object API name (e.g. my_object__c)',
      condition: { field: 'operation', value: [...CUSTOM_OBJECT_ID_OPS] },
      required: { field: 'operation', value: [...CUSTOM_OBJECT_ID_OPS] },
    },
    {
      id: 'externalId',
      title: 'External ID',
      type: 'short-input',
      placeholder: 'Enter the external ID',
      condition: {
        field: 'operation',
        value: [
          'get_custom_object_record_by_external_id',
          'create_custom_object_record',
          'update_custom_object_record',
        ],
      },
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
    // Department fields
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
    // Description (shared across many create/update operations)
    {
      id: 'description',
      title: 'Description',
      type: 'short-input',
      placeholder: 'Enter a description',
      mode: 'advanced',
      condition: { field: 'operation', value: [...DESCRIPTION_OPS] },
    },
    // Custom App fields
    {
      id: 'apiName',
      title: 'API Name',
      type: 'short-input',
      placeholder: 'Enter the API name (e.g. my_app)',
      condition: { field: 'operation', value: ['create_custom_app', 'update_custom_app'] },
      required: { field: 'operation', value: 'create_custom_app' },
    },
    // Business Partner fields
    {
      id: 'businessPartnerGroupId',
      title: 'Business Partner Group ID',
      type: 'short-input',
      placeholder: 'Enter the business partner group ID',
      condition: { field: 'operation', value: 'create_business_partner' },
      required: { field: 'operation', value: 'create_business_partner' },
    },
    {
      id: 'workerId',
      title: 'Worker ID',
      type: 'short-input',
      placeholder: 'Enter the worker ID',
      condition: { field: 'operation', value: 'create_business_partner' },
      required: { field: 'operation', value: 'create_business_partner' },
    },
    // Business Partner Group fields
    {
      id: 'domain',
      title: 'Domain',
      type: 'dropdown',
      options: [
        { label: 'HR', id: 'HR' },
        { label: 'IT', id: 'IT' },
        { label: 'Finance', id: 'FINANCE' },
        { label: 'Recruiting', id: 'RECRUITING' },
        { label: 'Other', id: 'OTHER' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_business_partner_group' },
    },
    {
      id: 'defaultBusinessPartnerId',
      title: 'Default Business Partner ID',
      type: 'short-input',
      placeholder: 'Enter the default business partner worker ID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_business_partner_group' },
    },
    // Work Location address fields
    {
      id: 'streetAddress',
      title: 'Street Address',
      type: 'short-input',
      placeholder: 'Enter the street address',
      condition: { field: 'operation', value: [...WORK_LOCATION_WRITE_OPS] },
      required: { field: 'operation', value: 'create_work_location' },
    },
    {
      id: 'locality',
      title: 'City',
      type: 'short-input',
      placeholder: 'Enter the city',
      mode: 'advanced',
      condition: { field: 'operation', value: [...WORK_LOCATION_WRITE_OPS] },
    },
    {
      id: 'region',
      title: 'State/Region',
      type: 'short-input',
      placeholder: 'Enter the state or region',
      mode: 'advanced',
      condition: { field: 'operation', value: [...WORK_LOCATION_WRITE_OPS] },
    },
    {
      id: 'postalCode',
      title: 'Postal Code',
      type: 'short-input',
      placeholder: 'Enter the postal code',
      mode: 'advanced',
      condition: { field: 'operation', value: [...WORK_LOCATION_WRITE_OPS] },
    },
    {
      id: 'addressCountry',
      title: 'Country',
      type: 'short-input',
      placeholder: 'Enter the country code (e.g. US)',
      mode: 'advanced',
      condition: { field: 'operation', value: [...WORK_LOCATION_WRITE_OPS] },
    },
    {
      id: 'addressType',
      title: 'Address Type',
      type: 'dropdown',
      options: [
        { label: 'Home', id: 'HOME' },
        { label: 'Work', id: 'WORK' },
        { label: 'Other', id: 'OTHER' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: [...WORK_LOCATION_WRITE_OPS] },
    },
    // Custom Object fields
    {
      id: 'category',
      title: 'Category',
      type: 'short-input',
      placeholder: 'Enter the category ID',
      mode: 'advanced',
      condition: { field: 'operation', value: [...CUSTOM_OBJECT_WRITE_OPS] },
    },
    {
      id: 'pluralLabel',
      title: 'Plural Label',
      type: 'short-input',
      placeholder: 'Enter the plural label',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_custom_object' },
    },
    {
      id: 'ownerRole',
      title: 'Owner Role',
      type: 'short-input',
      placeholder: 'Enter the owner role',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_custom_object' },
    },
    // Custom Object Field configuration
    {
      id: 'dataType',
      title: 'Data Type',
      type: 'long-input',
      placeholder: '{ "type": "TEXT" }',
      condition: { field: 'operation', value: [...CUSTOM_OBJECT_FIELD_WRITE_OPS] },
      required: { field: 'operation', value: 'create_custom_object_field' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object for a Rippling custom object field data type based on the user's description.
Common types: TEXT, NUMBER, BOOLEAN, DATE, DATETIME, LOOKUP, FORMULA, ROLLUP.
Examples:
- "text field" -> { "type": "TEXT" }
- "number field" -> { "type": "NUMBER" }
- "date field" -> { "type": "DATE" }
- "lookup to workers" -> { "type": "LOOKUP", "referenced_object": "worker" }
Return ONLY the JSON - no explanations, no extra text.`,
        placeholder: 'Describe the field type',
      },
    },
    {
      id: 'fieldRequired',
      title: 'Required',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: [...CUSTOM_OBJECT_FIELD_WRITE_OPS] },
    },
    {
      id: 'isUnique',
      title: 'Unique',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: [...CUSTOM_OBJECT_FIELD_WRITE_OPS] },
    },
    {
      id: 'enableHistory',
      title: 'Enable History',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: [...CUSTOM_OBJECT_FIELD_WRITE_OPS] },
    },
    {
      id: 'rqlDefinition',
      title: 'RQL Definition',
      type: 'long-input',
      placeholder: '{ ... }',
      mode: 'advanced',
      condition: { field: 'operation', value: [...CUSTOM_OBJECT_FIELD_WRITE_OPS] },
    },
    {
      id: 'formulaAttrMetas',
      title: 'Formula Attr Metas',
      type: 'long-input',
      placeholder: '{ ... }',
      mode: 'advanced',
      condition: { field: 'operation', value: [...CUSTOM_OBJECT_FIELD_WRITE_OPS] },
    },
    {
      id: 'fieldSection',
      title: 'Section',
      type: 'long-input',
      placeholder: '{ ... }',
      mode: 'advanced',
      condition: { field: 'operation', value: [...CUSTOM_OBJECT_FIELD_WRITE_OPS] },
    },
    {
      id: 'derivedFieldFormula',
      title: 'Derived Field Formula',
      type: 'short-input',
      placeholder: 'Enter the formula expression',
      mode: 'advanced',
      condition: { field: 'operation', value: [...CUSTOM_OBJECT_FIELD_WRITE_OPS] },
    },
    {
      id: 'derivedAggregatedField',
      title: 'Derived Aggregated Field',
      type: 'long-input',
      placeholder: '{ ... }',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_custom_object_field' },
    },
    {
      id: 'nameFieldDetails',
      title: 'Name Field Details',
      type: 'long-input',
      placeholder: '{ ... }',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_custom_object_field' },
    },
    // Custom Setting fields
    {
      id: 'displayName',
      title: 'Display Name',
      type: 'short-input',
      placeholder: 'Enter the display name',
      condition: { field: 'operation', value: [...CUSTOM_SETTING_WRITE_OPS] },
    },
    {
      id: 'settingApiName',
      title: 'Setting API Name',
      type: 'short-input',
      placeholder: 'Enter the unique API name',
      mode: 'advanced',
      condition: { field: 'operation', value: [...CUSTOM_SETTING_WRITE_OPS] },
    },
    {
      id: 'settingDataType',
      title: 'Setting Data Type',
      type: 'short-input',
      placeholder: 'Enter the data type',
      mode: 'advanced',
      condition: { field: 'operation', value: [...CUSTOM_SETTING_WRITE_OPS] },
    },
    {
      id: 'secretValue',
      title: 'Secret Value',
      type: 'short-input',
      placeholder: 'Enter the secret value',
      password: true,
      mode: 'advanced',
      condition: { field: 'operation', value: [...CUSTOM_SETTING_WRITE_OPS] },
    },
    {
      id: 'stringValue',
      title: 'String Value',
      type: 'short-input',
      placeholder: 'Enter the string value',
      condition: { field: 'operation', value: [...CUSTOM_SETTING_WRITE_OPS] },
    },
    {
      id: 'settingNumberValue',
      title: 'Number Value',
      type: 'short-input',
      placeholder: 'Enter the number value',
      mode: 'advanced',
      condition: { field: 'operation', value: [...CUSTOM_SETTING_WRITE_OPS] },
    },
    {
      id: 'settingBooleanValue',
      title: 'Boolean Value',
      type: 'dropdown',
      options: [
        { label: 'False', id: 'false' },
        { label: 'True', id: 'true' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: [...CUSTOM_SETTING_WRITE_OPS] },
    },
    // Report Run fields
    {
      id: 'includeObjectIds',
      title: 'Include Object IDs',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_report_run' },
    },
    {
      id: 'includeTotalRows',
      title: 'Include Total Rows',
      type: 'dropdown',
      options: [
        { label: 'No', id: 'false' },
        { label: 'Yes', id: 'true' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_report_run' },
    },
    {
      id: 'formatDateFields',
      title: 'Format Date Fields',
      type: 'long-input',
      placeholder: '{ "date_format": "ISO_8601" }',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_report_run' },
    },
    {
      id: 'formatCurrencyFields',
      title: 'Format Currency Fields',
      type: 'long-input',
      placeholder: '{ ... }',
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_report_run' },
    },
    {
      id: 'outputType',
      title: 'Output Type',
      type: 'dropdown',
      options: [
        { label: 'JSON', id: 'JSON' },
        { label: 'CSV', id: 'CSV' },
      ],
      mode: 'advanced',
      condition: { field: 'operation', value: 'trigger_report_run' },
    },
    // Data JSON - only for passthrough operations (custom object records, draft hires, supergroup ops)
    {
      id: 'data',
      title: 'Data',
      type: 'long-input',
      placeholder: '{ "key": "value" }',
      condition: { field: 'operation', value: [...DATA_PASSTHROUGH_OPS] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a JSON object for a Rippling API request based on the user's description.
For custom object records: { "field_name": "value", ... }
For draft hires: { "draft_hires": [{ "personal_info": { "first_name": "", "last_name": "", "email": "" }, "employment_info": { "start_date": "", "title": "" }, "work_location_info": { "work_location_id": "" } }] }
For supergroup member updates: { "Operations": [{ "op": "add", "path": "members", "value": [{ "value": "worker_id" }] }] }
Return ONLY the JSON - no explanations, no extra text.`,
        placeholder: 'Describe the data to send',
      },
      required: {
        field: 'operation',
        value: [
          'create_custom_object_record',
          'create_draft_hires',
          'update_supergroup_inclusion_members',
          'update_supergroup_exclusion_members',
        ],
      },
    },
    // Records JSON for bulk operations
    {
      id: 'records',
      title: 'Records',
      type: 'long-input',
      placeholder: '[{ "data": { ... } }, ...]',
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
      id: 'allOrNothing',
      title: 'All Or Nothing',
      type: 'dropdown',
      options: [
        { label: 'No (partial success allowed)', id: 'false' },
        { label: 'Yes (fail entire batch on any error)', id: 'true' },
      ],
      value: () => 'false',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'bulk_create_custom_object_records',
          'bulk_update_custom_object_records',
          'bulk_delete_custom_object_records',
        ],
      },
    },
    // Query fields for custom object record queries
    {
      id: 'query',
      title: 'Query',
      type: 'long-input',
      placeholder: 'Enter query expression',
      condition: { field: 'operation', value: 'query_custom_object_records' },
      wandConfig: {
        enabled: true,
        prompt: `Generate a query expression for the Rippling Custom Object Records Query API based on the user's description.
The query should filter custom object records by their field values.
Return ONLY the query expression - no explanations, no extra text.`,
        placeholder: 'Describe which records to find',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: 'Max results to return',
      mode: 'advanced',
      condition: { field: 'operation', value: 'query_custom_object_records' },
    },
    // Common query parameters
    {
      id: 'filter',
      title: 'Filter',
      type: 'short-input',
      placeholder: 'OData filter expression',
      mode: 'advanced',
      condition: { field: 'operation', value: [...FILTER_OPS] },
      wandConfig: {
        enabled: true,
        prompt: `Generate an OData filter expression for the Rippling API based on the user's description.
Examples:
- "active workers" -> status eq 'ACTIVE'
- "workers in engineering" -> department eq 'Engineering'
- "created after January" -> created_at gt '2024-01-01'
Return ONLY the filter expression - no explanations, no extra text.`,
        placeholder: 'Describe what to filter for',
      },
    },
    {
      id: 'expand',
      title: 'Expand',
      type: 'short-input',
      placeholder: 'Fields to expand',
      mode: 'advanced',
      condition: { field: 'operation', value: [...EXPAND_OPS] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a comma-separated list of fields to expand for a Rippling API request based on the user's description.
Common expandable fields: department, parent, worker, business_partner_group, client_group, parent_legal_entity, legal_entities, department_hierarchy.
Return ONLY the comma-separated field names - no explanations, no extra text.`,
        placeholder: 'Describe which related data to include',
      },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'e.g., name asc',
      mode: 'advanced',
      condition: { field: 'operation', value: [...ORDER_BY_OPS] },
      wandConfig: {
        enabled: true,
        prompt: `Generate a sort expression for the Rippling API based on the user's description.
Format: field_name for ascending, -field_name for descending. Common fields: id, created_at, updated_at, name.
Examples:
- "newest first" -> -created_at
- "alphabetical" -> name
- "recently updated" -> -updated_at
Return ONLY the sort expression - no explanations, no extra text.`,
        placeholder: 'Describe how to sort results',
      },
    },
    {
      id: 'cursor',
      title: 'Cursor',
      type: 'short-input',
      placeholder: 'Pagination cursor from previous response',
      mode: 'advanced',
      condition: { field: 'operation', value: [...CURSOR_OPS] },
    },
    // API Key
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
        const op = params.operation as string

        // Common fields
        if (params.id != null && params.id !== '') mapped.id = params.id
        if (params.customObjectId != null && params.customObjectId !== '')
          mapped.customObjectId = params.customObjectId
        if (params.externalId != null && params.externalId !== '')
          mapped.externalId = params.externalId
        if (params.name != null && params.name !== '') mapped.name = params.name
        if (params.parentId != null && params.parentId !== '') mapped.parentId = params.parentId
        if (params.referenceCode != null && params.referenceCode !== '')
          mapped.referenceCode = params.referenceCode
        if (params.description != null && params.description !== '')
          mapped.description = params.description
        if (params.apiName != null && params.apiName !== '') mapped.apiName = params.apiName

        // Business Partner fields
        if (params.businessPartnerGroupId != null && params.businessPartnerGroupId !== '')
          mapped.businessPartnerGroupId = params.businessPartnerGroupId
        if (params.workerId != null && params.workerId !== '') mapped.workerId = params.workerId

        // Business Partner Group fields
        if (params.domain != null && params.domain !== '') mapped.domain = params.domain
        if (params.defaultBusinessPartnerId != null && params.defaultBusinessPartnerId !== '')
          mapped.defaultBusinessPartnerId = params.defaultBusinessPartnerId

        // Work Location address fields
        if (params.streetAddress != null && params.streetAddress !== '')
          mapped.streetAddress = params.streetAddress
        if (params.locality != null && params.locality !== '') mapped.locality = params.locality
        if (params.region != null && params.region !== '') mapped.region = params.region
        if (params.postalCode != null && params.postalCode !== '')
          mapped.postalCode = params.postalCode
        if (params.addressCountry != null && params.addressCountry !== '')
          mapped.country = params.addressCountry
        if (params.addressType != null && params.addressType !== '')
          mapped.addressType = params.addressType

        // Custom Object fields
        if (params.category != null && params.category !== '') mapped.category = params.category
        if (params.pluralLabel != null && params.pluralLabel !== '')
          mapped.pluralLabel = params.pluralLabel
        if (params.ownerRole != null && params.ownerRole !== '') mapped.ownerRole = params.ownerRole

        // Custom Object Field configuration
        if (params.dataType != null && params.dataType !== '') {
          try {
            mapped.dataType =
              typeof params.dataType === 'string' ? JSON.parse(params.dataType) : params.dataType
          } catch {
            throw new Error(
              'Invalid JSON in "Data Type" field. Expected a valid JSON object like { "type": "TEXT" }.'
            )
          }
        }
        if (
          params.fieldRequired != null &&
          params.fieldRequired !== '' &&
          params.fieldRequired !== 'false'
        )
          mapped.required = params.fieldRequired === 'true'
        if (params.isUnique != null && params.isUnique !== '' && params.isUnique !== 'false')
          mapped.isUnique = params.isUnique === 'true'
        if (
          params.enableHistory != null &&
          params.enableHistory !== '' &&
          params.enableHistory !== 'false'
        )
          mapped.enableHistory = params.enableHistory === 'true'
        if (params.rqlDefinition != null && params.rqlDefinition !== '') {
          try {
            mapped.rqlDefinition =
              typeof params.rqlDefinition === 'string'
                ? JSON.parse(params.rqlDefinition)
                : params.rqlDefinition
          } catch {
            throw new Error('Invalid JSON in "RQL Definition" field.')
          }
        }
        if (params.formulaAttrMetas != null && params.formulaAttrMetas !== '') {
          try {
            mapped.formulaAttrMetas =
              typeof params.formulaAttrMetas === 'string'
                ? JSON.parse(params.formulaAttrMetas)
                : params.formulaAttrMetas
          } catch {
            throw new Error('Invalid JSON in "Formula Attr Metas" field.')
          }
        }
        if (params.fieldSection != null && params.fieldSection !== '') {
          try {
            mapped.section =
              typeof params.fieldSection === 'string'
                ? JSON.parse(params.fieldSection)
                : params.fieldSection
          } catch {
            throw new Error('Invalid JSON in "Section" field.')
          }
        }
        if (params.derivedFieldFormula != null && params.derivedFieldFormula !== '')
          mapped.derivedFieldFormula = params.derivedFieldFormula
        if (params.derivedAggregatedField != null && params.derivedAggregatedField !== '') {
          try {
            mapped.derivedAggregatedField =
              typeof params.derivedAggregatedField === 'string'
                ? JSON.parse(params.derivedAggregatedField)
                : params.derivedAggregatedField
          } catch {
            throw new Error('Invalid JSON in "Derived Aggregated Field" field.')
          }
        }
        if (params.nameFieldDetails != null && params.nameFieldDetails !== '') {
          try {
            mapped.nameFieldDetails =
              typeof params.nameFieldDetails === 'string'
                ? JSON.parse(params.nameFieldDetails)
                : params.nameFieldDetails
          } catch {
            throw new Error('Invalid JSON in "Name Field Details" field.')
          }
        }

        // Custom Setting fields
        if (params.displayName != null && params.displayName !== '')
          mapped.displayName = params.displayName
        if (params.settingApiName != null && params.settingApiName !== '')
          mapped.apiName = params.settingApiName
        if (params.settingDataType != null && params.settingDataType !== '')
          mapped.dataType = params.settingDataType
        if (params.secretValue != null && params.secretValue !== '')
          mapped.secretValue = params.secretValue
        if (params.stringValue != null && params.stringValue !== '')
          mapped.stringValue = params.stringValue
        if (params.settingNumberValue != null && params.settingNumberValue !== '')
          mapped.numberValue = Number(params.settingNumberValue)
        if (params.settingBooleanValue != null && params.settingBooleanValue !== '')
          mapped.booleanValue = params.settingBooleanValue === 'true'

        // Report Run fields
        if (
          params.includeObjectIds != null &&
          params.includeObjectIds !== '' &&
          params.includeObjectIds !== 'false'
        )
          mapped.includeObjectIds = params.includeObjectIds === 'true'
        if (
          params.includeTotalRows != null &&
          params.includeTotalRows !== '' &&
          params.includeTotalRows !== 'false'
        )
          mapped.includeTotalRows = params.includeTotalRows === 'true'
        if (params.formatDateFields != null && params.formatDateFields !== '') {
          try {
            mapped.formatDateFields =
              typeof params.formatDateFields === 'string'
                ? JSON.parse(params.formatDateFields)
                : params.formatDateFields
          } catch {
            throw new Error('Invalid JSON in "Format Date Fields" field.')
          }
        }
        if (params.formatCurrencyFields != null && params.formatCurrencyFields !== '') {
          try {
            mapped.formatCurrencyFields =
              typeof params.formatCurrencyFields === 'string'
                ? JSON.parse(params.formatCurrencyFields)
                : params.formatCurrencyFields
          } catch {
            throw new Error('Invalid JSON in "Format Currency Fields" field.')
          }
        }
        if (params.outputType != null && params.outputType !== '')
          mapped.outputType = params.outputType

        // All Or Nothing for bulk operations
        if (
          params.allOrNothing != null &&
          params.allOrNothing !== '' &&
          params.allOrNothing !== 'false'
        )
          mapped.allOrNothing = params.allOrNothing === 'true'

        // Common query parameters
        if (params.filter != null && params.filter !== '') mapped.filter = params.filter
        if (params.expand != null && params.expand !== '') mapped.expand = params.expand
        if (params.orderBy != null && params.orderBy !== '') mapped.orderBy = params.orderBy
        if (params.cursor != null && params.cursor !== '') mapped.cursor = params.cursor

        // Query and limit for custom object record queries
        if (params.query != null && params.query !== '') mapped.query = params.query
        if (params.limit != null && params.limit !== '') mapped.limit = Number(params.limit)

        // Data JSON - only for passthrough operations
        if (params.data != null && params.data !== '') {
          try {
            mapped.data = typeof params.data === 'string' ? JSON.parse(params.data) : params.data
          } catch {
            throw new Error('Invalid JSON in "Data (JSON)" field.')
          }
        }

        // Records JSON for bulk operations
        if (params.records != null && params.records !== '') {
          try {
            mapped.records =
              typeof params.records === 'string' ? JSON.parse(params.records) : params.records
          } catch {
            throw new Error('Invalid JSON in "Records (JSON)" field.')
          }
        }

        // --- ID remapping ---

        // Custom object tools expect customObjectApiName, not customObjectId
        if (mapped.customObjectId != null) {
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
          if (mapped.id != null) {
            mapped.groupId = mapped.id
            mapped.id = undefined
          }
        }

        // Custom object get/update/delete expect customObjectApiName for the object itself
        if (['get_custom_object', 'update_custom_object', 'delete_custom_object'].includes(op)) {
          if (mapped.id != null) {
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
          if (mapped.id != null) {
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
          if (mapped.id != null) {
            mapped.codrId = mapped.id
            mapped.id = undefined
          }
        }

        // Report run tools
        if (op === 'get_report_run') {
          if (mapped.id != null) {
            mapped.runId = mapped.id
            mapped.id = undefined
          }
        }
        if (op === 'trigger_report_run') {
          if (mapped.id != null) {
            mapped.reportId = mapped.id
            mapped.id = undefined
          }
        }

        // Bulk operations: map records to specific param names
        if (op === 'bulk_create_custom_object_records' && mapped.records != null) {
          mapped.rowsToWrite = mapped.records
          mapped.records = undefined
        }
        if (op === 'bulk_update_custom_object_records' && mapped.records != null) {
          mapped.rowsToUpdate = mapped.records
          mapped.records = undefined
        }
        if (op === 'bulk_delete_custom_object_records' && mapped.records != null) {
          mapped.rowsToDelete = mapped.records
          mapped.records = undefined
        }

        // Draft hires: map data to draftHires
        if (op === 'create_draft_hires' && mapped.data != null) {
          mapped.draftHires = mapped.data
          mapped.data = undefined
        }

        // Supergroup member updates: map data to operations
        if (
          ['update_supergroup_inclusion_members', 'update_supergroup_exclusion_members'].includes(
            op
          ) &&
          mapped.data != null
        ) {
          mapped.operations = mapped.data
          mapped.data = undefined
        }

        return mapped
      },
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    id: { type: 'string', description: 'Resource ID' },
    customObjectId: { type: 'string', description: 'Custom object API name' },
    externalId: { type: 'string', description: 'External ID' },
    name: { type: 'string', description: 'Resource name' },
    parentId: { type: 'string', description: 'Parent resource ID' },
    referenceCode: { type: 'string', description: 'Reference code' },
    description: { type: 'string', description: 'Resource description' },
    apiName: { type: 'string', description: 'API name for custom app' },
    businessPartnerGroupId: {
      type: 'string',
      description: 'Business partner group ID',
    },
    workerId: { type: 'string', description: 'Worker ID' },
    domain: { type: 'string', description: 'Business partner group domain' },
    defaultBusinessPartnerId: { type: 'string', description: 'Default business partner ID' },
    streetAddress: { type: 'string', description: 'Street address' },
    locality: { type: 'string', description: 'City' },
    region: { type: 'string', description: 'State/Region' },
    postalCode: { type: 'string', description: 'Postal code' },
    addressCountry: { type: 'string', description: 'Country code' },
    addressType: { type: 'string', description: 'Address type' },
    category: { type: 'string', description: 'Category' },
    pluralLabel: { type: 'string', description: 'Plural label' },
    ownerRole: { type: 'string', description: 'Owner role' },
    dataType: { type: 'json', description: 'Data type configuration' },
    fieldRequired: { type: 'boolean', description: 'Whether the field is required' },
    isUnique: { type: 'boolean', description: 'Whether the field is unique' },
    enableHistory: { type: 'boolean', description: 'Enable history tracking' },
    rqlDefinition: { type: 'json', description: 'RQL definition' },
    formulaAttrMetas: { type: 'json', description: 'Formula attribute metadata' },
    fieldSection: { type: 'json', description: 'Section configuration' },
    derivedFieldFormula: { type: 'string', description: 'Derived field formula' },
    derivedAggregatedField: { type: 'json', description: 'Derived aggregated field' },
    nameFieldDetails: { type: 'json', description: 'Name field details' },
    displayName: { type: 'string', description: 'Display name' },
    settingApiName: { type: 'string', description: 'Setting API name' },
    settingDataType: { type: 'string', description: 'Setting data type' },
    secretValue: { type: 'string', description: 'Secret value' },
    stringValue: { type: 'string', description: 'String value' },
    settingNumberValue: { type: 'number', description: 'Number value' },
    settingBooleanValue: { type: 'boolean', description: 'Boolean value' },
    includeObjectIds: { type: 'boolean', description: 'Include object IDs in report' },
    includeTotalRows: { type: 'boolean', description: 'Include total row count' },
    formatDateFields: { type: 'json', description: 'Date field formatting' },
    formatCurrencyFields: { type: 'json', description: 'Currency field formatting' },
    outputType: { type: 'string', description: 'Report output type' },
    data: { type: 'json', description: 'JSON data for custom object records' },
    records: { type: 'json', description: 'JSON array for bulk operations' },
    allOrNothing: { type: 'boolean', description: 'Fail entire batch on any error' },
    query: { type: 'string', description: 'Query expression' },
    limit: { type: 'number', description: 'Max results' },
    filter: { type: 'string', description: 'OData filter expression' },
    expand: { type: 'string', description: 'Fields to expand' },
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
    titles: { type: 'array', description: 'List of titles' },
    workLocations: { type: 'array', description: 'List of work locations' },
    employmentTypes: { type: 'array', description: 'List of employment types' },
    jobFunctions: { type: 'array', description: 'List of job functions' },
    entitlements: { type: 'array', description: 'List of entitlements' },
    customFields: { type: 'array', description: 'List of custom fields' },
    supergroups: { type: 'array', description: 'List of supergroups' },
    members: { type: 'array', description: 'List of group members' },
    businessPartners: { type: 'array', description: 'List of business partners' },
    businessPartnerGroups: { type: 'array', description: 'List of business partner groups' },
    customObjects: { type: 'array', description: 'List of custom objects' },
    fields: { type: 'array', description: 'List of custom object fields' },
    records: { type: 'array', description: 'List of custom object records' },
    customApps: { type: 'array', description: 'List of custom apps' },
    customPages: { type: 'array', description: 'List of custom pages' },
    customSettings: { type: 'array', description: 'List of custom settings' },
    objectCategories: { type: 'array', description: 'List of object categories' },
    totalCount: { type: 'number', description: 'Total number of items returned' },
    nextLink: { type: 'string', description: 'URL or cursor for the next page of results' },
    cursor: { type: 'string', description: 'Cursor for next page of query results' },
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    createdRecords: { type: 'array', description: 'Bulk created custom object records' },
    updatedRecords: { type: 'array', description: 'Bulk updated custom object records' },
    report_id: { type: 'string', description: 'Report ID' },
    file_url: { type: 'string', description: 'URL to download the report file' },
    expires_at: { type: 'string', description: 'Expiration timestamp for the file URL' },
    output_type: { type: 'string', description: 'Report output format (JSON or CSV)' },
    invalidItems: { type: 'array', description: 'Invalid items from draft hires' },
    successfulResults: { type: 'array', description: 'Successful draft hire results' },
    totalInvalid: { type: 'number', description: 'Count of invalid items' },
    totalSuccessful: { type: 'number', description: 'Count of successful items' },
    success: { type: 'boolean', description: 'Whether the operation succeeded' },
    ok: { type: 'boolean', description: 'Whether the supergroup member update succeeded' },
    data: { type: 'json', description: 'Record data including custom fields' },
    __meta: { type: 'json', description: 'Metadata including redacted_fields' },
  },
}
