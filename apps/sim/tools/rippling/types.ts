import type { OutputProperty } from '@/tools/types'

/** Worker output properties */
export const WORKER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Worker ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  user_id: { type: 'string', description: 'Associated user ID' },
  is_manager: { type: 'boolean', description: 'Whether the worker is a manager' },
  manager_id: { type: 'string', description: 'Manager worker ID' },
  legal_entity_id: { type: 'string', description: 'Legal entity ID' },
  country: { type: 'string', description: 'Worker country code' },
  start_date: { type: 'string', description: 'Employment start date' },
  end_date: { type: 'string', description: 'Employment end date' },
  number: { type: 'number', description: 'Worker number' },
  work_email: { type: 'string', description: 'Work email address' },
  personal_email: { type: 'string', description: 'Personal email address' },
  status: {
    type: 'string',
    description: 'Worker status (INIT, HIRED, ACCEPTED, ACTIVE, TERMINATED)',
  },
  employment_type_id: { type: 'string', description: 'Employment type ID' },
  department_id: { type: 'string', description: 'Department ID' },
  teams_id: { type: 'json', description: 'Array of team IDs' },
  title: { type: 'string', description: 'Job title' },
  level_id: { type: 'string', description: 'Level ID' },
  compensation_id: { type: 'string', description: 'Compensation ID' },
  overtime_exemption: {
    type: 'string',
    description: 'Overtime exemption status (EXEMPT, NON_EXEMPT)',
  },
  title_effective_date: { type: 'string', description: 'Title effective date' },
  business_partners_id: { type: 'json', description: 'Array of business partner IDs' },
  location: { type: 'json', description: 'Worker location (type, work_location_id)' },
  gender: { type: 'string', description: 'Gender' },
  date_of_birth: { type: 'string', description: 'Date of birth' },
  race: { type: 'string', description: 'Race' },
  ethnicity: { type: 'string', description: 'Ethnicity' },
  citizenship: { type: 'string', description: 'Citizenship country code' },
  termination_details: { type: 'json', description: 'Termination details' },
  custom_fields: { type: 'json', description: 'Custom fields (expandable)' },
  country_fields: { type: 'json', description: 'Country-specific fields' },
} as const satisfies Record<string, OutputProperty>

/** User output properties */
export const USER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'User ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  active: { type: 'boolean', description: 'Whether the user is active' },
  username: { type: 'string', description: 'Unique username' },
  display_name: { type: 'string', description: 'Display name' },
  preferred_language: { type: 'string', description: 'Preferred language' },
  locale: { type: 'string', description: 'Locale' },
  timezone: { type: 'string', description: 'Timezone (IANA format)' },
  number: { type: 'string', description: 'Permanent profile number' },
  name: { type: 'json', description: 'User name object (given_name, family_name, etc.)' },
  emails: { type: 'json', description: 'Array of email objects' },
  phone_numbers: { type: 'json', description: 'Array of phone number objects' },
  addresses: { type: 'json', description: 'Array of address objects' },
  photos: { type: 'json', description: 'Array of photo objects' },
} as const satisfies Record<string, OutputProperty>

/** Company output properties */
export const COMPANY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Company ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  name: { type: 'string', description: 'Company name' },
  legal_name: { type: 'string', description: 'Legal name' },
  doing_business_as_name: { type: 'string', description: 'DBA name' },
  phone: { type: 'string', description: 'Phone number' },
  primary_email: { type: 'string', description: 'Primary email' },
  parent_legal_entity_id: { type: 'string', description: 'Parent legal entity ID' },
  legal_entities_id: { type: 'json', description: 'Array of legal entity IDs' },
  physical_address: { type: 'json', description: 'Physical address of the holding entity' },
} as const satisfies Record<string, OutputProperty>

/** Department output properties */
export const DEPARTMENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Department ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  name: { type: 'string', description: 'Department name' },
  parent_id: { type: 'string', description: 'Parent department ID' },
  reference_code: { type: 'string', description: 'Reference code' },
  department_hierarchy_id: { type: 'json', description: 'Array of department IDs in hierarchy' },
  parent: { type: 'json', description: 'Expanded parent department' },
  department_hierarchy: { type: 'json', description: 'Expanded department hierarchy' },
} as const satisfies Record<string, OutputProperty>

