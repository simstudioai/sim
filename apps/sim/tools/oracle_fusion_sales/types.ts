import type { OutputProperty, ToolResponse } from '@/tools/types'

/** Documented CRM 11.13.18.05 outputs, adjusted for REST framework 9 wire types. */
export const ACCOUNT_OUTPUT_PROPERTIES = {
  PartyId: {
    type: 'string',
    description: 'Party Id as a decimal string',
    optional: true,
    nullable: true,
  },
  PartyNumber: {
    type: 'string',
    description: 'Party Number',
    optional: true,
    nullable: true,
  },
  OrganizationName: {
    type: 'string',
    description: 'Organization Name',
    optional: true,
    nullable: true,
  },
  Type: {
    type: 'string',
    description: 'Type',
    optional: true,
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    optional: true,
    nullable: true,
  },
  EmailAddress: {
    type: 'string',
    description: 'Email Address',
    optional: true,
    nullable: true,
  },
  URL: {
    type: 'string',
    description: 'URL',
    optional: true,
    nullable: true,
  },
  PhoneNumber: {
    type: 'string',
    description: 'Phone Number',
    optional: true,
    nullable: true,
  },
  OwnerPartyId: {
    type: 'string',
    description: 'Owner Party Id as a decimal string',
    optional: true,
    nullable: true,
  },
  OwnerName: {
    type: 'string',
    description: 'Owner Name',
    optional: true,
    nullable: true,
  },
  ParentAccountPartyId: {
    type: 'string',
    description: 'Parent Account Party Id as a decimal string',
    optional: true,
    nullable: true,
  },
  PrimaryContactPartyId: {
    type: 'string',
    description: 'Primary Contact Party Id as a decimal string',
    optional: true,
    nullable: true,
  },
  AddressLine1: {
    type: 'string',
    description: 'Address Line1',
    optional: true,
    nullable: true,
  },
  AddressLine2: {
    type: 'string',
    description: 'Address Line2',
    optional: true,
    nullable: true,
  },
  City: {
    type: 'string',
    description: 'City',
    optional: true,
    nullable: true,
  },
  State: {
    type: 'string',
    description: 'State',
    optional: true,
    nullable: true,
  },
  PostalCode: {
    type: 'string',
    description: 'Postal Code',
    optional: true,
    nullable: true,
  },
  Country: {
    type: 'string',
    description: 'Country',
    optional: true,
    nullable: true,
  },
  SalesProfileStatus: {
    type: 'string',
    description: 'Sales Profile Status',
    optional: true,
    nullable: true,
  },
  CreationDate: {
    type: 'string',
    description: 'Creation Date',
    optional: true,
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'Last Update Date',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const CONTACT_OUTPUT_PROPERTIES = {
  PartyId: {
    type: 'string',
    description: 'Party Id as a decimal string',
    optional: true,
    nullable: true,
  },
  PartyNumber: {
    type: 'string',
    description: 'Party Number',
    optional: true,
    nullable: true,
  },
  ContactName: {
    type: 'string',
    description: 'Contact Name',
    optional: true,
    nullable: true,
  },
  FirstName: {
    type: 'string',
    description: 'First Name',
    optional: true,
    nullable: true,
  },
  LastName: {
    type: 'string',
    description: 'Last Name',
    optional: true,
    nullable: true,
  },
  EmailAddress: {
    type: 'string',
    description: 'Email Address',
    optional: true,
    nullable: true,
  },
  AccountPartyId: {
    type: 'string',
    description: 'Account Party Id as a decimal string',
    optional: true,
    nullable: true,
  },
  AccountPartyNumber: {
    type: 'string',
    description: 'Account Party Number',
    optional: true,
    nullable: true,
  },
  AccountName: {
    type: 'string',
    description: 'Account Name',
    optional: true,
    nullable: true,
  },
  OwnerPartyId: {
    type: 'string',
    description: 'Owner Party Id as a decimal string',
    optional: true,
    nullable: true,
  },
  OwnerName: {
    type: 'string',
    description: 'Owner Name',
    optional: true,
    nullable: true,
  },
  JobTitle: {
    type: 'string',
    description: 'Job Title',
    optional: true,
    nullable: true,
  },
  Department: {
    type: 'string',
    description: 'Department',
    optional: true,
    nullable: true,
  },
  WorkPhoneNumber: {
    type: 'string',
    description: 'Work Phone Number',
    optional: true,
    nullable: true,
  },
  MobileNumber: {
    type: 'string',
    description: 'Mobile Number',
    optional: true,
    nullable: true,
  },
  DoNotEmailFlag: {
    type: 'boolean',
    description: 'Do Not Email Flag',
    optional: true,
    nullable: true,
  },
  DoNotCallFlag: {
    type: 'boolean',
    description: 'Do Not Call Flag',
    optional: true,
    nullable: true,
  },
  CreationDate: {
    type: 'string',
    description: 'Creation Date',
    optional: true,
    nullable: true,
  },
  LastUpdateDate: {
    type: 'string',
    description: 'Last Update Date',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const LEAD_OUTPUT_PROPERTIES = {
  resourceKey: { type: 'string', description: 'Opaque resource key from Oracle self link' },
  LeadId: {
    type: 'string',
    description: 'Lead Id as a decimal string',
    optional: true,
    nullable: true,
  },
  LeadNumber: {
    type: 'string',
    description: 'Lead Number',
    optional: true,
    nullable: true,
  },
  Name: {
    type: 'string',
    description: 'Name',
    optional: true,
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    optional: true,
    nullable: true,
  },
  CustomerId: {
    type: 'string',
    description: 'Customer Id as a decimal string',
    optional: true,
    nullable: true,
  },
  CustomerPartyName: {
    type: 'string',
    description: 'Customer Party Name',
    optional: true,
    nullable: true,
  },
  OwnerId: {
    type: 'string',
    description: 'Owner Id as a decimal string',
    optional: true,
    nullable: true,
  },
  OwnerPartyName: {
    type: 'string',
    description: 'Owner Party Name',
    optional: true,
    nullable: true,
  },
  PrimaryContactId: {
    type: 'string',
    description: 'Primary Contact Id as a decimal string',
    optional: true,
    nullable: true,
  },
  PrimaryContactPartyName: {
    type: 'string',
    description: 'Primary Contact Party Name',
    optional: true,
    nullable: true,
  },
  StatusCode: {
    type: 'string',
    description: 'Status Code',
    optional: true,
    nullable: true,
  },
  Rank: {
    type: 'string',
    description: 'Rank',
    optional: true,
    nullable: true,
  },
  SourceCode: {
    type: 'string',
    description: 'Source Code',
    optional: true,
    nullable: true,
  },
  BudgetAmount: {
    type: 'json',
    description: 'Budget Amount (JSON number or exact numeric string under REST framework 9)',
    optional: true,
    nullable: true,
  },
  BudgetCurrencyCode: {
    type: 'string',
    description: 'Budget Currency Code',
    optional: true,
    nullable: true,
  },
  DealAmount: {
    type: 'json',
    description: 'Deal Amount (JSON number or exact numeric string under REST framework 9)',
    optional: true,
    nullable: true,
  },
  CurrencyCode: {
    type: 'string',
    description: 'Currency Code',
    optional: true,
    nullable: true,
  },
  EstimatedCloseDate: {
    type: 'string',
    description: 'Estimated Close Date',
    optional: true,
    nullable: true,
  },
  LeadAcceptedFlag: {
    type: 'boolean',
    description: 'Lead Accepted Flag',
    optional: true,
    nullable: true,
  },
  EligibleForConversionFlag: {
    type: 'boolean',
    description: 'Eligible For Conversion Flag',
    optional: true,
    nullable: true,
  },
  LeadCreationDate: {
    type: 'string',
    description: 'Lead Creation Date',
    optional: true,
    nullable: true,
  },
  LeadLastUpdateDate: {
    type: 'string',
    description: 'Lead Last Update Date',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const OPPORTUNITY_OUTPUT_PROPERTIES = {
  OptyId: {
    type: 'string',
    description: 'Opty Id as a decimal string',
    optional: true,
    nullable: true,
  },
  OptyNumber: {
    type: 'string',
    description: 'Opty Number',
    optional: true,
    nullable: true,
  },
  Name: {
    type: 'string',
    description: 'Name',
    optional: true,
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    optional: true,
    nullable: true,
  },
  TargetPartyId: {
    type: 'string',
    description: 'Target Party Id as a decimal string',
    optional: true,
    nullable: true,
  },
  TargetPartyName: {
    type: 'string',
    description: 'Target Party Name',
    optional: true,
    nullable: true,
  },
  OwnerResourcePartyId: {
    type: 'string',
    description: 'Owner Resource Party Id as a decimal string',
    optional: true,
    nullable: true,
  },
  OwnerPartyNumber: {
    type: 'string',
    description: 'Owner Party Number',
    optional: true,
    nullable: true,
  },
  KeyContactId: {
    type: 'string',
    description: 'Key Contact Id as a decimal string',
    optional: true,
    nullable: true,
  },
  CurrencyCode: {
    type: 'string',
    description: 'Currency Code',
    optional: true,
    nullable: true,
  },
  PrimaryOrganizationId: {
    type: 'string',
    description: 'Primary Organization Id as a decimal string',
    optional: true,
    nullable: true,
  },
  SalesMethodId: {
    type: 'string',
    description: 'Sales Method Id as a decimal string',
    optional: true,
    nullable: true,
  },
  SalesMethod: {
    type: 'string',
    description: 'Sales Method',
    optional: true,
    nullable: true,
  },
  SalesStageId: {
    type: 'string',
    description: 'Sales Stage Id as a decimal string',
    optional: true,
    nullable: true,
  },
  SalesStage: {
    type: 'string',
    description: 'Sales Stage',
    optional: true,
    nullable: true,
  },
  StatusCode: {
    type: 'string',
    description: 'Status Code',
    optional: true,
    nullable: true,
  },
  ReasonWonLostCode: {
    type: 'string',
    description: 'Reason Won Lost Code',
    optional: true,
    nullable: true,
  },
  EffectiveDate: {
    type: 'string',
    description: 'Effective Date',
    optional: true,
    nullable: true,
  },
  Revenue: {
    type: 'json',
    description: 'Revenue (JSON number or exact numeric string under REST framework 9)',
    optional: true,
    nullable: true,
  },
  WinProb: {
    type: 'number',
    description: 'Win Prob',
    optional: true,
    nullable: true,
  },
  OptyCreationDate: {
    type: 'string',
    description: 'Opty Creation Date',
    optional: true,
    nullable: true,
  },
  OptyLastUpdateDate: {
    type: 'string',
    description: 'Opty Last Update Date',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const ACTIVITY_OUTPUT_PROPERTIES = {
  ActivityId: {
    type: 'string',
    description: 'Activity Id as a decimal string',
    optional: true,
    nullable: true,
  },
  ActivityNumber: {
    type: 'string',
    description: 'Activity Number',
    optional: true,
    nullable: true,
  },
  Subject: {
    type: 'string',
    description: 'Subject',
    optional: true,
    nullable: true,
  },
  ActivityFunctionCode: {
    type: 'string',
    description: 'Activity Function Code',
    optional: true,
    nullable: true,
  },
  ActivityPartialDescription: {
    type: 'string',
    description: 'Activity Partial Description',
    optional: true,
    nullable: true,
  },
  PartialMtgMinutes: {
    type: 'string',
    description: 'Partial Mtg Minutes',
    optional: true,
    nullable: true,
  },
  ActivityStartDate: {
    type: 'string',
    description: 'Activity Start Date',
    optional: true,
    nullable: true,
  },
  ActivityEndDate: {
    type: 'string',
    description: 'Activity End Date',
    optional: true,
    nullable: true,
  },
  DueDate: {
    type: 'string',
    description: 'Due Date',
    optional: true,
    nullable: true,
  },
  OwnerId: {
    type: 'string',
    description: 'Owner Id as a decimal string',
    optional: true,
    nullable: true,
  },
  OwnerName: {
    type: 'string',
    description: 'Owner Name',
    optional: true,
    nullable: true,
  },
  AccountId: {
    type: 'string',
    description: 'Account Id as a decimal string',
    optional: true,
    nullable: true,
  },
  AccountName: {
    type: 'string',
    description: 'Account Name',
    optional: true,
    nullable: true,
  },
  OpportunityId: {
    type: 'string',
    description: 'Opportunity Id as a decimal string',
    optional: true,
    nullable: true,
  },
  OpportunityNumber: {
    type: 'string',
    description: 'Opportunity Number',
    optional: true,
    nullable: true,
  },
  OpportunityName: {
    type: 'string',
    description: 'Opportunity Name',
    optional: true,
    nullable: true,
  },
  LeadId: {
    type: 'string',
    description: 'Lead Id as a decimal string',
    optional: true,
    nullable: true,
  },
  LeadNumber: {
    type: 'string',
    description: 'Lead Number',
    optional: true,
    nullable: true,
  },
  LeadName: {
    type: 'string',
    description: 'Lead Name',
    optional: true,
    nullable: true,
  },
  PrimaryContactId: {
    type: 'string',
    description: 'Primary Contact Id as a decimal string',
    optional: true,
    nullable: true,
  },
  PrimaryContactName: {
    type: 'string',
    description: 'Primary Contact Name',
    optional: true,
    nullable: true,
  },
  ActivityTypeCode: {
    type: 'string',
    description: 'Activity Type Code',
    optional: true,
    nullable: true,
  },
  StatusCode: {
    type: 'string',
    description: 'Status Code',
    optional: true,
    nullable: true,
  },
  PriorityCode: {
    type: 'string',
    description: 'Priority Code',
    optional: true,
    nullable: true,
  },
  Location: {
    type: 'string',
    description: 'Location',
    optional: true,
    nullable: true,
  },
  PercentageComplete: {
    type: 'json',
    description: 'Percentage Complete (JSON number or exact numeric string under REST framework 9)',
    optional: true,
    nullable: true,
  },
  AllDayFlag: {
    type: 'boolean',
    description: 'All Day Flag',
    optional: true,
    nullable: true,
  },
  PrivateFlag: {
    type: 'boolean',
    description: 'Private Flag',
    optional: true,
    nullable: true,
  },
  ActivityCreationDate: {
    type: 'string',
    description: 'Activity Creation Date',
    optional: true,
    nullable: true,
  },
  ActivityUpdateDate: {
    type: 'string',
    description: 'Activity Update Date',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const RESOURCE_OUTPUT_PROPERTIES = {
  PartyId: {
    type: 'string',
    description: 'Party Id as a decimal string',
    optional: true,
    nullable: true,
  },
  PartyNumber: {
    type: 'string',
    description: 'Party Number',
    optional: true,
    nullable: true,
  },
  PartyName: {
    type: 'string',
    description: 'Party Name',
    optional: true,
    nullable: true,
  },
  PersonFirstName: {
    type: 'string',
    description: 'Person First Name',
    optional: true,
    nullable: true,
  },
  PersonLastName: {
    type: 'string',
    description: 'Person Last Name',
    optional: true,
    nullable: true,
  },
  EmailAddress: {
    type: 'string',
    description: 'Email Address',
    optional: true,
    nullable: true,
  },
  Username: {
    type: 'string',
    description: 'Username',
    optional: true,
    nullable: true,
  },
  ResourceProfileId: {
    type: 'string',
    description: 'Resource Profile Id as a decimal string',
    optional: true,
    nullable: true,
  },
  ResourceOrgRoleCode: {
    type: 'string',
    description: 'Resource Org Role Code',
    optional: true,
    nullable: true,
  },
  ResourceOrgRoleName: {
    type: 'string',
    description: 'Resource Org Role Name',
    optional: true,
    nullable: true,
  },
  StartDateActive: {
    type: 'string',
    description: 'Start Date Active',
    optional: true,
    nullable: true,
  },
  EndDateActive: {
    type: 'string',
    description: 'End Date Active',
    optional: true,
    nullable: true,
  },
  Manager: {
    type: 'string',
    description: 'Manager',
    optional: true,
    nullable: true,
  },
  PrimaryOrganization: {
    type: 'string',
    description: 'Primary Organization',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const OPPORTUNITY_CONTACT_OUTPUT_PROPERTIES = {
  OptyConId: {
    type: 'string',
    description: 'Opty Con Id as a decimal string',
    optional: true,
    nullable: true,
  },
  OptyId: {
    type: 'string',
    description: 'Opty Id as a decimal string',
    optional: true,
    nullable: true,
  },
  OptyNumber: {
    type: 'string',
    description: 'Opty Number',
    optional: true,
    nullable: true,
  },
  PERPartyId: {
    type: 'string',
    description: 'PERParty Id as a decimal string',
    optional: true,
    nullable: true,
  },
  ContactFirstName: {
    type: 'string',
    description: 'Contact First Name',
    optional: true,
    nullable: true,
  },
  ContactLastName: {
    type: 'string',
    description: 'Contact Last Name',
    optional: true,
    nullable: true,
  },
  PrimaryFlg: {
    type: 'string',
    description: 'Primary Flg',
    optional: true,
    nullable: true,
  },
  RoleCd: {
    type: 'string',
    description: 'Role Cd',
    optional: true,
    nullable: true,
  },
  InfluenceLvlCd: {
    type: 'string',
    description: 'Influence Lvl Cd',
    optional: true,
    nullable: true,
  },
  AffinityLvlCd: {
    type: 'string',
    description: 'Affinity Lvl Cd',
    optional: true,
    nullable: true,
  },
  ContactedFlg: {
    type: 'string',
    description: 'Contacted Flg',
    optional: true,
    nullable: true,
  },
  Comments: {
    type: 'string',
    description: 'Comments',
    optional: true,
    nullable: true,
  },
  RelationshipId: {
    type: 'string',
    description: 'Relationship Id as a decimal string',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const REVENUE_OUTPUT_PROPERTIES = {
  resourceKey: { type: 'string', description: 'Opaque resource key from Oracle self link' },
  RevnId: {
    type: 'string',
    description: 'Revn Id as a decimal string',
    optional: true,
    nullable: true,
  },
  RevnNumber: {
    type: 'string',
    description: 'Revn Number',
    optional: true,
    nullable: true,
  },
  OptyId: {
    type: 'string',
    description: 'Opty Id as a decimal string',
    optional: true,
    nullable: true,
  },
  OptyNumber: {
    type: 'string',
    description: 'Opty Number',
    optional: true,
    nullable: true,
  },
  ProdGroupId: {
    type: 'string',
    description: 'Prod Group Id as a decimal string',
    optional: true,
    nullable: true,
  },
  ProdGroupName: {
    type: 'string',
    description: 'Prod Group Name',
    optional: true,
    nullable: true,
  },
  InventoryItemId: {
    type: 'string',
    description: 'Inventory Item Id as a decimal string',
    optional: true,
    nullable: true,
  },
  InventoryOrgId: {
    type: 'string',
    description: 'Inventory Org Id as a decimal string',
    optional: true,
    nullable: true,
  },
  Quantity: {
    type: 'json',
    description: 'Quantity (JSON number or exact numeric string under REST framework 9)',
    optional: true,
    nullable: true,
  },
  UnitPrice: {
    type: 'json',
    description: 'Unit Price (JSON number or exact numeric string under REST framework 9)',
    optional: true,
    nullable: true,
  },
  RevnAmount: {
    type: 'json',
    description: 'Revn Amount (JSON number or exact numeric string under REST framework 9)',
    optional: true,
    nullable: true,
  },
  RevnAmountCurcyCode: {
    type: 'string',
    description: 'Revn Amount Curcy Code',
    optional: true,
    nullable: true,
  },
  ResourcePartyId: {
    type: 'string',
    description: 'Resource Party Id as a decimal string',
    optional: true,
    nullable: true,
  },
  EffectiveDate: {
    type: 'string',
    description: 'Effective Date',
    optional: true,
    nullable: true,
  },
  StatusCode: {
    type: 'string',
    description: 'Status Code',
    optional: true,
    nullable: true,
  },
  WinProb: {
    type: 'number',
    description: 'Win Prob',
    optional: true,
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    optional: true,
    nullable: true,
  },
  RevnCreationDate: {
    type: 'string',
    description: 'Revn Creation Date',
    optional: true,
    nullable: true,
  },
  RevnLastUpdateDate: {
    type: 'string',
    description: 'Revn Last Update Date',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const TEAM_MEMBER_OUTPUT_PROPERTIES = {
  resourceKey: { type: 'string', description: 'Opaque resource key from Oracle self link' },
  OptyResourceId: {
    type: 'string',
    description: 'Opty Resource Id as a decimal string',
    optional: true,
    nullable: true,
  },
  OptyResourceNumber: {
    type: 'string',
    description: 'Opty Resource Number',
    optional: true,
    nullable: true,
  },
  OptyId: {
    type: 'string',
    description: 'Opty Id as a decimal string',
    optional: true,
    nullable: true,
  },
  OptyNumber: {
    type: 'string',
    description: 'Opty Number',
    optional: true,
    nullable: true,
  },
  ResourceId: {
    type: 'string',
    description: 'Resource Id as a decimal string',
    optional: true,
    nullable: true,
  },
  PartyName: {
    type: 'string',
    description: 'Party Name',
    optional: true,
    nullable: true,
  },
  EmailAddress: {
    type: 'string',
    description: 'Email Address',
    optional: true,
    nullable: true,
  },
  AccessLevelCode: {
    type: 'string',
    description: 'Access Level Code',
    optional: true,
    nullable: true,
  },
  MemberFunctionCode: {
    type: 'string',
    description: 'Member Function Code',
    optional: true,
    nullable: true,
  },
  LockAssignmentFlag: {
    type: 'boolean',
    description: 'Lock Assignment Flag',
    optional: true,
    nullable: true,
  },
  OwnerFlag: {
    type: 'boolean',
    description: 'Owner Flag',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const ASSIGNEE_OUTPUT_PROPERTIES = {
  resourceKey: { type: 'string', description: 'Opaque resource key from Oracle self link' },
  ActivityAssigneeId: {
    type: 'string',
    description: 'Activity Assignee Id as a decimal string',
    optional: true,
    nullable: true,
  },
  ActivityId: {
    type: 'string',
    description: 'Activity Id as a decimal string',
    optional: true,
    nullable: true,
  },
  ActyActivityNumber: {
    type: 'string',
    description: 'Acty Activity Number',
    optional: true,
    nullable: true,
  },
  AssigneeId: {
    type: 'string',
    description: 'Assignee Id as a decimal string',
    optional: true,
    nullable: true,
  },
  AssigneeName: {
    type: 'string',
    description: 'Assignee Name',
    optional: true,
    nullable: true,
  },
  AssigneePartyNumber: {
    type: 'string',
    description: 'Assignee Party Number',
    optional: true,
    nullable: true,
  },
  AttendeeFlag: {
    type: 'boolean',
    description: 'Attendee Flag',
    optional: true,
    nullable: true,
  },
  ResponseCode: {
    type: 'string',
    description: 'Response Code',
    optional: true,
    nullable: true,
  },
  StatusCode: {
    type: 'string',
    description: 'Status Code',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const ACTIVITY_CONTACT_OUTPUT_PROPERTIES = {
  resourceKey: { type: 'string', description: 'Opaque resource key from Oracle self link' },
  ActivityContactId: {
    type: 'string',
    description: 'Activity Contact Id as a decimal string',
    optional: true,
    nullable: true,
  },
  ActivityId: {
    type: 'string',
    description: 'Activity Id as a decimal string',
    optional: true,
    nullable: true,
  },
  ActyActivityNumber: {
    type: 'string',
    description: 'Acty Activity Number',
    optional: true,
    nullable: true,
  },
  ContactId: {
    type: 'string',
    description: 'Contact Id as a decimal string',
    optional: true,
    nullable: true,
  },
  ContactName: {
    type: 'string',
    description: 'Contact Name',
    optional: true,
    nullable: true,
  },
  ContactEmail: {
    type: 'string',
    description: 'Contact Email',
    optional: true,
    nullable: true,
  },
  ContactPhone: {
    type: 'string',
    description: 'Contact Phone',
    optional: true,
    nullable: true,
  },
  AttendeeFlag: {
    type: 'boolean',
    description: 'Attendee Flag',
    optional: true,
    nullable: true,
  },
  PrimaryContactFlag: {
    type: 'boolean',
    description: 'Primary Contact Flag',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const PAGINATION_OUTPUTS = {
  count: { type: 'number', description: 'Number of records in this page' },
  hasMore: { type: 'boolean', description: 'Whether Oracle reports another page' },
  limit: { type: 'number', description: 'Page size returned by Oracle' },
  offset: { type: 'number', description: 'Offset returned by Oracle' },
  totalResults: {
    type: 'number',
    description: 'Estimated matching total when Oracle provides it',
    optional: true,
  },
  nextOffset: {
    type: 'number',
    description: 'Offset for the next request, present only when hasMore is true',
    optional: true,
  },
} satisfies Record<string, OutputProperty>

export const DUPLICATE_ACCOUNT_OUTPUT_PROPERTIES = {
  PartyId: { type: 'string', description: 'PartyId', optional: true, nullable: true },
  PartyNumber: { type: 'string', description: 'PartyNumber', optional: true, nullable: true },
  OrganizationName: {
    type: 'string',
    description: 'OrganizationName',
    optional: true,
    nullable: true,
  },
  FormattedAddress: {
    type: 'string',
    description: 'FormattedAddress',
    optional: true,
    nullable: true,
  },
  EmailAddress: { type: 'string', description: 'EmailAddress', optional: true, nullable: true },
  OwnerPartyId: { type: 'string', description: 'OwnerPartyId', optional: true, nullable: true },
  OwnerName: { type: 'string', description: 'OwnerName', optional: true, nullable: true },
  MatchScore: { type: 'string', description: 'MatchScore', optional: true, nullable: true },
  MatchRule: { type: 'string', description: 'MatchRule', optional: true, nullable: true },
  MatchedAttributes: {
    type: 'string',
    description: 'MatchedAttributes',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const DUPLICATE_CONTACT_OUTPUT_PROPERTIES = {
  PartyId: { type: 'string', description: 'PartyId', optional: true, nullable: true },
  PartyNumber: { type: 'string', description: 'PartyNumber', optional: true, nullable: true },
  FirstName: { type: 'string', description: 'FirstName', optional: true, nullable: true },
  LastName: { type: 'string', description: 'LastName', optional: true, nullable: true },
  FormattedAddress: {
    type: 'string',
    description: 'FormattedAddress',
    optional: true,
    nullable: true,
  },
  EmailAddress: { type: 'string', description: 'EmailAddress', optional: true, nullable: true },
  AccountPartyId: { type: 'string', description: 'AccountPartyId', optional: true, nullable: true },
  AccountPartyNumber: {
    type: 'string',
    description: 'AccountPartyNumber',
    optional: true,
    nullable: true,
  },
  AccountName: { type: 'string', description: 'AccountName', optional: true, nullable: true },
  MatchScore: { type: 'string', description: 'MatchScore', optional: true, nullable: true },
  MatchRule: { type: 'string', description: 'MatchRule', optional: true, nullable: true },
  MatchedAttributes: {
    type: 'string',
    description: 'MatchedAttributes',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export interface OracleFusionSalesAuthParams {
  oauthCredential: string
  accessToken?: string
  instanceUrl?: string
}

export interface OracleFusionSalesPageParams {
  q?: string
  finder?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

/** Business identifiers remain strings across workflow and JSON boundaries. */
export type OracleFusionSalesRecord = Record<string, string | number | boolean | null>

export interface OracleFusionSalesResponse extends ToolResponse {
  output: {
    record?: OracleFusionSalesRecord
    items?: OracleFusionSalesRecord[]
    result?: string
    deleted?: boolean
    count?: number
    hasMore?: boolean
    limit?: number
    offset?: number
    totalResults?: number
    nextOffset?: number
  }
}

export interface OracleFusionSalesAccountFields {
  organizationName?: string
  accountType?: string | null
  description?: string | null
  emailAddress?: string | null
  website?: string | null
  phoneNumber?: string | null
  phoneCountryCode?: string | null
  phoneAreaCode?: string | null
  ownerId?: string | null
  parentAccountId?: string | null
  contactId?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string
}

export interface OracleFusionSalesContactFields {
  firstName?: string | null
  lastName?: string | null
  emailAddress?: string | null
  accountId?: string | null
  ownerId?: string | null
  jobTitle?: string | null
  department?: string | null
  workPhoneNumber?: string | null
  mobileNumber?: string | null
  addressLine1?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string
  doNotEmailFlag?: boolean | null
  doNotCallFlag?: boolean | null
}

export interface OracleFusionSalesLeadFields {
  name?: string
  description?: string | null
  accountId?: string | null
  ownerId?: string | null
  contactId?: string | null
  statusCode?: string | null
  rank?: string | null
  sourceCode?: string | null
  budgetAmount?: number | null
  budgetCurrencyCode?: string | null
  dealAmount?: number | null
  currencyCode?: string | null
  estimatedCloseDate?: string | null
  customerNeed?: string | null
  contactFirstName?: string | null
  contactLastName?: string | null
  contactEmail?: string | null
}

export interface OracleFusionSalesOpportunityFields {
  name?: string
  description?: string | null
  accountId?: string | null
  ownerId?: string
  contactId?: string | null
  currencyCode?: string
  businessUnitId?: string
  salesMethodId?: string | null
  salesStageId?: string | null
  statusCode?: string | null
  reasonWonLostCode?: string | null
  closeDate?: string | null
  revenue?: number | null
  winProbability?: number | null
  comments?: string | null
}

export interface OracleFusionSalesActivityFields {
  subject?: string
  description?: string | null
  meetingMinutes?: string | null
  startDateTime?: string | null
  endDateTime?: string | null
  dueDate?: string | null
  ownerId?: string
  accountId?: string | null
  opportunityId?: string | null
  leadId?: string | null
  contactId?: string | null
  activityTypeCode?: string | null
  statusCode?: string | null
  priorityCode?: string | null
  location?: string | null
  percentageComplete?: number | null
  allDayFlag?: boolean | null
  privateFlag?: boolean | null
}

export interface OracleFusionSalesOpportunityContactFields {
  contactId?: string
  primaryFlag?: string | null
  roleCode?: string | null
  influenceCode?: string | null
  affinityCode?: string | null
  contactedFlag?: string | null
  comments?: string | null
  relationshipId?: string | null
}

export interface OracleFusionSalesRevenueFields {
  productGroupId?: string | null
  inventoryItemId?: string | null
  inventoryOrganizationId?: string | null
  quantity?: number | null
  unitPrice?: number | null
  revenue?: number | null
  currencyCode?: string
  ownerId?: string | null
  closeDate?: string | null
  statusCode?: string | null
  winProbability?: number | null
  description?: string | null
  comments?: string | null
}

export interface OracleFusionSalesTeamMemberFields {
  ownerId?: string
  accessLevelCode?: string | null
  memberFunctionCode?: string | null
  lockAssignmentFlag?: boolean | null
  ownerFlag?: boolean | null
}

export interface OracleFusionSalesAssigneeFields {
  ownerId?: string
  attendeeFlag?: boolean | null
}

export interface OracleFusionSalesActivityContactFields {
  contactId?: string
  attendeeFlag?: boolean | null
  primaryContactFlag?: boolean | null
}

export type OracleFusionSalesAcceptLeadParams = OracleFusionSalesAuthParams & {
  leadId: string
}

export type OracleFusionSalesAddActivityAssigneeParams = OracleFusionSalesAuthParams &
  OracleFusionSalesAssigneeFields & {
    activityNumber: string
    ownerId: string
  }

export type OracleFusionSalesAddActivityContactParams = OracleFusionSalesAuthParams &
  OracleFusionSalesActivityContactFields & {
    activityNumber: string
    contactId: string
  }

export type OracleFusionSalesAddOpportunityContactParams = OracleFusionSalesAuthParams &
  OracleFusionSalesOpportunityContactFields & {
    opportunityNumber: string
    contactId: string
  }

export type OracleFusionSalesAddOpportunityTeamMemberParams = OracleFusionSalesAuthParams &
  OracleFusionSalesTeamMemberFields & {
    opportunityNumber: string
    ownerId: string
  }

export type OracleFusionSalesAssignAccountParams = OracleFusionSalesAuthParams & {
  accountNumber: string
}

export type OracleFusionSalesAssignLeadParams = OracleFusionSalesAuthParams & {
  leadId: string
}

export type OracleFusionSalesAssignOpportunityParams = OracleFusionSalesAuthParams & {
  opportunityNumber: string
}

export type OracleFusionSalesConvertLeadParams = OracleFusionSalesAuthParams & {
  leadId: string
  opportunityName?: string
  opportunityOwnerNumber?: string
  attributeMap?: Record<string, string>
}

export type OracleFusionSalesCreateAccountParams = OracleFusionSalesAuthParams &
  OracleFusionSalesAccountFields & {
    organizationName: string
  }

export type OracleFusionSalesCreateAppointmentParams = OracleFusionSalesAuthParams &
  OracleFusionSalesActivityFields & {
    subject: string
    startDateTime: string
    endDateTime: string
  }

export type OracleFusionSalesCreateCallReportParams = OracleFusionSalesAuthParams &
  OracleFusionSalesActivityFields & {
    subject: string
    startDateTime: string
    endDateTime: string
  }

export type OracleFusionSalesCreateContactParams = OracleFusionSalesAuthParams &
  OracleFusionSalesContactFields

export type OracleFusionSalesCreateLeadParams = OracleFusionSalesAuthParams &
  OracleFusionSalesLeadFields & {
    name: string
  }

export type OracleFusionSalesCreateOpportunityParams = OracleFusionSalesAuthParams &
  OracleFusionSalesOpportunityFields & {
    name: string
  }

export type OracleFusionSalesCreateOpportunityRevenueParams = OracleFusionSalesAuthParams &
  OracleFusionSalesRevenueFields & {
    opportunityNumber: string
  }

export type OracleFusionSalesCreateTaskParams = OracleFusionSalesAuthParams &
  OracleFusionSalesActivityFields & {
    subject: string
  }

export type OracleFusionSalesDeleteAccountParams = OracleFusionSalesAuthParams & {
  accountNumber: string
}

export type OracleFusionSalesDeleteActivityParams = OracleFusionSalesAuthParams & {
  activityNumber: string
}

export type OracleFusionSalesDeleteContactParams = OracleFusionSalesAuthParams & {
  contactNumber: string
}

export type OracleFusionSalesDeleteLeadParams = OracleFusionSalesAuthParams & {
  leadKey: string
}

export type OracleFusionSalesDeleteOpportunityParams = OracleFusionSalesAuthParams & {
  opportunityNumber: string
}

export type OracleFusionSalesDeleteOpportunityRevenueParams = OracleFusionSalesAuthParams & {
  opportunityNumber: string
  revenueKey: string
}

export type OracleFusionSalesFindDuplicateAccountsParams = OracleFusionSalesAuthParams & {
  matchingFields: Record<string, string>
}

export type OracleFusionSalesFindDuplicateContactsParams = OracleFusionSalesAuthParams & {
  matchingFields: Record<string, string>
  accountNumber?: string
}

export type OracleFusionSalesGetAccountParams = OracleFusionSalesAuthParams & {
  accountNumber: string
}

export type OracleFusionSalesGetActivityParams = OracleFusionSalesAuthParams & {
  activityNumber: string
}

export type OracleFusionSalesGetContactParams = OracleFusionSalesAuthParams & {
  contactNumber: string
}

export type OracleFusionSalesGetLeadParams = OracleFusionSalesAuthParams & {
  leadKey: string
}

export type OracleFusionSalesGetOpportunityParams = OracleFusionSalesAuthParams & {
  opportunityNumber: string
}

export type OracleFusionSalesGetSalesResourceParams = OracleFusionSalesAuthParams & {
  resourceNumber: string
}

export type OracleFusionSalesListAccountsParams = OracleFusionSalesAuthParams &
  OracleFusionSalesPageParams

export type OracleFusionSalesListActivitiesParams = OracleFusionSalesAuthParams &
  OracleFusionSalesPageParams

export type OracleFusionSalesListActivityAssigneesParams = OracleFusionSalesAuthParams &
  OracleFusionSalesPageParams & {
    activityNumber: string
  }

export type OracleFusionSalesListActivityContactsParams = OracleFusionSalesAuthParams &
  OracleFusionSalesPageParams & {
    activityNumber: string
  }

export type OracleFusionSalesListContactsParams = OracleFusionSalesAuthParams &
  OracleFusionSalesPageParams

export type OracleFusionSalesListLeadsParams = OracleFusionSalesAuthParams &
  OracleFusionSalesPageParams

export type OracleFusionSalesListOpportunitiesParams = OracleFusionSalesAuthParams &
  OracleFusionSalesPageParams

export type OracleFusionSalesListOpportunityContactsParams = OracleFusionSalesAuthParams &
  OracleFusionSalesPageParams & {
    opportunityNumber: string
  }

export type OracleFusionSalesListOpportunityRevenueParams = OracleFusionSalesAuthParams &
  OracleFusionSalesPageParams & {
    opportunityNumber: string
  }

export type OracleFusionSalesListOpportunityTeamParams = OracleFusionSalesAuthParams &
  OracleFusionSalesPageParams & {
    opportunityNumber: string
  }

export type OracleFusionSalesListSalesResourcesParams = OracleFusionSalesAuthParams &
  OracleFusionSalesPageParams

export type OracleFusionSalesRejectLeadParams = OracleFusionSalesAuthParams & {
  leadId: string
  reason?: string
  comments?: string
}

export type OracleFusionSalesRemoveActivityAssigneeParams = OracleFusionSalesAuthParams & {
  activityNumber: string
  assigneeKey: string
}

export type OracleFusionSalesRemoveActivityContactParams = OracleFusionSalesAuthParams & {
  activityNumber: string
  activityContactKey: string
}

export type OracleFusionSalesRemoveOpportunityContactParams = OracleFusionSalesAuthParams & {
  opportunityNumber: string
  opportunityContactId: string
}

export type OracleFusionSalesRemoveOpportunityTeamMemberParams = OracleFusionSalesAuthParams & {
  opportunityNumber: string
  teamMemberKey: string
}

export type OracleFusionSalesUpdateAccountParams = OracleFusionSalesAuthParams &
  OracleFusionSalesAccountFields & {
    accountNumber: string
  }

export type OracleFusionSalesUpdateActivityParams = OracleFusionSalesAuthParams &
  OracleFusionSalesActivityFields & {
    activityNumber: string
  }

export type OracleFusionSalesUpdateContactParams = OracleFusionSalesAuthParams &
  OracleFusionSalesContactFields & {
    contactNumber: string
  }

export type OracleFusionSalesUpdateLeadParams = OracleFusionSalesAuthParams &
  OracleFusionSalesLeadFields & {
    leadKey: string
  }

export type OracleFusionSalesUpdateOpportunityParams = OracleFusionSalesAuthParams &
  OracleFusionSalesOpportunityFields & {
    opportunityNumber: string
  }

export type OracleFusionSalesUpdateOpportunityContactParams = OracleFusionSalesAuthParams &
  OracleFusionSalesOpportunityContactFields & {
    opportunityNumber: string
    opportunityContactId: string
  }

export type OracleFusionSalesUpdateOpportunityRevenueParams = OracleFusionSalesAuthParams &
  OracleFusionSalesRevenueFields & {
    opportunityNumber: string
    revenueKey: string
  }

export type OracleFusionSalesUpdateOpportunityTeamMemberParams = OracleFusionSalesAuthParams &
  Omit<OracleFusionSalesTeamMemberFields, 'ownerId'> & {
    opportunityNumber: string
    teamMemberKey: string
  }
