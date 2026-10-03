import type { OAuthConfig, OutputProperty, ToolConfig } from '@/tools/types'

export const oracleFusionServiceOAuth = {
  required: true,
  provider: 'oracle_fusion_service',
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
} as const satisfies OAuthConfig

export const oracleFusionServiceAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Stored Oracle Fusion service-account credential.',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Basic authorization material injected from the stored credential.',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Fusion application origin injected from the stored credential.',
  },
} satisfies ToolConfig['params']

/** Oracle Sales and Fusion Service REST: op-servicerequests-srnumber-get.html */
export const oracleFusionServiceRequestOutputs = {
  SrId: {
    type: 'string',
    description: 'SrId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  SrNumber: {
    type: 'string',
    description: 'Sr Number',
  },
  Title: {
    type: 'string',
    description: 'Title',
    optional: true,
    nullable: true,
  },
  ProblemDescription: {
    type: 'string',
    description: 'Problem Description',
    optional: true,
    nullable: true,
  },
  StatusCd: {
    type: 'string',
    description: 'Status Cd',
    optional: true,
    nullable: true,
  },
  StatusCdMeaning: {
    type: 'string',
    description: 'Status Cd Meaning',
    optional: true,
    nullable: true,
  },
  StatusTypeCd: {
    type: 'string',
    description: 'Status Type Cd',
    optional: true,
    nullable: true,
  },
  SeverityCd: {
    type: 'string',
    description: 'Severity Cd',
    optional: true,
    nullable: true,
  },
  SeverityCdMeaning: {
    type: 'string',
    description: 'Severity Cd Meaning',
    optional: true,
    nullable: true,
  },
  AccountPartyId: {
    type: 'string',
    description: 'AccountPartyId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  AccountPartyName: {
    type: 'string',
    description: 'Account Party Name',
    optional: true,
    nullable: true,
  },
  PrimaryContactPartyId: {
    type: 'string',
    description: 'PrimaryContactPartyId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  PrimaryContactPartyName: {
    type: 'string',
    description: 'Primary Contact Party Name',
    optional: true,
    nullable: true,
  },
  AssigneeResourceId: {
    type: 'string',
    description: 'AssigneeResourceId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  AssigneePartyId: {
    type: 'string',
    description: 'AssigneePartyId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  AssigneePersonName: {
    type: 'string',
    description: 'Assignee Person Name',
    optional: true,
    nullable: true,
  },
  QueueId: {
    type: 'string',
    description: 'QueueId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  QueueName: {
    type: 'string',
    description: 'Queue Name',
    optional: true,
    nullable: true,
  },
  BUOrgId: {
    type: 'string',
    description: 'BUOrgId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  BusinessUnitName: {
    type: 'string',
    description: 'Business Unit Name',
    optional: true,
    nullable: true,
  },
  CategoryId: {
    type: 'string',
    description: 'CategoryId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  CategoryName: {
    type: 'string',
    description: 'Category Name',
    optional: true,
    nullable: true,
  },
  ChannelTypeCd: {
    type: 'string',
    description: 'Channel Type Cd',
    optional: true,
    nullable: true,
  },
  ResolveDescription: {
    type: 'string',
    description: 'Resolve Description',
    optional: true,
    nullable: true,
  },
  ResolveOutcomeCd: {
    type: 'string',
    description: 'Resolve Outcome Cd',
    optional: true,
    nullable: true,
  },
  ResolutionCd: {
    type: 'string',
    description: 'Resolution Cd',
    optional: true,
    nullable: true,
  },
  OpenDate: {
    type: 'string',
    description: 'Open Date',
    optional: true,
    nullable: true,
  },
  LastResolvedDate: {
    type: 'string',
    description: 'Last Resolved Date',
    optional: true,
    nullable: true,
  },
  ClosedDate: {
    type: 'string',
    description: 'Closed Date',
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

/** Oracle Sales and Fusion Service REST: op-accounts-partynumber-get.html */
export const oracleFusionServiceAccountsOutputs = {
  PartyId: {
    type: 'string',
    description: 'PartyId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  PartyNumber: {
    type: 'string',
    description: 'Party Number',
  },
  OrganizationName: {
    type: 'string',
    description: 'Organization Name',
    optional: true,
    nullable: true,
  },
  PartyUniqueName: {
    type: 'string',
    description: 'Party Unique Name',
    optional: true,
    nullable: true,
  },
  PartyStatus: {
    type: 'string',
    description: 'Party Status',
    optional: true,
    nullable: true,
  },
  Type: {
    type: 'string',
    description: 'Type',
    optional: true,
    nullable: true,
  },
  EmailAddress: {
    type: 'string',
    description: 'Email Address',
    optional: true,
    nullable: true,
  },
  FormattedPhoneNumber: {
    type: 'string',
    description: 'Formatted Phone Number',
    optional: true,
    nullable: true,
  },
  PrimaryContactPartyId: {
    type: 'string',
    description: 'PrimaryContactPartyId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  PrimaryContactName: {
    type: 'string',
    description: 'Primary Contact Name',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Oracle Sales and Fusion Service REST: op-contacts-partynumber-get.html */
export const oracleFusionServiceContactsOutputs = {
  PartyId: {
    type: 'string',
    description: 'PartyId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  PartyNumber: {
    type: 'string',
    description: 'Party Number',
  },
  ContactName: {
    type: 'string',
    description: 'Contact Name',
    optional: true,
    nullable: true,
  },
  ContactUniqueName: {
    type: 'string',
    description: 'Contact Unique Name',
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
  OverallPrimaryFormattedPhoneNumber: {
    type: 'string',
    description: 'Overall Primary Formatted Phone Number',
    optional: true,
    nullable: true,
  },
  AccountPartyId: {
    type: 'string',
    description: 'AccountPartyId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  AccountName: {
    type: 'string',
    description: 'Account Name',
    optional: true,
    nullable: true,
  },
  PartyStatus: {
    type: 'string',
    description: 'Party Status',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Oracle Sales and Fusion Service REST: op-queues-queueid-get.html */
export const oracleFusionServiceQueuesOutputs = {
  QueueId: {
    type: 'string',
    description: 'QueueId, represented as an exact decimal string.',
  },
  QueueNumber: {
    type: 'string',
    description: 'Queue Number',
    optional: true,
    nullable: true,
  },
  QueueName: {
    type: 'string',
    description: 'Queue Name',
    optional: true,
    nullable: true,
  },
  QueueDescription: {
    type: 'string',
    description: 'Queue Description',
    optional: true,
    nullable: true,
  },
  EnabledFlag: {
    type: 'boolean',
    description: 'Enabled Flag',
    optional: true,
    nullable: true,
  },
  AutoRoutingFlag: {
    type: 'boolean',
    description: 'Auto Routing Flag',
    optional: true,
    nullable: true,
  },
  StripeCd: {
    type: 'string',
    description: 'Stripe Cd',
    optional: true,
    nullable: true,
  },
  OwnerResourceId: {
    type: 'string',
    description: 'OwnerResourceId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  ResourceCount: {
    type: 'number',
    description: 'Resource Count',
    optional: true,
    nullable: true,
  },
  OpenSrCount: {
    type: 'number',
    description: 'Open Sr Count',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Oracle Sales and Fusion Service REST: op-resources-partynumber-get.html */
export const oracleFusionServiceResourcesOutputs = {
  PartyId: {
    type: 'string',
    description: 'PartyId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  PartyNumber: {
    type: 'string',
    description: 'Party Number',
  },
  PartyName: {
    type: 'string',
    description: 'Party Name',
    optional: true,
    nullable: true,
  },
  Username: {
    type: 'string',
    description: 'Username',
    optional: true,
    nullable: true,
  },
  EmailAddress: {
    type: 'string',
    description: 'Email Address',
    optional: true,
    nullable: true,
  },
  FormattedPhoneNumber: {
    type: 'string',
    description: 'Formatted Phone Number',
    optional: true,
    nullable: true,
  },
  ResourceProfileId: {
    type: 'string',
    description: 'ResourceProfileId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  ResourceType: {
    type: 'string',
    description: 'Resource Type',
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
} satisfies Record<string, OutputProperty>

/** Oracle Sales and Fusion Service REST: op-servicebusinessunits-buorgid-get.html */
export const oracleFusionServiceBusinessUnitsOutputs = {
  BUOrgId: {
    type: 'string',
    description: 'BUOrgId, represented as an exact decimal string.',
  },
  BusinessUnitName: {
    type: 'string',
    description: 'Business Unit Name',
    optional: true,
    nullable: true,
  },
  BusinessUnitId: {
    type: 'string',
    description: 'BusinessUnitId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  Name: {
    type: 'string',
    description: 'Name',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Oracle Sales and Fusion Service REST: op-servicerequeststatuseslov-get.html */
export const oracleFusionServiceStatusesOutputs = {
  LookupCode: {
    type: 'string',
    description: 'Lookup Code',
  },
  Meaning: {
    type: 'string',
    description: 'Meaning',
    optional: true,
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    optional: true,
    nullable: true,
  },
  ParentLookupCode: {
    type: 'string',
    description: 'Parent Lookup Code',
    optional: true,
    nullable: true,
  },
  EnabledFlag: {
    type: 'boolean',
    description: 'Enabled Flag',
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
} satisfies Record<string, OutputProperty>

/** Oracle Sales and Fusion Service REST: op-servicerequests-srnumber-child-contacts-memberid-get.html */
export const oracleFusionServiceRequestContactsOutputs = {
  MemberId: {
    type: 'string',
    description: 'MemberId, represented as an exact decimal string.',
  },
  SrId: {
    type: 'string',
    description: 'SrId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  SrNumber: {
    type: 'string',
    description: 'Sr Number',
    optional: true,
    nullable: true,
  },
  PartyId: {
    type: 'string',
    description: 'PartyId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  ContactPartyNumber: {
    type: 'string',
    description: 'Contact Party Number',
    optional: true,
    nullable: true,
  },
  ContactUniqueName: {
    type: 'string',
    description: 'Contact Unique Name',
    optional: true,
    nullable: true,
  },
  ContactEmailAddress: {
    type: 'string',
    description: 'Contact Email Address',
    optional: true,
    nullable: true,
  },
  ContactFormattedPhoneNumber: {
    type: 'string',
    description: 'Contact Formatted Phone Number',
    optional: true,
    nullable: true,
  },
  PrimaryContactFlag: {
    type: 'boolean',
    description: 'Primary Contact Flag',
    optional: true,
    nullable: true,
  },
  RelationTypeCd: {
    type: 'string',
    description: 'Relation Type Cd',
    optional: true,
    nullable: true,
  },
  AccessLevelCd: {
    type: 'string',
    description: 'Access Level Cd',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Oracle Sales and Fusion Service REST: op-servicerequests-srnumber-child-resourcemembers-memberid-get.html */
export const oracleFusionServiceRequestResourcesOutputs = {
  MemberId: {
    type: 'string',
    description: 'MemberId, represented as an exact decimal string.',
  },
  SrId: {
    type: 'string',
    description: 'SrId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  SrNumber: {
    type: 'string',
    description: 'Sr Number',
    optional: true,
    nullable: true,
  },
  ObjectId: {
    type: 'string',
    description: 'ObjectId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  ObjectTypeCd: {
    type: 'string',
    description: 'Object Type Cd',
    optional: true,
    nullable: true,
  },
  ResourceName: {
    type: 'string',
    description: 'Resource Name',
    optional: true,
    nullable: true,
  },
  ResourcePartyNumber: {
    type: 'string',
    description: 'Resource Party Number',
    optional: true,
    nullable: true,
  },
  ResourceEmailAddress: {
    type: 'string',
    description: 'Resource Email Address',
    optional: true,
    nullable: true,
  },
  OwnerFlag: {
    type: 'boolean',
    description: 'Owner Flag',
    optional: true,
    nullable: true,
  },
  Username: {
    type: 'string',
    description: 'Username',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Oracle Sales and Fusion Service REST: op-servicerequests-srnumber-child-messages-messageid-get.html */
export const oracleFusionServiceMessagesOutputs = {
  MessageId: {
    type: 'string',
    description: 'MessageId, represented as an exact decimal string.',
  },
  SrId: {
    type: 'string',
    description: 'SrId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  SrNumber: {
    type: 'string',
    description: 'Sr Number',
    optional: true,
    nullable: true,
  },
  MessageNumber: {
    type: 'string',
    description: 'Message Number',
    optional: true,
    nullable: true,
  },
  MessageTypeCd: {
    type: 'string',
    description: 'Message Type Cd',
    optional: true,
    nullable: true,
  },
  MessageSubTypeCd: {
    type: 'string',
    description: 'Message Sub Type Cd',
    optional: true,
    nullable: true,
  },
  Subject: {
    type: 'string',
    description: 'Subject',
    optional: true,
    nullable: true,
  },
  StatusCd: {
    type: 'string',
    description: 'Status Cd',
    optional: true,
    nullable: true,
  },
  VisibilityCd: {
    type: 'string',
    description: 'Visibility Cd',
    optional: true,
    nullable: true,
  },
  PartyName: {
    type: 'string',
    description: 'Party Name',
    optional: true,
    nullable: true,
  },
  PostedByPartyId: {
    type: 'string',
    description: 'PostedByPartyId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  ParentMessageId: {
    type: 'string',
    description: 'ParentMessageId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  ChannelTypeCd: {
    type: 'string',
    description: 'Channel Type Cd',
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
  SentDate: {
    type: 'string',
    description: 'Sent Date',
    optional: true,
    nullable: true,
  },
  MessageContent: {
    type: 'string',
    description: 'Message content as returned by Oracle; no encoding conversion is applied.',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Oracle Sales and Fusion Service REST: op-servicerequests-srnumber-child-srinteractionreferences-referenceid-get.html */
export const oracleFusionServiceInteractionsOutputs = {
  ReferenceId: {
    type: 'string',
    description: 'ReferenceId, represented as an exact decimal string.',
  },
  InteractionId: {
    type: 'string',
    description: 'InteractionId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  Description: {
    type: 'string',
    description: 'Description',
    optional: true,
    nullable: true,
  },
  ChannelTypeCd: {
    type: 'string',
    description: 'Channel Type Cd',
    optional: true,
    nullable: true,
  },
  DirectionCd: {
    type: 'string',
    description: 'Direction Cd',
    optional: true,
    nullable: true,
  },
  StatusCd: {
    type: 'string',
    description: 'Status Cd',
    optional: true,
    nullable: true,
  },
  StartTime: {
    type: 'string',
    description: 'Start Time',
    optional: true,
    nullable: true,
  },
  EndTime: {
    type: 'string',
    description: 'End Time',
    optional: true,
    nullable: true,
  },
  ContactPartyId: {
    type: 'string',
    description: 'ContactPartyId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  ContactPartyUniqueName: {
    type: 'string',
    description: 'Contact Party Unique Name',
    optional: true,
    nullable: true,
  },
  AccountPartyId: {
    type: 'string',
    description: 'AccountPartyId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  AccountPartyUniqueName: {
    type: 'string',
    description: 'Account Party Unique Name',
    optional: true,
    nullable: true,
  },
  OwnerResourceId: {
    type: 'string',
    description: 'OwnerResourceId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  OwnerResourcePartyUniqueName: {
    type: 'string',
    description: 'Owner Resource Party Unique Name',
    optional: true,
    nullable: true,
  },
  QueueId: {
    type: 'string',
    description: 'QueueId, represented as an exact decimal string.',
    optional: true,
    nullable: true,
  },
  QueueName: {
    type: 'string',
    description: 'Queue Name',
    optional: true,
    nullable: true,
  },
  CreationDate: {
    type: 'string',
    description: 'Creation Date',
    optional: true,
    nullable: true,
  },
} satisfies Record<string, OutputProperty>