/** Team output properties */
export const TEAM_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Team ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  name: { type: 'string', description: 'Team name' },
  parent_id: { type: 'string', description: 'Parent team ID' },
  parent: { type: 'json', description: 'Expanded parent team' },
} as const satisfies Record<string, OutputProperty>

/** Employment type output properties */
export const EMPLOYMENT_TYPE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Employment type ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  label: { type: 'string', description: 'Employment type label' },
  name: { type: 'string', description: 'Employment type name' },
  type: { type: 'string', description: 'Type (CONTRACTOR, EMPLOYEE)' },
  compensation_time_period: {
    type: 'string',
    description: 'Compensation period (HOURLY, SALARIED)',
  },
  amount_worked: { type: 'string', description: 'Amount worked (PART-TIME, FULL-TIME, TEMPORARY)' },
} as const satisfies Record<string, OutputProperty>

/** Title output properties */
export const TITLE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Title ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  name: { type: 'string', description: 'Title name' },
} as const satisfies Record<string, OutputProperty>

/** Work location output properties */
export const WORK_LOCATION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Work location ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  name: { type: 'string', description: 'Location name' },
  address: { type: 'json', description: 'Address object' },
} as const satisfies Record<string, OutputProperty>

/** Custom field output properties */
export const CUSTOM_FIELD_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Custom field ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  name: { type: 'string', description: 'Field name' },
  description: { type: 'string', description: 'Field description' },
  required: { type: 'boolean', description: 'Whether the field is required' },
  type: { type: 'string', description: 'Field type (TEXT, DATE, NUMBER, CURRENCY, etc.)' },
} as const satisfies Record<string, OutputProperty>

/** Job function output properties */
export const JOB_FUNCTION_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Job function ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  name: { type: 'string', description: 'Job function name' },
} as const satisfies Record<string, OutputProperty>

/** Entitlement output properties */
export const ENTITLEMENT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Entitlement ID' },
  description: { type: 'string', description: 'Entitlement description' },
  display_name: { type: 'string', description: 'Display name' },
} as const satisfies Record<string, OutputProperty>

/** Business partner output properties */
export const BUSINESS_PARTNER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Business partner ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  business_partner_group_id: { type: 'string', description: 'Business partner group ID' },
  worker_id: { type: 'string', description: 'Worker ID' },
  client_group_id: { type: 'string', description: 'Client group ID' },
  client_group_member_count: { type: 'number', description: 'Client group member count' },
} as const satisfies Record<string, OutputProperty>

/** Business partner group output properties */
export const BUSINESS_PARTNER_GROUP_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Business partner group ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  name: { type: 'string', description: 'Group name' },
  domain: { type: 'string', description: 'Domain (HR, IT, FINANCE, RECRUITING, OTHER)' },
  default_business_partner_id: { type: 'string', description: 'Default business partner ID' },
} as const satisfies Record<string, OutputProperty>

/** Supergroup output properties */
export const SUPERGROUP_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Supergroup ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  display_name: { type: 'string', description: 'Display name' },
  description: { type: 'string', description: 'Description' },
  app_owner_id: { type: 'string', description: 'App owner ID' },
  group_type: { type: 'string', description: 'Group type' },
  name: { type: 'string', description: 'Name' },
  sub_group_type: { type: 'string', description: 'Sub group type' },
  read_only: { type: 'boolean', description: 'Whether the group is read only' },
  parent: { type: 'string', description: 'Parent group ID' },
  mutually_exclusive_key: { type: 'string', description: 'Mutually exclusive key' },
  cumulatively_exhaustive_default: {
    type: 'boolean',
    description: 'Whether the group is the cumulatively exhaustive default',
  },
  include_terminated: {
    type: 'boolean',
    description: 'Whether the group includes terminated roles',
  },
  allow_non_employees: {
    type: 'boolean',
    description: 'Whether the group allows non-employees',
  },
  can_override_role_states: {
    type: 'boolean',
    description: 'Whether the group can override role states',
  },
  priority: { type: 'number', description: 'Group priority' },
  is_invisible: { type: 'boolean', description: 'Whether the group is invisible' },
  ignore_prov_group_matching: {
    type: 'boolean',
    description: 'Whether to ignore provisioning group matching',
  },
} as const satisfies Record<string, OutputProperty>

