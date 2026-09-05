import {
  ACCOUNT_OUTPUT_PROPERTIES,
  ACTIVITY_CONTACT_OUTPUT_PROPERTIES,
  ACTIVITY_OUTPUT_PROPERTIES,
  ASSIGNEE_OUTPUT_PROPERTIES,
  CONTACT_OUTPUT_PROPERTIES,
  DUPLICATE_ACCOUNT_OUTPUT_PROPERTIES,
  DUPLICATE_CONTACT_OUTPUT_PROPERTIES,
  LEAD_OUTPUT_PROPERTIES,
  OPPORTUNITY_CONTACT_OUTPUT_PROPERTIES,
  OPPORTUNITY_OUTPUT_PROPERTIES,
  type OracleFusionSalesResponse,
  RESOURCE_OUTPUT_PROPERTIES,
  REVENUE_OUTPUT_PROPERTIES,
  TEAM_MEMBER_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_sales/types'
import type { InternalToolConfig, OAuthConfig, OutputProperty, ToolConfig } from '@/tools/types'

export const ORACLE_FUSION_SALES_OAUTH_CONFIG = {
  required: true,
  provider: 'oracle_fusion_sales',
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
} as const satisfies OAuthConfig

export type OracleFusionSalesFieldKind =
  | 'string'
  | 'id'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'text'
  | 'date'
  | 'datetime'

export interface OracleFusionSalesField {
  oracle: string
  param: string
  kind: OracleFusionSalesFieldKind
  nullable: boolean
  max?: number
  update: boolean
}

export interface OracleFusionSalesEntity {
  resource: string
  keyParam: string
  publicKey: string | null
  parentParam?: string
  fields: readonly OracleFusionSalesField[]
  outputProperties: Record<string, OutputProperty>
}

export interface OracleFusionSalesOperation {
  entity: string
  kind: 'list' | 'get' | 'create' | 'update' | 'delete' | 'action' | 'duplicates'
  required: readonly string[]
  action?: string
  functionCode?: 'TASK' | 'APPOINTMENT' | 'CALLREPORT'
}

/** CRM 11.13.18.05 fields, verified separately against each operation's response schema. */
export const ORACLE_FUSION_SALES_ENTITIES: Record<string, OracleFusionSalesEntity> = {
  account: {
    resource: 'accounts',
    keyParam: 'accountNumber',
    publicKey: 'PartyNumber',
    fields: [
      {
        oracle: 'OrganizationName',
        param: 'organizationName',
        kind: 'string',
        nullable: false,
        max: 360,
        update: true,
      },
      {
        oracle: 'Type',
        param: 'accountType',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'Description',
        param: 'description',
        kind: 'string',
        nullable: true,
        max: 2000,
        update: true,
      },
      {
        oracle: 'EmailAddress',
        param: 'emailAddress',
        kind: 'string',
        nullable: true,
        max: 320,
        update: true,
      },
      {
        oracle: 'URL',
        param: 'website',
        kind: 'string',
        nullable: true,
        max: 2000,
        update: true,
      },
      {
        oracle: 'PhoneNumber',
        param: 'phoneNumber',
        kind: 'string',
        nullable: true,
        max: 40,
        update: true,
      },
      {
        oracle: 'PhoneCountryCode',
        param: 'phoneCountryCode',
        kind: 'string',
        nullable: true,
        max: 10,
        update: true,
      },
      {
        oracle: 'PhoneAreaCode',
        param: 'phoneAreaCode',
        kind: 'string',
        nullable: true,
        max: 20,
        update: true,
      },
      {
        oracle: 'OwnerPartyId',
        param: 'ownerId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'ParentAccountPartyId',
        param: 'parentAccountId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'PrimaryContactPartyId',
        param: 'contactId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'AddressLine1',
        param: 'addressLine1',
        kind: 'string',
        nullable: true,
        max: 240,
        update: true,
      },
      {
        oracle: 'AddressLine2',
        param: 'addressLine2',
        kind: 'string',
        nullable: true,
        max: 240,
        update: true,
      },
      {
        oracle: 'City',
        param: 'city',
        kind: 'string',
        nullable: true,
        max: 60,
        update: true,
      },
      {
        oracle: 'State',
        param: 'state',
        kind: 'string',
        nullable: true,
        max: 60,
        update: true,
      },
      {
        oracle: 'PostalCode',
        param: 'postalCode',
        kind: 'string',
        nullable: true,
        max: 60,
        update: true,
      },
      {
        oracle: 'Country',
        param: 'country',
        kind: 'string',
        nullable: false,
        max: 2,
        update: true,
      },
    ],
    outputProperties: ACCOUNT_OUTPUT_PROPERTIES,
  },
  contact: {
    resource: 'contacts',
    keyParam: 'contactNumber',
    publicKey: 'PartyNumber',
    fields: [
      {
        oracle: 'FirstName',
        param: 'firstName',
        kind: 'string',
        nullable: true,
        max: 150,
        update: true,
      },
      {
        oracle: 'LastName',
        param: 'lastName',
        kind: 'string',
        nullable: true,
        max: 150,
        update: true,
      },
      {
        oracle: 'EmailAddress',
        param: 'emailAddress',
        kind: 'string',
        nullable: true,
        max: 320,
        update: true,
      },
      {
        oracle: 'AccountPartyId',
        param: 'accountId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'OwnerPartyId',
        param: 'ownerId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'JobTitle',
        param: 'jobTitle',
        kind: 'string',
        nullable: true,
        max: 100,
        update: true,
      },
      {
        oracle: 'Department',
        param: 'department',
        kind: 'string',
        nullable: true,
        max: 60,
        update: true,
      },
      {
        oracle: 'WorkPhoneNumber',
        param: 'workPhoneNumber',
        kind: 'string',
        nullable: true,
        max: 40,
        update: true,
      },
      {
        oracle: 'MobileNumber',
        param: 'mobileNumber',
        kind: 'string',
        nullable: true,
        max: 40,
        update: true,
      },
      {
        oracle: 'AddressLine1',
        param: 'addressLine1',
        kind: 'string',
        nullable: true,
        max: 240,
        update: true,
      },
      {
        oracle: 'City',
        param: 'city',
        kind: 'string',
        nullable: true,
        max: 60,
        update: true,
      },
      {
        oracle: 'State',
        param: 'state',
        kind: 'string',
        nullable: true,
        max: 60,
        update: true,
      },
      {
        oracle: 'PostalCode',
        param: 'postalCode',
        kind: 'string',
        nullable: true,
        max: 60,
        update: true,
      },
      {
        oracle: 'Country',
        param: 'country',
        kind: 'string',
        nullable: false,
        max: 2,
        update: true,
      },
      {
        oracle: 'DoNotEmailFlag',
        param: 'doNotEmailFlag',
        kind: 'boolean',
        nullable: true,
        update: true,
      },
      {
        oracle: 'DoNotCallFlag',
        param: 'doNotCallFlag',
        kind: 'boolean',
        nullable: true,
        update: true,
      },
    ],
    outputProperties: CONTACT_OUTPUT_PROPERTIES,
  },
  lead: {
    resource: 'leads',
    keyParam: 'leadKey',
    publicKey: null,
    fields: [
      {
        oracle: 'Name',
        param: 'name',
        kind: 'string',
        nullable: false,
        max: 250,
        update: true,
      },
      {
        oracle: 'Description',
        param: 'description',
        kind: 'string',
        nullable: true,
        max: 2000,
        update: true,
      },
      {
        oracle: 'CustomerId',
        param: 'accountId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'OwnerId',
        param: 'ownerId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'PrimaryContactId',
        param: 'contactId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'StatusCode',
        param: 'statusCode',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'Rank',
        param: 'rank',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'SourceCode',
        param: 'sourceCode',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'BudgetAmount',
        param: 'budgetAmount',
        kind: 'number',
        nullable: true,
        update: true,
      },
      {
        oracle: 'BudgetCurrencyCode',
        param: 'budgetCurrencyCode',
        kind: 'string',
        nullable: true,
        max: 80,
        update: true,
      },
      {
        oracle: 'DealAmount',
        param: 'dealAmount',
        kind: 'number',
        nullable: true,
        update: true,
      },
      {
        oracle: 'CurrencyCode',
        param: 'currencyCode',
        kind: 'string',
        nullable: true,
        max: 15,
        update: true,
      },
      {
        oracle: 'EstimatedCloseDate',
        param: 'estimatedCloseDate',
        kind: 'date',
        nullable: true,
        update: true,
      },
      {
        oracle: 'CustomerNeed',
        param: 'customerNeed',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'PrimaryContactPersonFirstName',
        param: 'contactFirstName',
        kind: 'string',
        nullable: true,
        max: 150,
        update: true,
      },
      {
        oracle: 'PrimaryContactPersonLastName',
        param: 'contactLastName',
        kind: 'string',
        nullable: true,
        max: 150,
        update: true,
      },
      {
        oracle: 'PrimaryContactEmailAddress',
        param: 'contactEmail',
        kind: 'string',
        nullable: true,
        max: 320,
        update: true,
      },
    ],
    outputProperties: LEAD_OUTPUT_PROPERTIES,
  },
  opportunity: {
    resource: 'opportunities',
    keyParam: 'opportunityNumber',
    publicKey: 'OptyNumber',
    fields: [
      {
        oracle: 'Name',
        param: 'name',
        kind: 'string',
        nullable: false,
        max: 275,
        update: true,
      },
      {
        oracle: 'Description',
        param: 'description',
        kind: 'string',
        nullable: true,
        max: 2000,
        update: true,
      },
      {
        oracle: 'TargetPartyId',
        param: 'accountId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'OwnerResourcePartyId',
        param: 'ownerId',
        kind: 'id',
        nullable: false,
        update: true,
      },
      {
        oracle: 'KeyContactId',
        param: 'contactId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'CurrencyCode',
        param: 'currencyCode',
        kind: 'string',
        nullable: false,
        max: 15,
        update: true,
      },
      {
        oracle: 'PrimaryOrganizationId',
        param: 'businessUnitId',
        kind: 'id',
        nullable: false,
        update: true,
      },
      {
        oracle: 'SalesMethodId',
        param: 'salesMethodId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'SalesStageId',
        param: 'salesStageId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'StatusCode',
        param: 'statusCode',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'ReasonWonLostCode',
        param: 'reasonWonLostCode',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'EffectiveDate',
        param: 'closeDate',
        kind: 'date',
        nullable: true,
        update: true,
      },
      {
        oracle: 'Revenue',
        param: 'revenue',
        kind: 'number',
        nullable: true,
        update: true,
      },
      {
        oracle: 'WinProb',
        param: 'winProbability',
        kind: 'integer',
        nullable: true,
        update: true,
      },
      {
        oracle: 'Comments',
        param: 'comments',
        kind: 'string',
        nullable: true,
        max: 2000,
        update: true,
      },
    ],
    outputProperties: OPPORTUNITY_OUTPUT_PROPERTIES,
  },
  activity: {
    resource: 'activities',
    keyParam: 'activityNumber',
    publicKey: 'ActivityNumber',
    fields: [
      {
        oracle: 'Subject',
        param: 'subject',
        kind: 'string',
        nullable: false,
        max: 500,
        update: true,
      },
      {
        oracle: 'ActivityDescription',
        param: 'description',
        kind: 'text',
        nullable: true,
        update: true,
      },
      {
        oracle: 'ActivityMtgMinutes',
        param: 'meetingMinutes',
        kind: 'text',
        nullable: true,
        update: true,
      },
      {
        oracle: 'ActivityStartDate',
        param: 'startDateTime',
        kind: 'datetime',
        nullable: true,
        update: true,
      },
      {
        oracle: 'ActivityEndDate',
        param: 'endDateTime',
        kind: 'datetime',
        nullable: true,
        update: true,
      },
      {
        oracle: 'DueDate',
        param: 'dueDate',
        kind: 'date',
        nullable: true,
        update: true,
      },
      {
        oracle: 'OwnerId',
        param: 'ownerId',
        kind: 'id',
        nullable: false,
        update: true,
      },
      {
        oracle: 'AccountId',
        param: 'accountId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'OpportunityId',
        param: 'opportunityId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'LeadId',
        param: 'leadId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'PrimaryContactId',
        param: 'contactId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'ActivityTypeCode',
        param: 'activityTypeCode',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'StatusCode',
        param: 'statusCode',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'PriorityCode',
        param: 'priorityCode',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'Location',
        param: 'location',
        kind: 'string',
        nullable: true,
        max: 200,
        update: true,
      },
      {
        oracle: 'PercentageComplete',
        param: 'percentageComplete',
        kind: 'number',
        nullable: true,
        update: true,
      },
      {
        oracle: 'AllDayFlag',
        param: 'allDayFlag',
        kind: 'boolean',
        nullable: true,
        update: true,
      },
      {
        oracle: 'PrivateFlag',
        param: 'privateFlag',
        kind: 'boolean',
        nullable: true,
        update: true,
      },
    ],
    outputProperties: ACTIVITY_OUTPUT_PROPERTIES,
  },
  resource: {
    resource: 'resources',
    keyParam: 'resourceNumber',
    publicKey: 'PartyNumber',
    fields: [],
    outputProperties: RESOURCE_OUTPUT_PROPERTIES,
  },
  opportunityContact: {
    resource: 'OpportunityContact',
    keyParam: 'opportunityContactId',
    publicKey: 'OptyConId',
    parentParam: 'opportunityNumber',
    fields: [
      {
        oracle: 'PERPartyId',
        param: 'contactId',
        kind: 'id',
        nullable: false,
        update: true,
      },
      {
        oracle: 'PrimaryFlg',
        param: 'primaryFlag',
        kind: 'string',
        nullable: true,
        update: true,
      },
      {
        oracle: 'RoleCd',
        param: 'roleCode',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'InfluenceLvlCd',
        param: 'influenceCode',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'AffinityLvlCd',
        param: 'affinityCode',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'ContactedFlg',
        param: 'contactedFlag',
        kind: 'string',
        nullable: true,
        max: 1,
        update: true,
      },
      {
        oracle: 'Comments',
        param: 'comments',
        kind: 'string',
        nullable: true,
        max: 255,
        update: true,
      },
      {
        oracle: 'RelationshipId',
        param: 'relationshipId',
        kind: 'id',
        nullable: true,
        update: true,
      },
    ],
    outputProperties: OPPORTUNITY_CONTACT_OUTPUT_PROPERTIES,
  },
  revenue: {
    resource: 'ChildRevenue',
    keyParam: 'revenueKey',
    publicKey: null,
    parentParam: 'opportunityNumber',
    fields: [
      {
        oracle: 'ProdGroupId',
        param: 'productGroupId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'InventoryItemId',
        param: 'inventoryItemId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'InventoryOrgId',
        param: 'inventoryOrganizationId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'Quantity',
        param: 'quantity',
        kind: 'number',
        nullable: true,
        update: true,
      },
      {
        oracle: 'UnitPrice',
        param: 'unitPrice',
        kind: 'number',
        nullable: true,
        update: true,
      },
      {
        oracle: 'RevnAmount',
        param: 'revenue',
        kind: 'number',
        nullable: true,
        update: true,
      },
      {
        oracle: 'RevnAmountCurcyCode',
        param: 'currencyCode',
        kind: 'string',
        nullable: false,
        max: 15,
        update: true,
      },
      {
        oracle: 'ResourcePartyId',
        param: 'ownerId',
        kind: 'id',
        nullable: true,
        update: true,
      },
      {
        oracle: 'EffectiveDate',
        param: 'closeDate',
        kind: 'date',
        nullable: true,
        update: true,
      },
      {
        oracle: 'StatusCode',
        param: 'statusCode',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'WinProb',
        param: 'winProbability',
        kind: 'integer',
        nullable: true,
        update: true,
      },
      {
        oracle: 'Description',
        param: 'description',
        kind: 'string',
        nullable: true,
        max: 240,
        update: true,
      },
      {
        oracle: 'Comments',
        param: 'comments',
        kind: 'string',
        nullable: true,
        max: 250,
        update: true,
      },
    ],
    outputProperties: REVENUE_OUTPUT_PROPERTIES,
  },
  teamMember: {
    resource: 'OpportunityResource',
    keyParam: 'teamMemberKey',
    publicKey: null,
    parentParam: 'opportunityNumber',
    fields: [
      {
        oracle: 'ResourceId',
        param: 'ownerId',
        kind: 'id',
        nullable: false,
        update: false,
      },
      {
        oracle: 'AccessLevelCode',
        param: 'accessLevelCode',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'MemberFunctionCode',
        param: 'memberFunctionCode',
        kind: 'string',
        nullable: true,
        max: 30,
        update: true,
      },
      {
        oracle: 'LockAssignmentFlag',
        param: 'lockAssignmentFlag',
        kind: 'boolean',
        nullable: true,
        update: true,
      },
      {
        oracle: 'OwnerFlag',
        param: 'ownerFlag',
        kind: 'boolean',
        nullable: true,
        update: true,
      },
    ],
    outputProperties: TEAM_MEMBER_OUTPUT_PROPERTIES,
  },
  assignee: {
    resource: 'ActivityAssignee',
    keyParam: 'assigneeKey',
    publicKey: null,
    parentParam: 'activityNumber',
    fields: [
      {
        oracle: 'AssigneeId',
        param: 'ownerId',
        kind: 'id',
        nullable: false,
        update: false,
      },
      {
        oracle: 'AttendeeFlag',
        param: 'attendeeFlag',
        kind: 'boolean',
        nullable: true,
        update: true,
      },
    ],
    outputProperties: ASSIGNEE_OUTPUT_PROPERTIES,
  },
  activityContact: {
    resource: 'ActivityContact',
    keyParam: 'activityContactKey',
    publicKey: null,
    parentParam: 'activityNumber',
    fields: [
      {
        oracle: 'ContactId',
        param: 'contactId',
        kind: 'id',
        nullable: false,
        update: false,
      },
      {
        oracle: 'AttendeeFlag',
        param: 'attendeeFlag',
        kind: 'boolean',
        nullable: true,
        update: true,
      },
      {
        oracle: 'PrimaryContactFlag',
        param: 'primaryContactFlag',
        kind: 'boolean',
        nullable: true,
        update: true,
      },
    ],
    outputProperties: ACTIVITY_CONTACT_OUTPUT_PROPERTIES,
  },
}

export const ORACLE_FUSION_SALES_OPERATIONS: Record<string, OracleFusionSalesOperation> = {
  accept_lead: {
    entity: 'lead',
    kind: 'action',
    required: [],
    action: 'acceptLead',
  },
  add_activity_assignee: {
    entity: 'assignee',
    kind: 'create',
    required: ['ownerId'],
  },
  add_activity_contact: {
    entity: 'activityContact',
    kind: 'create',
    required: ['contactId'],
  },
  add_opportunity_contact: {
    entity: 'opportunityContact',
    kind: 'create',
    required: ['contactId'],
  },
  add_opportunity_team_member: {
    entity: 'teamMember',
    kind: 'create',
    required: ['ownerId'],
  },
  assign_account: {
    entity: 'account',
    kind: 'action',
    required: [],
    action: 'runAssignment',
  },
  assign_lead: {
    entity: 'lead',
    kind: 'action',
    required: [],
    action: 'runAssignment',
  },
  assign_opportunity: {
    entity: 'opportunity',
    kind: 'action',
    required: [],
    action: 'assignOpportunity',
  },
  convert_lead: {
    entity: 'lead',
    kind: 'action',
    required: [],
    action: 'convertLeadToOpty',
  },
  create_account: {
    entity: 'account',
    kind: 'create',
    required: ['organizationName'],
  },
  create_appointment: {
    entity: 'activity',
    kind: 'create',
    required: ['subject', 'startDateTime', 'endDateTime'],
    functionCode: 'APPOINTMENT',
  },
  create_call_report: {
    entity: 'activity',
    kind: 'create',
    required: ['subject', 'startDateTime', 'endDateTime'],
    functionCode: 'CALLREPORT',
  },
  create_contact: {
    entity: 'contact',
    kind: 'create',
    required: [],
  },
  create_lead: {
    entity: 'lead',
    kind: 'create',
    required: ['name'],
  },
  create_opportunity: {
    entity: 'opportunity',
    kind: 'create',
    required: ['name'],
  },
  create_opportunity_revenue: {
    entity: 'revenue',
    kind: 'create',
    required: [],
  },
  create_task: {
    entity: 'activity',
    kind: 'create',
    required: ['subject'],
    functionCode: 'TASK',
  },
  delete_account: {
    entity: 'account',
    kind: 'delete',
    required: [],
  },
  delete_activity: {
    entity: 'activity',
    kind: 'delete',
    required: [],
  },
  delete_contact: {
    entity: 'contact',
    kind: 'delete',
    required: [],
  },
  delete_lead: {
    entity: 'lead',
    kind: 'delete',
    required: [],
  },
  delete_opportunity: {
    entity: 'opportunity',
    kind: 'delete',
    required: [],
  },
  delete_opportunity_revenue: {
    entity: 'revenue',
    kind: 'delete',
    required: [],
  },
  find_duplicate_accounts: {
    entity: 'account',
    kind: 'duplicates',
    required: [],
    action: 'findDuplicates',
  },
  find_duplicate_contacts: {
    entity: 'contact',
    kind: 'duplicates',
    required: [],
    action: 'findDuplicates',
  },
  get_account: {
    entity: 'account',
    kind: 'get',
    required: [],
  },
  get_activity: {
    entity: 'activity',
    kind: 'get',
    required: [],
  },
  get_contact: {
    entity: 'contact',
    kind: 'get',
    required: [],
  },
  get_lead: {
    entity: 'lead',
    kind: 'get',
    required: [],
  },
  get_opportunity: {
    entity: 'opportunity',
    kind: 'get',
    required: [],
  },
  get_sales_resource: {
    entity: 'resource',
    kind: 'get',
    required: [],
  },
  list_accounts: {
    entity: 'account',
    kind: 'list',
    required: [],
  },
  list_activities: {
    entity: 'activity',
    kind: 'list',
    required: [],
  },
  list_activity_assignees: {
    entity: 'assignee',
    kind: 'list',
    required: [],
  },
  list_activity_contacts: {
    entity: 'activityContact',
    kind: 'list',
    required: [],
  },
  list_contacts: {
    entity: 'contact',
    kind: 'list',
    required: [],
  },
  list_leads: {
    entity: 'lead',
    kind: 'list',
    required: [],
  },
  list_opportunities: {
    entity: 'opportunity',
    kind: 'list',
    required: [],
  },
  list_opportunity_contacts: {
    entity: 'opportunityContact',
    kind: 'list',
    required: [],
  },
  list_opportunity_revenue: {
    entity: 'revenue',
    kind: 'list',
    required: [],
  },
  list_opportunity_team: {
    entity: 'teamMember',
    kind: 'list',
    required: [],
  },
  list_sales_resources: {
    entity: 'resource',
    kind: 'list',
    required: [],
  },
  reject_lead: {
    entity: 'lead',
    kind: 'action',
    required: [],
    action: 'rejectLead',
  },
  remove_activity_assignee: {
    entity: 'assignee',
    kind: 'delete',
    required: [],
  },
  remove_activity_contact: {
    entity: 'activityContact',
    kind: 'delete',
    required: [],
  },
  remove_opportunity_contact: {
    entity: 'opportunityContact',
    kind: 'delete',
    required: [],
  },
  remove_opportunity_team_member: {
    entity: 'teamMember',
    kind: 'delete',
    required: [],
  },
  update_account: {
    entity: 'account',
    kind: 'update',
    required: [],
  },
  update_activity: {
    entity: 'activity',
    kind: 'update',
    required: [],
  },
  update_contact: {
    entity: 'contact',
    kind: 'update',
    required: [],
  },
  update_lead: {
    entity: 'lead',
    kind: 'update',
    required: [],
  },
  update_opportunity: {
    entity: 'opportunity',
    kind: 'update',
    required: [],
  },
  update_opportunity_contact: {
    entity: 'opportunityContact',
    kind: 'update',
    required: [],
  },
  update_opportunity_revenue: {
    entity: 'revenue',
    kind: 'update',
    required: [],
  },
  update_opportunity_team_member: {
    entity: 'teamMember',
    kind: 'update',
    required: [],
  },
}

export const oracleFusionSalesAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Oracle Fusion service-account credential',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Basic authentication value injected from the selected credential',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Credential-authoritative Fusion Applications origin',
  },
} as const satisfies ToolConfig['params']