/** Group member output properties */
export const GROUP_MEMBER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Member ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  full_name: { type: 'string', description: 'Full name' },
  work_email: { type: 'string', description: 'Work email' },
  worker_id: { type: 'string', description: 'Worker ID' },
  worker: { type: 'json', description: 'Expanded worker object' },
} as const satisfies Record<string, OutputProperty>

/** Custom object output properties */
export const CUSTOM_OBJECT_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Custom object ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  name: { type: 'string', description: 'Object name' },
  description: { type: 'string', description: 'Description' },
  api_name: { type: 'string', description: 'API name' },
  plural_label: { type: 'string', description: 'Plural label' },
  category_id: { type: 'string', description: 'Category ID' },
  native_category_id: { type: 'string', description: 'Native category ID' },
  managed_package_install_id: { type: 'string', description: 'Package install ID' },
  owner_id: { type: 'string', description: 'Owner ID' },
  enable_history: { type: 'boolean', description: 'Whether history is enabled' },
} as const satisfies Record<string, OutputProperty>

/** Custom object field output properties */
export const CUSTOM_OBJECT_FIELD_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Field ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  name: { type: 'string', description: 'Field name' },
  custom_object: { type: 'string', description: 'Parent custom object' },
  description: { type: 'string', description: 'Description' },
  api_name: { type: 'string', description: 'API name' },
  data_type: { type: 'json', description: 'Data type configuration' },
  is_unique: { type: 'boolean', description: 'Whether the field is unique' },
  is_immutable: { type: 'boolean', description: 'Whether the field is immutable' },
  is_standard: { type: 'boolean', description: 'Whether the field is standard' },
  enable_history: { type: 'boolean', description: 'Whether history is enabled' },
  managed_package_install_id: { type: 'string', description: 'Package install ID' },
} as const satisfies Record<string, OutputProperty>

/** Custom object record output properties */
export const CUSTOM_OBJECT_RECORD_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Record ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  name: { type: 'string', description: 'Record name' },
  external_id: { type: 'string', description: 'External ID' },
  created_by: { type: 'json', description: 'Created by user (id, display_value, image)' },
  last_modified_by: {
    type: 'json',
    description: 'Last modified by user (id, display_value, image)',
  },
  owner_role: { type: 'json', description: 'Owner role (id, display_value, image)' },
  system_updated_at: { type: 'string', description: 'System update timestamp' },
} as const satisfies Record<string, OutputProperty>

/** Custom app output properties */
export const CUSTOM_APP_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'App ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  name: { type: 'string', description: 'App name' },
  api_name: { type: 'string', description: 'API name' },
  description: { type: 'string', description: 'Description' },
  icon: { type: 'string', description: 'Icon URL' },
  pages: { type: 'json', description: 'Array of page summaries' },
} as const satisfies Record<string, OutputProperty>

/** Custom page output properties */
export const CUSTOM_PAGE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Page ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  name: { type: 'string', description: 'Page name' },
  components: { type: 'json', description: 'Page components' },
  actions: { type: 'json', description: 'Page actions' },
  canvas_actions: { type: 'json', description: 'Canvas actions' },
  variables: { type: 'json', description: 'Page variables' },
  media: { type: 'json', description: 'Page media' },
} as const satisfies Record<string, OutputProperty>

/** Custom setting output properties */
export const CUSTOM_SETTING_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Setting ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  display_name: { type: 'string', description: 'Display name' },
  api_name: { type: 'string', description: 'API name' },
  data_type: { type: 'string', description: 'Data type' },
  secret_value: { type: 'string', description: 'Secret value' },
  string_value: { type: 'string', description: 'String value' },
  number_value: { type: 'number', description: 'Number value' },
  boolean_value: { type: 'boolean', description: 'Boolean value' },
} as const satisfies Record<string, OutputProperty>