const stringParam = (description: string, required = false) => ({
  type: 'string' as const,
  required,
  visibility: 'user-or-llm' as const,
  description,
})

export const oracleFusionSalesPageParams = {
  q: stringParam('Documented Oracle q filter, up to 2,048 characters'),
  finder: stringParam('Documented Oracle finder and bind parameters, up to 2,048 characters'),
  orderBy: stringParam(
    'Oracle attribute names with optional :asc or :desc, up to 1,024 characters'
  ),
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    default: 50,
    description: 'Records in this page (1-100; default 50)',
  },
  offset: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    default: 0,
    description: 'Non-negative safe integer offset; default 0',
  },
  totalResults: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    default: false,
    description: 'Request the estimated total matching record count',
  },
} satisfies ToolConfig['params']

/** Duplicate actions document string-valued candidate maps, not full CRUD records. */
export function getOracleFusionSalesDuplicateOutputs(
  entity: string
): Record<string, OutputProperty> {
  return entity === 'account'
    ? DUPLICATE_ACCOUNT_OUTPUT_PROPERTIES
    : DUPLICATE_CONTACT_OUTPUT_PROPERTIES
}

export function getOracleFusionSalesOperation(name: string): OracleFusionSalesOperation {
  if (!Object.hasOwn(ORACLE_FUSION_SALES_OPERATIONS, name)) {
    throw new Error('Unsupported Oracle Fusion Sales operation')
  }
  return ORACLE_FUSION_SALES_OPERATIONS[name]
}