/** Object category output properties */
export const OBJECT_CATEGORY_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Category ID' },
  created_at: { type: 'string', description: 'Record creation date' },
  updated_at: { type: 'string', description: 'Record update date' },
  name: { type: 'string', description: 'Category name' },
  description: { type: 'string', description: 'Description' },
} as const satisfies Record<string, OutputProperty>

/** Workers */
export interface RipplingListWorkersParams {
  apiKey: string
  filter?: string
  expand?: string
  orderBy?: string
  cursor?: string
}
export interface RipplingGetWorkerParams {
  apiKey: string
  id: string
  expand?: string
}

/** Users */
export interface RipplingListUsersParams {
  apiKey: string
  orderBy?: string
  cursor?: string
}
export interface RipplingGetUserParams {
  apiKey: string
  id: string
}

/** Companies */
export interface RipplingListCompaniesParams {
  apiKey: string
  expand?: string
  orderBy?: string
  cursor?: string
}

/** SSO Me */
export interface RipplingGetCurrentUserParams {
  apiKey: string
  expand?: string
}

/** Entitlements */
export interface RipplingListEntitlementsParams {
  apiKey: string
}

/** Departments */
export interface RipplingListDepartmentsParams {
  apiKey: string
  expand?: string
  orderBy?: string
  cursor?: string
}
export interface RipplingGetDepartmentParams {
  apiKey: string
  id: string
  expand?: string
}
export interface RipplingCreateDepartmentParams {
  apiKey: string
  name: string
  parentId?: string
  referenceCode?: string
}
export interface RipplingUpdateDepartmentParams {
  apiKey: string
  id: string
  name?: string
  parentId?: string
  referenceCode?: string
}

/** Teams */
export interface RipplingListTeamsParams {
  apiKey: string
  expand?: string
  orderBy?: string
  cursor?: string
}
export interface RipplingGetTeamParams {
  apiKey: string
  id: string
  expand?: string
}

/** Employment Types */
export interface RipplingListEmploymentTypesParams {
  apiKey: string
  orderBy?: string
  cursor?: string
}
export interface RipplingGetEmploymentTypeParams {
  apiKey: string
  id: string
}

/** Titles */
export interface RipplingListTitlesParams {
  apiKey: string
  orderBy?: string
  cursor?: string
}
export interface RipplingGetTitleParams {
  apiKey: string
  id: string
}
export interface RipplingCreateTitleParams {
  apiKey: string
  name: string
}
export interface RipplingUpdateTitleParams {
  apiKey: string
  id: string
  name?: string
}
export interface RipplingDeleteTitleParams {
  apiKey: string
  id: string
}

/** Work Locations */
export interface RipplingListWorkLocationsParams {
  apiKey: string
  orderBy?: string
  cursor?: string
}
export interface RipplingGetWorkLocationParams {
  apiKey: string
  id: string
}
export interface RipplingCreateWorkLocationParams {
  apiKey: string
  name: string
  streetAddress: string
  locality?: string
  region?: string
  postalCode?: string
  country?: string
  addressType?: string
}
export interface RipplingUpdateWorkLocationParams {
  apiKey: string
  id: string
  name?: string
  streetAddress?: string
  locality?: string
  region?: string
  postalCode?: string
  country?: string
  addressType?: string
}
export interface RipplingDeleteWorkLocationParams {
  apiKey: string
  id: string
}

/** Custom Fields */
export interface RipplingListCustomFieldsParams {
  apiKey: string
  orderBy?: string
  cursor?: string
}

/** Job Functions */
export interface RipplingListJobFunctionsParams {
  apiKey: string
  orderBy?: string
  cursor?: string
}
export interface RipplingGetJobFunctionParams {
  apiKey: string
  id: string
}

/** Business Partners */
export interface RipplingListBusinessPartnersParams {
  apiKey: string
  filter?: string
  expand?: string
  orderBy?: string
  cursor?: string
}
export interface RipplingGetBusinessPartnerParams {
  apiKey: string
  id: string
  expand?: string
}
export interface RipplingCreateBusinessPartnerParams {
  apiKey: string
  businessPartnerGroupId: string
  workerId: string
}
export interface RipplingDeleteBusinessPartnerParams {
  apiKey: string
  id: string
}

/** Business Partner Groups */
export interface RipplingListBusinessPartnerGroupsParams {
  apiKey: string
  expand?: string
  orderBy?: string
  cursor?: string
}
export interface RipplingGetBusinessPartnerGroupParams {
  apiKey: string
  id: string
  expand?: string
}
export interface RipplingCreateBusinessPartnerGroupParams {
  apiKey: string
  name: string
  domain?: string
  defaultBusinessPartnerId?: string
}
export interface RipplingDeleteBusinessPartnerGroupParams {
  apiKey: string
  id: string
}

/** Supergroups */
export interface RipplingListSupergroupsParams {
  apiKey: string
  filter?: string
  orderBy?: string
}
export interface RipplingGetSupergroupParams {
  apiKey: string
  id: string
}
export interface RipplingListSupergroupMembersParams {
  apiKey: string
  groupId: string
  expand?: string
  orderBy?: string
}
export interface RipplingListSupergroupInclusionMembersParams {
  apiKey: string
  groupId: string
  expand?: string
  orderBy?: string
}
export interface RipplingListSupergroupExclusionMembersParams {
  apiKey: string
  groupId: string
  expand?: string
  orderBy?: string
}
export interface RipplingUpdateSupergroupInclusionMembersParams {
  apiKey: string
  groupId: string
  operations: unknown
}
export interface RipplingUpdateSupergroupExclusionMembersParams {
  apiKey: string
  groupId: string
  operations: unknown
}

/** Custom Objects */
export interface RipplingListCustomObjectsParams {
  apiKey: string
}
export interface RipplingGetCustomObjectParams {
  apiKey: string
  customObjectApiName: string
}
export interface RipplingCreateCustomObjectParams {
  apiKey: string
  name: string
  description?: string
  category?: string
}
export interface RipplingUpdateCustomObjectParams {
  apiKey: string
  customObjectApiName: string
  name?: string
  description?: string
  category?: string
  pluralLabel?: string
  ownerRole?: string
}
export interface RipplingDeleteCustomObjectParams {
  apiKey: string
  customObjectApiName: string
}

/** Custom Object Fields */
export interface RipplingListCustomObjectFieldsParams {
  apiKey: string
  customObjectApiName: string
}
export interface RipplingGetCustomObjectFieldParams {
  apiKey: string
  customObjectApiName: string
  fieldApiName: string
}
export interface RipplingCreateCustomObjectFieldParams {
  apiKey: string
  customObjectApiName: string
  name: string
  description?: string
  dataType: unknown
  required?: boolean
  rqlDefinition?: unknown
  isUnique?: boolean
  formulaAttrMetas?: unknown
  section?: unknown
  enableHistory?: boolean
  derivedFieldFormula?: string
  derivedAggregatedField?: unknown
}
export interface RipplingUpdateCustomObjectFieldParams {
  apiKey: string
  customObjectApiName: string
  fieldApiName: string
  name?: string
  description?: string
  dataType?: unknown
  required?: boolean
  rqlDefinition?: unknown
  isUnique?: boolean
  formulaAttrMetas?: unknown
  section?: unknown
  enableHistory?: boolean
  derivedFieldFormula?: string
  nameFieldDetails?: unknown
}
export interface RipplingDeleteCustomObjectFieldParams {
  apiKey: string
  customObjectApiName: string
  fieldApiName: string
}