/** Browser-safe parameter declarations; all value parsing happens after variable resolution. */
export function getOracleFusionSalesParams(name: string): ToolConfig['params'] {
  const operation = getOracleFusionSalesOperation(name)
  const entity = ORACLE_FUSION_SALES_ENTITIES[operation.entity]
  const params: ToolConfig['params'] = { ...oracleFusionSalesAuthParams }
  if (entity.parentParam) {
    params[entity.parentParam] = stringParam(
      'Parent Oracle public number, not its numeric ID',
      true
    )
  }
  if (['get', 'update', 'delete'].includes(operation.kind)) {
    params[entity.keyParam] = stringParam(
      entity.publicKey
        ? `Oracle ${entity.publicKey} returned by the corresponding list tool; preserve as a string`
        : 'Opaque resourceKey returned by the corresponding list tool; never construct it from an ID',
      true
    )
  }
  if (operation.kind === 'list') Object.assign(params, oracleFusionSalesPageParams)
  if (operation.kind === 'create' || operation.kind === 'update') {
    for (const field of entity.fields) {
      if (operation.kind === 'update' && !field.update) continue
      params[field.param] = {
        type: ['number', 'integer'].includes(field.kind)
          ? 'number'
          : field.kind === 'boolean'
            ? 'boolean'
            : 'string',
        required: operation.required.includes(field.param),
        visibility: 'user-or-llm',
        description: `${field.oracle}${field.kind === 'id' ? ' as an exact decimal string' : ''}${field.kind === 'text' ? ' as plain text (CLOB representation in REST framework 9)' : ''}${field.kind === 'date' ? ' (YYYY-MM-DD)' : ''}${field.kind === 'datetime' ? ' (ISO 8601 date-time with timezone)' : ''}${field.nullable && !operation.required.includes(field.param) ? '; null clears this field' : ''}`,
      }
    }
  }
  if (operation.kind === 'action') {
    const key = operation.entity === 'lead' ? 'leadId' : entity.keyParam
    params[key] = stringParam(
      operation.entity === 'lead'
        ? 'Numeric LeadId as an exact decimal string, not the opaque resource key'
        : 'Oracle public number returned by the corresponding list tool',
      true
    )
    if (name === 'reject_lead') {
      params.reason = stringParam('Tenant-configured lead rejection reason code')
      params.comments = stringParam('Lead rejection comments')
    }
    if (name === 'convert_lead') {
      params.opportunityName = stringParam('Name for the resulting opportunity')
      params.opportunityOwnerNumber = stringParam('Resource PartyNumber of the opportunity owner')
      params.attributeMap = {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Documented conversion attribute name/value map; every value must be a string',
      }
    }
  }
  if (operation.kind === 'duplicates') {
    params.matchingFields = {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Data Quality matching field/value map; use Oracle field names and string values',
    }
    if (operation.entity === 'contact') {
      params.accountNumber = stringParam('Related account PartyNumber used to narrow matching')
    }
  }
  return params
}

/** Keeps inactive block fields and executor controls outside the strict Sales input schema. */
export function createOracleFusionSalesTool<Params extends object>(definition: {
  id: string
  operation: string
  name: string
  description: string
  outputs: Record<string, OutputProperty>
}): InternalToolConfig<Params, OracleFusionSalesResponse> {
  const params = getOracleFusionSalesParams(definition.operation)
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    version: '1.0.0',
    oauth: ORACLE_FUSION_SALES_OAUTH_CONFIG,
    params,
    operation: {
      input: (values) => {
        const source = values as Record<string, unknown>
        return Object.fromEntries(
          Object.keys(params)
            .filter((key) => source[key] !== undefined)
            .map((key) => [key, source[key]])
        )
      },
    },
    outputs: definition.outputs,
  }
}