/** Custom Object Records */
export interface RipplingListCustomObjectRecordsParams {
  apiKey: string
  customObjectApiName: string
}
export interface RipplingGetCustomObjectRecordParams {
  apiKey: string
  customObjectApiName: string
  codrId: string
}
export interface RipplingGetCustomObjectRecordByExternalIdParams {
  apiKey: string
  customObjectApiName: string
  externalId: string
}
export interface RipplingQueryCustomObjectRecordsParams {
  apiKey: string
  customObjectApiName: string
  query?: string
  limit?: number
  cursor?: string
}
export interface RipplingCreateCustomObjectRecordParams {
  apiKey: string
  customObjectApiName: string
  externalId?: string
  data: unknown
}
export interface RipplingUpdateCustomObjectRecordParams {
  apiKey: string
  customObjectApiName: string
  codrId: string
  externalId?: string
  data?: unknown
}
export interface RipplingDeleteCustomObjectRecordParams {
  apiKey: string
  customObjectApiName: string
  codrId: string
}
export interface RipplingBulkCreateCustomObjectRecordsParams {
  apiKey: string
  customObjectApiName: string
  rowsToWrite: unknown
  allOrNothing?: boolean
}
export interface RipplingBulkUpdateCustomObjectRecordsParams {
  apiKey: string
  customObjectApiName: string
  rowsToUpdate: unknown
  allOrNothing?: boolean
}
export interface RipplingBulkDeleteCustomObjectRecordsParams {
  apiKey: string
  customObjectApiName: string
  rowsToDelete: string[]
  allOrNothing?: boolean
}

/** Custom Apps */
export interface RipplingListCustomAppsParams {
  apiKey: string
}
export interface RipplingGetCustomAppParams {
  apiKey: string
  id: string
}
export interface RipplingCreateCustomAppParams {
  apiKey: string
  name: string
  apiName: string
  description?: string
}
export interface RipplingUpdateCustomAppParams {
  apiKey: string
  id: string
  name?: string
  apiName?: string
  description?: string
}
export interface RipplingDeleteCustomAppParams {
  apiKey: string
  id: string
}

/** Custom Pages */
export interface RipplingListCustomPagesParams {
  apiKey: string
}
export interface RipplingGetCustomPageParams {
  apiKey: string
  id: string
}
export interface RipplingCreateCustomPageParams {
  apiKey: string
  name: string
}
export interface RipplingUpdateCustomPageParams {
  apiKey: string
  id: string
  name?: string
}
export interface RipplingDeleteCustomPageParams {
  apiKey: string
  id: string
}

/** Custom Settings */
export interface RipplingListCustomSettingsParams {
  apiKey: string
  orderBy?: string
  cursor?: string
}
export interface RipplingGetCustomSettingParams {
  apiKey: string
  id: string
}
export interface RipplingCreateCustomSettingParams {
  apiKey: string
  displayName?: string
  apiName?: string
  dataType?: string
  secretValue?: string
  stringValue?: string
  numberValue?: number
  booleanValue?: boolean
}
export interface RipplingUpdateCustomSettingParams {
  apiKey: string
  id: string
  displayName?: string
  apiName?: string
  dataType?: string
  secretValue?: string
  stringValue?: string
  numberValue?: number
  booleanValue?: boolean
}
export interface RipplingDeleteCustomSettingParams {
  apiKey: string
  id: string
}

/** Object Categories */
export interface RipplingListObjectCategoriesParams {
  apiKey: string
}
export interface RipplingGetObjectCategoryParams {
  apiKey: string
  id: string
}
export interface RipplingCreateObjectCategoryParams {
  apiKey: string
  name: string
  description?: string
}
export interface RipplingUpdateObjectCategoryParams {
  apiKey: string
  id: string
  name?: string
  description?: string
}
export interface RipplingDeleteObjectCategoryParams {
  apiKey: string
  id: string
}

/** Report Runs */
export interface RipplingGetReportRunParams {
  apiKey: string
  runId: string
}
export interface RipplingTriggerReportRunParams {
  apiKey: string
  reportId: string
  includeObjectIds?: boolean
  includeTotalRows?: boolean
  formatDateFields?: unknown
  formatCurrencyFields?: unknown
  outputType?: string
}

/** Draft Hires */
export interface RipplingCreateDraftHiresParams {
  apiKey: string
  draftHires: unknown
}
