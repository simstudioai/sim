import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Salesforce API responses.
 * These are reusable across all Salesforce tools to ensure consistency.
 * Based on Salesforce REST API Developer Guide Version 66.0, Spring '26.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_rest.htm
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_list.htm
 */

/**
 * Output definition for Account sObject
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_account.htm
 */
export const ACCOUNT_OUTPUT_PROPERTIES = {
  Id: { type: 'string', description: 'Unique 18-character Salesforce record identifier' },
  Name: { type: 'string', description: 'Account name (required, max 255 characters)' },
  Type: {
    type: 'string',
    description: 'Account type picklist value (e.g., Customer, Partner, Prospect)',
    optional: true,
  },
  ParentId: {
    type: 'string',
    description: 'ID of the parent account for account hierarchy',
    optional: true,
  },
  BillingStreet: { type: 'string', description: 'Billing street address', optional: true },
  BillingCity: { type: 'string', description: 'Billing city', optional: true },
  BillingState: { type: 'string', description: 'Billing state or province', optional: true },
  BillingPostalCode: { type: 'string', description: 'Billing postal or ZIP code', optional: true },
  BillingCountry: { type: 'string', description: 'Billing country', optional: true },
  BillingLatitude: { type: 'number', description: 'Billing address latitude', optional: true },
  BillingLongitude: { type: 'number', description: 'Billing address longitude', optional: true },
  ShippingStreet: { type: 'string', description: 'Shipping street address', optional: true },
  ShippingCity: { type: 'string', description: 'Shipping city', optional: true },
  ShippingState: { type: 'string', description: 'Shipping state or province', optional: true },
  ShippingPostalCode: {
    type: 'string',
    description: 'Shipping postal or ZIP code',
    optional: true,
  },
  ShippingCountry: { type: 'string', description: 'Shipping country', optional: true },
  ShippingLatitude: { type: 'number', description: 'Shipping address latitude', optional: true },
  ShippingLongitude: { type: 'number', description: 'Shipping address longitude', optional: true },
  Phone: { type: 'string', description: 'Primary phone number', optional: true },
  Fax: { type: 'string', description: 'Fax number', optional: true },
  AccountNumber: { type: 'string', description: 'Account number or code', optional: true },
  Website: { type: 'string', description: 'Website URL', optional: true },
  Sic: { type: 'string', description: 'Standard Industrial Classification code', optional: true },
  Industry: {
    type: 'string',
    description: 'Industry picklist value (e.g., Technology, Healthcare, Finance)',
    optional: true,
  },
  AnnualRevenue: {
    type: 'number',
    description: 'Annual revenue in default currency',
    optional: true,
  },
  NumberOfEmployees: { type: 'number', description: 'Number of employees', optional: true },
  Ownership: {
    type: 'string',
    description: 'Ownership type (e.g., Public, Private, Subsidiary)',
    optional: true,
  },
  TickerSymbol: { type: 'string', description: 'Stock ticker symbol', optional: true },
  Description: {
    type: 'string',
    description: 'Account description (max 32000 characters)',
    optional: true,
  },
  Rating: {
    type: 'string',
    description: 'Account rating picklist value (e.g., Hot, Warm, Cold)',
    optional: true,
  },
  Site: { type: 'string', description: 'Site information', optional: true },
  OwnerId: { type: 'string', description: 'ID of the user who owns this account', optional: true },
  CreatedDate: { type: 'string', description: 'ISO 8601 timestamp when created', optional: true },
  CreatedById: { type: 'string', description: 'ID of user who created the record', optional: true },
  LastModifiedDate: {
    type: 'string',
    description: 'ISO 8601 timestamp when last modified',
    optional: true,
  },
  LastModifiedById: {
    type: 'string',
    description: 'ID of user who last modified the record',
    optional: true,
  },
  LastActivityDate: {
    type: 'string',
    description: 'Date of last activity on the account',
    optional: true,
  },
  AccountSource: { type: 'string', description: 'Source of the account record', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Account object output definition for single record
 */
export const ACCOUNT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Salesforce Account object',
  properties: ACCOUNT_OUTPUT_PROPERTIES,
}

/**
 * Accounts array output definition for list operations
 */
export const ACCOUNTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Salesforce Account objects',
  items: {
    type: 'object',
    properties: ACCOUNT_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for Contact sObject
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_contact.htm
 */
export const CONTACT_OUTPUT_PROPERTIES = {
  Id: { type: 'string', description: 'Unique 18-character Salesforce record identifier' },
  AccountId: { type: 'string', description: 'ID of the associated account', optional: true },
  LastName: { type: 'string', description: 'Last name (required, max 80 characters)' },
  FirstName: { type: 'string', description: 'First name (max 40 characters)', optional: true },
  Salutation: {
    type: 'string',
    description: 'Salutation picklist (e.g., Mr., Ms., Dr.)',
    optional: true,
  },
  Name: {
    type: 'string',
    description: 'Full name (read-only, concatenated from name fields)',
    optional: true,
  },
  Title: { type: 'string', description: 'Job title', optional: true },
  Department: { type: 'string', description: 'Department name', optional: true },
  Email: { type: 'string', description: 'Email address', optional: true },
  Phone: { type: 'string', description: 'Business phone number', optional: true },
  MobilePhone: { type: 'string', description: 'Mobile phone number', optional: true },
  HomePhone: { type: 'string', description: 'Home phone number', optional: true },
  OtherPhone: { type: 'string', description: 'Other phone number', optional: true },
  Fax: { type: 'string', description: 'Fax number', optional: true },
  AssistantName: { type: 'string', description: 'Name of assistant', optional: true },
  AssistantPhone: { type: 'string', description: 'Phone number of assistant', optional: true },
  ReportsToId: {
    type: 'string',
    description: 'ID of contact this person reports to',
    optional: true,
  },
  MailingStreet: { type: 'string', description: 'Mailing street address', optional: true },
  MailingCity: { type: 'string', description: 'Mailing city', optional: true },
  MailingState: { type: 'string', description: 'Mailing state or province', optional: true },
  MailingPostalCode: { type: 'string', description: 'Mailing postal or ZIP code', optional: true },
  MailingCountry: { type: 'string', description: 'Mailing country', optional: true },
  MailingLatitude: { type: 'number', description: 'Mailing address latitude', optional: true },
  MailingLongitude: { type: 'number', description: 'Mailing address longitude', optional: true },
  OtherStreet: { type: 'string', description: 'Other street address', optional: true },
  OtherCity: { type: 'string', description: 'Other city', optional: true },
  OtherState: { type: 'string', description: 'Other state or province', optional: true },
  OtherPostalCode: { type: 'string', description: 'Other postal or ZIP code', optional: true },
  OtherCountry: { type: 'string', description: 'Other country', optional: true },
  Birthdate: { type: 'string', description: 'Date of birth (date only, no time)', optional: true },
  Description: { type: 'string', description: 'Contact description', optional: true },
  LeadSource: { type: 'string', description: 'Source of the contact lead', optional: true },
  OwnerId: { type: 'string', description: 'ID of the user who owns this contact', optional: true },
  HasOptedOutOfEmail: {
    type: 'boolean',
    description: 'Whether contact opted out of email',
    optional: true,
  },
  HasOptedOutOfFax: {
    type: 'boolean',
    description: 'Whether contact opted out of fax',
    optional: true,
  },
  DoNotCall: { type: 'boolean', description: 'Do not call preference', optional: true },
  CreatedDate: { type: 'string', description: 'ISO 8601 timestamp when created', optional: true },
  CreatedById: { type: 'string', description: 'ID of user who created the record', optional: true },
  LastModifiedDate: {
    type: 'string',
    description: 'ISO 8601 timestamp when last modified',
    optional: true,
  },
  LastModifiedById: {
    type: 'string',
    description: 'ID of user who last modified the record',
    optional: true,
  },
  LastActivityDate: {
    type: 'string',
    description: 'Date of last activity on the contact',
    optional: true,
  },
  EmailBouncedReason: { type: 'string', description: 'Reason for email bounce', optional: true },
  EmailBouncedDate: { type: 'string', description: 'Date of email bounce', optional: true },
  PhotoUrl: { type: 'string', description: 'URL to contact photo', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Contact object output definition for single record
 */
export const CONTACT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Salesforce Contact object',
  properties: CONTACT_OUTPUT_PROPERTIES,
}

/**
 * Contacts array output definition for list operations
 */
export const CONTACTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Salesforce Contact objects',
  items: {
    type: 'object',
    properties: CONTACT_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for Lead sObject
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_lead.htm
 */
export const LEAD_OUTPUT_PROPERTIES = {
  Id: { type: 'string', description: 'Unique 18-character Salesforce record identifier' },
  LastName: { type: 'string', description: 'Last name (required, max 80 characters)' },
  FirstName: { type: 'string', description: 'First name (max 40 characters)', optional: true },
  Salutation: { type: 'string', description: 'Salutation picklist', optional: true },
  Name: { type: 'string', description: 'Full name (read-only)', optional: true },
  Title: { type: 'string', description: 'Job title', optional: true },
  Company: { type: 'string', description: 'Company name (required, max 255 characters)' },
  Street: { type: 'string', description: 'Street address', optional: true },
  City: { type: 'string', description: 'City', optional: true },
  State: { type: 'string', description: 'State or province', optional: true },
  PostalCode: { type: 'string', description: 'Postal or ZIP code', optional: true },
  Country: { type: 'string', description: 'Country', optional: true },
  Latitude: { type: 'number', description: 'Address latitude', optional: true },
  Longitude: { type: 'number', description: 'Address longitude', optional: true },
  Phone: { type: 'string', description: 'Phone number', optional: true },
  MobilePhone: { type: 'string', description: 'Mobile phone number', optional: true },
  Fax: { type: 'string', description: 'Fax number', optional: true },
  Email: { type: 'string', description: 'Email address', optional: true },
  Website: { type: 'string', description: 'Website URL', optional: true },
  Description: { type: 'string', description: 'Lead description', optional: true },
  LeadSource: {
    type: 'string',
    description: 'Source of the lead (e.g., Web, Phone Inquiry, Partner Referral)',
    optional: true,
  },
  Status: {
    type: 'string',
    description:
      'Lead status (e.g., Open - Not Contacted, Working - Contacted, Closed - Converted)',
  },
  Industry: { type: 'string', description: 'Industry picklist value', optional: true },
  Rating: { type: 'string', description: 'Lead rating (e.g., Hot, Warm, Cold)', optional: true },
  AnnualRevenue: { type: 'number', description: 'Annual revenue', optional: true },
  NumberOfEmployees: { type: 'number', description: 'Number of employees', optional: true },
  OwnerId: { type: 'string', description: 'ID of the user who owns this lead', optional: true },
  IsConverted: {
    type: 'boolean',
    description: 'Whether the lead has been converted',
    optional: true,
  },
  ConvertedDate: { type: 'string', description: 'Date when lead was converted', optional: true },
  ConvertedAccountId: {
    type: 'string',
    description: 'ID of the account created on conversion',
    optional: true,
  },
  ConvertedContactId: {
    type: 'string',
    description: 'ID of the contact created on conversion',
    optional: true,
  },
  ConvertedOpportunityId: {
    type: 'string',
    description: 'ID of the opportunity created on conversion',
    optional: true,
  },
  IsUnreadByOwner: { type: 'boolean', description: 'Whether unread by owner', optional: true },
  HasOptedOutOfEmail: {
    type: 'boolean',
    description: 'Whether opted out of email',
    optional: true,
  },
  DoNotCall: { type: 'boolean', description: 'Do not call preference', optional: true },
  CreatedDate: { type: 'string', description: 'ISO 8601 timestamp when created', optional: true },
  CreatedById: { type: 'string', description: 'ID of user who created the record', optional: true },
  LastModifiedDate: {
    type: 'string',
    description: 'ISO 8601 timestamp when last modified',
    optional: true,
  },
  LastModifiedById: {
    type: 'string',
    description: 'ID of user who last modified the record',
    optional: true,
  },
  LastActivityDate: { type: 'string', description: 'Date of last activity', optional: true },
  LastViewedDate: { type: 'string', description: 'Date last viewed', optional: true },
  EmailBouncedReason: { type: 'string', description: 'Reason for email bounce', optional: true },
  EmailBouncedDate: { type: 'string', description: 'Date of email bounce', optional: true },
  PhotoUrl: { type: 'string', description: 'URL to lead photo', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Lead object output definition for single record
 */
export const LEAD_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Salesforce Lead object',
  properties: LEAD_OUTPUT_PROPERTIES,
}

/**
 * Leads array output definition for list operations
 */
export const LEADS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Salesforce Lead objects',
  items: {
    type: 'object',
    properties: LEAD_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for Opportunity sObject
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_opportunity.htm
 */
export const OPPORTUNITY_OUTPUT_PROPERTIES = {
  Id: { type: 'string', description: 'Unique 18-character Salesforce record identifier' },
  AccountId: { type: 'string', description: 'ID of the associated account', optional: true },
  Name: { type: 'string', description: 'Opportunity name (required, max 120 characters)' },
  Description: { type: 'string', description: 'Opportunity description', optional: true },
  StageName: {
    type: 'string',
    description: 'Current stage (e.g., Prospecting, Qualification, Needs Analysis, Closed Won)',
  },
  Amount: { type: 'number', description: 'Estimated total sale amount', optional: true },
  Probability: { type: 'number', description: 'Probability of closing (0-100%)', optional: true },
  ExpectedRevenue: {
    type: 'number',
    description: 'Expected revenue (Amount * Probability)',
    optional: true,
  },
  CloseDate: { type: 'string', description: 'Expected close date (required, date only)' },
  Type: {
    type: 'string',
    description: 'Opportunity type (e.g., New Business, Existing Business)',
    optional: true,
  },
  NextStep: { type: 'string', description: 'Next step in the sales process', optional: true },
  LeadSource: { type: 'string', description: 'Source of the opportunity', optional: true },
  IsClosed: { type: 'boolean', description: 'Whether the opportunity is closed', optional: true },
  IsWon: { type: 'boolean', description: 'Whether the opportunity was won', optional: true },
  ForecastCategory: {
    type: 'string',
    description: 'Forecast category (Pipeline, Best Case, Commit, Closed)',
    optional: true,
  },
  ForecastCategoryName: {
    type: 'string',
    description: 'Forecast category display name',
    optional: true,
  },
  CampaignId: { type: 'string', description: 'ID of the primary campaign source', optional: true },
  HasOpportunityLineItem: {
    type: 'boolean',
    description: 'Whether opportunity has line items',
    optional: true,
  },
  Pricebook2Id: {
    type: 'string',
    description: 'ID of the associated price book',
    optional: true,
  },
  OwnerId: {
    type: 'string',
    description: 'ID of the user who owns this opportunity',
    optional: true,
  },
  TotalOpportunityQuantity: {
    type: 'number',
    description: 'Total quantity of line items',
    optional: true,
  },
  CreatedDate: { type: 'string', description: 'ISO 8601 timestamp when created', optional: true },
  CreatedById: { type: 'string', description: 'ID of user who created the record', optional: true },
  LastModifiedDate: {
    type: 'string',
    description: 'ISO 8601 timestamp when last modified',
    optional: true,
  },
  LastModifiedById: {
    type: 'string',
    description: 'ID of user who last modified the record',
    optional: true,
  },
  LastActivityDate: { type: 'string', description: 'Date of last activity', optional: true },
  LastStageChangeDate: { type: 'string', description: 'Date of last stage change', optional: true },
  LastViewedDate: { type: 'string', description: 'Date last viewed', optional: true },
  FiscalQuarter: { type: 'number', description: 'Fiscal quarter (1-4)', optional: true },
  FiscalYear: { type: 'number', description: 'Fiscal year', optional: true },
  ContactId: { type: 'string', description: 'ID of the primary contact', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Opportunity object output definition for single record
 */
export const OPPORTUNITY_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Salesforce Opportunity object',
  properties: OPPORTUNITY_OUTPUT_PROPERTIES,
}

/**
 * Opportunities array output definition for list operations
 */
export const OPPORTUNITIES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Salesforce Opportunity objects',
  items: {
    type: 'object',
    properties: OPPORTUNITY_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for Case sObject
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_case.htm
 */
export const CASE_OUTPUT_PROPERTIES = {
  Id: { type: 'string', description: 'Unique 18-character Salesforce record identifier' },
  CaseNumber: { type: 'string', description: 'Auto-generated case number (read-only)' },
  ContactId: { type: 'string', description: 'ID of the associated contact', optional: true },
  AccountId: { type: 'string', description: 'ID of the associated account', optional: true },
  AssetId: { type: 'string', description: 'ID of the associated asset', optional: true },
  ParentId: { type: 'string', description: 'ID of the parent case', optional: true },
  SuppliedName: { type: 'string', description: 'Name supplied by web form', optional: true },
  SuppliedEmail: { type: 'string', description: 'Email supplied by web form', optional: true },
  SuppliedPhone: { type: 'string', description: 'Phone supplied by web form', optional: true },
  SuppliedCompany: { type: 'string', description: 'Company supplied by web form', optional: true },
  Type: {
    type: 'string',
    description: 'Case type (e.g., Question, Problem, Feature Request)',
    optional: true,
  },
  Status: {
    type: 'string',
    description: 'Case status (e.g., New, Working, Escalated, Closed)',
    optional: true,
  },
  Reason: { type: 'string', description: 'Reason for the case', optional: true },
  Origin: {
    type: 'string',
    description: 'How the case originated (e.g., Email, Phone, Web)',
    optional: true,
  },
  Subject: { type: 'string', description: 'Case subject line', optional: true },
  Priority: {
    type: 'string',
    description: 'Case priority (e.g., High, Medium, Low)',
    optional: true,
  },
  Description: { type: 'string', description: 'Case description', optional: true },
  IsClosed: { type: 'boolean', description: 'Whether the case is closed', optional: true },
  ClosedDate: { type: 'string', description: 'Date when case was closed', optional: true },
  IsEscalated: { type: 'boolean', description: 'Whether the case is escalated', optional: true },
  OwnerId: {
    type: 'string',
    description: 'ID of the user or queue that owns this case',
    optional: true,
  },
  CreatedDate: { type: 'string', description: 'ISO 8601 timestamp when created', optional: true },
  CreatedById: { type: 'string', description: 'ID of user who created the record', optional: true },
  LastModifiedDate: {
    type: 'string',
    description: 'ISO 8601 timestamp when last modified',
    optional: true,
  },
  LastModifiedById: {
    type: 'string',
    description: 'ID of user who last modified the record',
    optional: true,
  },
  LastViewedDate: { type: 'string', description: 'Date last viewed', optional: true },
  ContactPhone: {
    type: 'string',
    description: 'Contact phone (read-only from contact)',
    optional: true,
  },
  ContactMobile: {
    type: 'string',
    description: 'Contact mobile (read-only from contact)',
    optional: true,
  },
  ContactEmail: {
    type: 'string',
    description: 'Contact email (read-only from contact)',
    optional: true,
  },
  ContactFax: {
    type: 'string',
    description: 'Contact fax (read-only from contact)',
    optional: true,
  },
  Comments: { type: 'string', description: 'Internal comments on the case', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Case object output definition for single record
 */
export const CASE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Salesforce Case object',
  properties: CASE_OUTPUT_PROPERTIES,
}

/**
 * Cases array output definition for list operations
 */
export const CASES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Salesforce Case objects',
  items: {
    type: 'object',
    properties: CASE_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for Task sObject
 * @see https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_task.htm
 */
export const TASK_OUTPUT_PROPERTIES = {
  Id: { type: 'string', description: 'Unique 18-character Salesforce record identifier' },
  WhoId: {
    type: 'string',
    description: 'ID of the related lead or contact (Name field)',
    optional: true,
  },
  WhatId: {
    type: 'string',
    description: 'ID of the related account, opportunity, campaign, case, or custom object',
    optional: true,
  },
  Subject: { type: 'string', description: 'Task subject', optional: true },
  ActivityDate: { type: 'string', description: 'Due date (date only)', optional: true },
  Status: {
    type: 'string',
    description:
      'Task status (e.g., Not Started, In Progress, Completed, Waiting on someone else, Deferred)',
  },
  Priority: {
    type: 'string',
    description: 'Task priority (e.g., High, Normal, Low)',
    optional: true,
  },
  IsHighPriority: { type: 'boolean', description: 'Whether task is high priority', optional: true },
  OwnerId: { type: 'string', description: 'ID of the user who owns this task', optional: true },
  Description: { type: 'string', description: 'Task description or comments', optional: true },
  Type: { type: 'string', description: 'Task type (e.g., Call, Email, Meeting)', optional: true },
  IsClosed: { type: 'boolean', description: 'Whether the task is closed', optional: true },
  IsArchived: { type: 'boolean', description: 'Whether the task is archived', optional: true },
  AccountId: {
    type: 'string',
    description: 'ID of the related account (read-only, derived from WhatId)',
    optional: true,
  },
  IsRecurrence: {
    type: 'boolean',
    description: 'Whether this is a recurring task',
    optional: true,
  },
  IsReminderSet: { type: 'boolean', description: 'Whether a reminder is set', optional: true },
  ReminderDateTime: { type: 'string', description: 'Reminder date/time', optional: true },
  CallDurationInSeconds: {
    type: 'number',
    description: 'Call duration in seconds',
    optional: true,
  },
  CallType: {
    type: 'string',
    description: 'Call type (Inbound, Outbound, Internal)',
    optional: true,
  },
  CallDisposition: { type: 'string', description: 'Call result', optional: true },
  TaskSubtype: {
    type: 'string',
    description: 'Task subtype (Task, Email, Call, List Email, Cadence)',
    optional: true,
  },
  CompletedDateTime: {
    type: 'string',
    description: 'Date/time when task was completed',
    optional: true,
  },
  CreatedDate: { type: 'string', description: 'ISO 8601 timestamp when created', optional: true },
  CreatedById: { type: 'string', description: 'ID of user who created the record', optional: true },
  LastModifiedDate: {
    type: 'string',
    description: 'ISO 8601 timestamp when last modified',
    optional: true,
  },
  LastModifiedById: {
    type: 'string',
    description: 'ID of user who last modified the record',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Task object output definition for single record
 */
export const TASK_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Salesforce Task object',
  properties: TASK_OUTPUT_PROPERTIES,
}

/**
 * Tasks array output definition for list operations
 */
export const TASKS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Salesforce Task objects',
  items: {
    type: 'object',
    properties: TASK_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for Report list item
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_get_reportlist.htm
 */
export const REPORT_LIST_ITEM_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Report ID' },
  name: { type: 'string', description: 'Report name' },
  url: { type: 'string', description: 'URL to access the report', optional: true },
  describeUrl: { type: 'string', description: 'URL to describe the report', optional: true },
  instancesUrl: { type: 'string', description: 'URL to report instances', optional: true },
  folderName: {
    type: 'string',
    description: 'Name of the folder containing the report',
    optional: true,
  },
  folderId: {
    type: 'string',
    description: 'ID of the folder containing the report',
    optional: true,
  },
  description: { type: 'string', description: 'Report description', optional: true },
  format: {
    type: 'string',
    description: 'Report format (TABULAR, SUMMARY, MATRIX, JOINED)',
    optional: true,
  },
  reportTypeApiName: {
    type: 'string',
    description: 'API name of the report type',
    optional: true,
  },
  lastModifiedBy: {
    type: 'object',
    description: 'User who last modified the report',
    optional: true,
  },
  lastModifiedDate: {
    type: 'string',
    description: 'Date when report was last modified',
    optional: true,
  },
  lastRunDate: { type: 'string', description: 'Date when report was last run', optional: true },
  lastViewedDate: {
    type: 'string',
    description: 'Date when report was last viewed',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Reports array output definition
 */
export const REPORTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Salesforce Report objects',
  items: {
    type: 'object',
    properties: REPORT_LIST_ITEM_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for Dashboard list item
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_getbasic_dashboardlist.htm
 */
export const DASHBOARD_LIST_ITEM_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Dashboard ID' },
  name: { type: 'string', description: 'Dashboard name' },
  url: { type: 'string', description: 'URL to access the dashboard', optional: true },
  statusUrl: { type: 'string', description: 'URL to dashboard status', optional: true },
  folderName: {
    type: 'string',
    description: 'Name of the folder containing the dashboard',
    optional: true,
  },
  folderId: {
    type: 'string',
    description: 'ID of the folder containing the dashboard',
    optional: true,
  },
  description: { type: 'string', description: 'Dashboard description', optional: true },
  runningUser: {
    type: 'object',
    description: 'User context for dashboard data',
    optional: true,
  },
  type: { type: 'string', description: 'Dashboard type', optional: true },
  lastRefreshedDate: {
    type: 'string',
    description: 'Date when dashboard was last refreshed',
    optional: true,
  },
  canChangeRunningUser: {
    type: 'boolean',
    description: 'Whether running user can be changed',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Dashboards array output definition
 */
export const DASHBOARDS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Salesforce Dashboard objects',
  items: {
    type: 'object',
    properties: DASHBOARD_LIST_ITEM_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for Report Type list item
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_list_reporttypes.htm
 */
export const REPORT_TYPE_OUTPUT_PROPERTIES = {
  apiName: { type: 'string', description: 'API name of the report type' },
  label: { type: 'string', description: 'Display label of the report type' },
  describeUrl: { type: 'string', description: 'URL to describe the report type', optional: true },
  isEmbedded: {
    type: 'boolean',
    description: 'Whether this is an embedded report type',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Report types array output definition
 */
export const REPORT_TYPES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of Salesforce Report Type objects',
  items: {
    type: 'object',
    properties: REPORT_TYPE_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for sObject describe field metadata
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_sobject_describe.htm
 */
export const FIELD_DESCRIBE_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'API name of the field' },
  label: { type: 'string', description: 'Display label of the field' },
  type: {
    type: 'string',
    description: 'Field data type (string, boolean, int, double, date, etc.)',
  },
  length: { type: 'number', description: 'Maximum length for text fields', optional: true },
  precision: { type: 'number', description: 'Precision for numeric fields', optional: true },
  scale: { type: 'number', description: 'Scale for numeric fields', optional: true },
  nillable: { type: 'boolean', description: 'Whether the field can be null' },
  unique: { type: 'boolean', description: 'Whether values must be unique', optional: true },
  createable: { type: 'boolean', description: 'Whether field can be set on create' },
  updateable: { type: 'boolean', description: 'Whether field can be updated' },
  defaultedOnCreate: {
    type: 'boolean',
    description: 'Whether field has default value on create',
    optional: true,
  },
  calculated: { type: 'boolean', description: 'Whether field is a formula field', optional: true },
  autoNumber: { type: 'boolean', description: 'Whether field is auto-number', optional: true },
  externalId: { type: 'boolean', description: 'Whether field is an external ID', optional: true },
  idLookup: {
    type: 'boolean',
    description: 'Whether field can be used in ID lookup',
    optional: true,
  },
  inlineHelpText: { type: 'string', description: 'Help text for the field', optional: true },
  picklistValues: {
    type: 'array',
    description: 'Available picklist values for picklist fields',
    optional: true,
  },
  referenceTo: {
    type: 'array',
    description: 'Objects this field can reference (for lookup fields)',
    optional: true,
  },
  relationshipName: {
    type: 'string',
    description: 'Relationship name for lookup fields',
    optional: true,
  },
  custom: { type: 'boolean', description: 'Whether this is a custom field', optional: true },
  filterable: {
    type: 'boolean',
    description: 'Whether field can be used in SOQL filter',
    optional: true,
  },
  groupable: {
    type: 'boolean',
    description: 'Whether field can be used in GROUP BY',
    optional: true,
  },
  sortable: {
    type: 'boolean',
    description: 'Whether field can be used in ORDER BY',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Fields array output definition
 */
export const FIELDS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of field metadata objects',
  items: {
    type: 'object',
    properties: FIELD_DESCRIBE_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for sObject list item from describeGlobal
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_describeGlobal.htm
 */
export const SOBJECT_LIST_ITEM_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'API name of the object' },
  label: { type: 'string', description: 'Display label of the object' },
  labelPlural: { type: 'string', description: 'Plural display label', optional: true },
  keyPrefix: { type: 'string', description: 'Three-character ID prefix', optional: true },
  custom: { type: 'boolean', description: 'Whether this is a custom object', optional: true },
  queryable: { type: 'boolean', description: 'Whether object can be queried', optional: true },
  createable: { type: 'boolean', description: 'Whether records can be created', optional: true },
  updateable: { type: 'boolean', description: 'Whether records can be updated', optional: true },
  deletable: { type: 'boolean', description: 'Whether records can be deleted', optional: true },
  searchable: { type: 'boolean', description: 'Whether object is searchable', optional: true },
  triggerable: { type: 'boolean', description: 'Whether triggers are supported', optional: true },
  layoutable: {
    type: 'boolean',
    description: 'Whether page layouts are supported',
    optional: true,
  },
  replicateable: {
    type: 'boolean',
    description: 'Whether object can be replicated',
    optional: true,
  },
  retrieveable: {
    type: 'boolean',
    description: 'Whether records can be retrieved',
    optional: true,
  },
  undeletable: {
    type: 'boolean',
    description: 'Whether records can be undeleted',
    optional: true,
  },
  urls: { type: 'object', description: 'URLs for accessing object resources', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * sObjects array output definition
 */
export const SOBJECTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of sObject metadata',
  items: {
    type: 'object',
    properties: SOBJECT_LIST_ITEM_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for sObject create response.
 * Salesforce returns id, success, and errors array on POST to /sobjects/{ObjectName}.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_sobject_create.htm
 */
export const SOBJECT_CREATE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'The Salesforce ID of the newly created record' },
  success: { type: 'boolean', description: 'Whether the create operation was successful' },
  created: {
    type: 'boolean',
    description: 'Whether the record was created (always true on success)',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for sObject update response.
 * Salesforce returns HTTP 204 No Content on successful PATCH to /sobjects/{ObjectName}/{Id}.
 * The id and updated fields are derived from the request parameters.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_update_fields.htm
 */
export const SOBJECT_UPDATE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'The Salesforce ID of the updated record' },
  updated: {
    type: 'boolean',
    description: 'Whether the record was updated (always true on success)',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for sObject delete response.
 * Salesforce returns HTTP 204 No Content on successful DELETE to /sobjects/{ObjectName}/{Id}.
 * The id and deleted fields are derived from the request parameters.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_delete_record.htm
 */
export const SOBJECT_DELETE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'The Salesforce ID of the deleted record' },
  deleted: {
    type: 'boolean',
    description: 'Whether the record was deleted (always true on success)',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for SOQL query pagination fields.
 * These fields are returned by all SOQL query endpoints.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_query.htm
 */
export const QUERY_PAGING_OUTPUT_PROPERTIES = {
  nextRecordsUrl: {
    type: 'string',
    description: 'URL to fetch the next batch of records (present when done is false)',
    optional: true,
  },
  totalSize: {
    type: 'number',
    description: 'Total number of records matching the query (may exceed records returned)',
  },
  done: {
    type: 'boolean',
    description: 'Whether all records have been returned (false if more batches exist)',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete paging output definition for list operations
 */
export const QUERY_PAGING_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Pagination information from Salesforce API',
  properties: QUERY_PAGING_OUTPUT_PROPERTIES,
}

/**
 * Output definition for response metadata (computed fields, not from Salesforce API)
 */
export const RESPONSE_METADATA_OUTPUT_PROPERTIES = {
  totalReturned: {
    type: 'number',
    description: 'Number of records returned in this response',
  },
  hasMore: {
    type: 'boolean',
    description: 'Whether more records exist (inverse of done)',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete metadata output definition
 */
export const RESPONSE_METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Response metadata',
  properties: RESPONSE_METADATA_OUTPUT_PROPERTIES,
}

/**
 * Output definition for SOQL query response.
 * The query endpoint returns records array along with pagination fields.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_query.htm
 */
export const QUERY_OUTPUT_PROPERTIES = {
  records: {
    type: 'array',
    description: 'Array of sObject records matching the query',
  },
  totalSize: QUERY_PAGING_OUTPUT_PROPERTIES.totalSize,
  done: QUERY_PAGING_OUTPUT_PROPERTIES.done,
  nextRecordsUrl: QUERY_PAGING_OUTPUT_PROPERTIES.nextRecordsUrl,
  query: { type: 'string', description: 'The executed SOQL query' },
  metadata: RESPONSE_METADATA_OUTPUT,
  success: { type: 'boolean', description: 'Salesforce operation success' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for SOQL query more response.
 * Similar to QUERY_OUTPUT_PROPERTIES but without the query field.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_query.htm
 */
export const QUERY_MORE_OUTPUT_PROPERTIES = {
  records: {
    type: 'array',
    description: 'Array of sObject records matching the query',
  },
  totalSize: QUERY_PAGING_OUTPUT_PROPERTIES.totalSize,
  done: QUERY_PAGING_OUTPUT_PROPERTIES.done,
  nextRecordsUrl: QUERY_PAGING_OUTPUT_PROPERTIES.nextRecordsUrl,
  metadata: RESPONSE_METADATA_OUTPUT,
  success: { type: 'boolean', description: 'Salesforce operation success' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for sObject Describe response fields.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_sobject_describe.htm
 */
export const DESCRIBE_OBJECT_OUTPUT_PROPERTIES = {
  objectName: {
    type: 'string',
    description: 'API name of the object (e.g., Account, Contact)',
  },
  label: { type: 'string', description: 'Human-readable singular label for the object' },
  labelPlural: { type: 'string', description: 'Human-readable plural label for the object' },
  fields: FIELDS_OUTPUT,
  keyPrefix: {
    type: 'string',
    description: 'Three-character prefix used in record IDs (e.g., "001" for Account)',
    optional: true,
  },
  queryable: { type: 'boolean', description: 'Whether the object can be queried via SOQL' },
  createable: { type: 'boolean', description: 'Whether records can be created for this object' },
  updateable: { type: 'boolean', description: 'Whether records can be updated for this object' },
  deletable: { type: 'boolean', description: 'Whether records can be deleted for this object' },
  childRelationships: {
    type: 'array',
    description: 'Array of child relationship metadata for related objects',
  },
  recordTypeInfos: {
    type: 'array',
    description: 'Array of record type information for the object',
  },
  fieldCount: { type: 'number', description: 'Total number of fields on the object' },
  success: { type: 'boolean', description: 'Salesforce operation success' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for Describe Global (list sObjects) response.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_describeGlobal.htm
 */
export const LIST_OBJECTS_OUTPUT_PROPERTIES = {
  objects: SOBJECTS_OUTPUT,
  encoding: {
    type: 'string',
    description: 'Character encoding for the organization (e.g., UTF-8)',
    optional: true,
  },
  maxBatchSize: {
    type: 'number',
    description:
      'Maximum number of records that can be returned in a single query batch (typically 200)',
    optional: true,
  },
  totalReturned: { type: 'number', description: 'Number of objects returned' },
  success: { type: 'boolean', description: 'Salesforce operation success' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for list operations returning a simple count
 */
export const LIST_OUTPUT_PROPERTIES = {
  totalReturned: { type: 'number', description: 'Number of items returned' },
  success: { type: 'boolean', description: 'Salesforce operation success' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for report run results.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_get_reportdata.htm
 */
export const RUN_REPORT_OUTPUT_PROPERTIES = {
  reportId: { type: 'string', description: 'Report ID' },
  reportMetadata: {
    type: 'object',
    description: 'Report metadata including name, format, and filter definitions',
    optional: true,
  },
  reportExtendedMetadata: {
    type: 'object',
    description: 'Extended metadata for aggregate columns and groupings',
    optional: true,
  },
  factMap: {
    type: 'object',
    description: 'Report data organized by groupings with aggregates and row data',
    optional: true,
  },
  groupingsDown: {
    type: 'object',
    description: 'Row grouping hierarchy and values',
    optional: true,
  },
  groupingsAcross: {
    type: 'object',
    description: 'Column grouping hierarchy and values',
    optional: true,
  },
  hasDetailRows: {
    type: 'boolean',
    description: 'Whether the report includes detail-level row data',
    optional: true,
  },
  allData: {
    type: 'boolean',
    description: 'Whether all data is returned (false if truncated due to size limits)',
    optional: true,
  },
  reportName: {
    type: 'string',
    description: 'Display name of the report',
    optional: true,
  },
  reportFormat: {
    type: 'string',
    description: 'Report format type (TABULAR, SUMMARY, MATRIX, JOINED)',
    optional: true,
  },
  success: { type: 'boolean', description: 'Salesforce operation success' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for get report metadata response.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_get_reportmetadata.htm
 */
export const GET_REPORT_OUTPUT_PROPERTIES = {
  report: { type: 'object', description: 'Report metadata object' },
  reportId: { type: 'string', description: 'Report ID' },
  success: { type: 'boolean', description: 'Salesforce operation success' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for dashboard response.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_dashboard_results.htm
 */
export const DASHBOARD_OUTPUT_PROPERTIES = {
  dashboard: { type: 'object', description: 'Full dashboard details object' },
  dashboardId: { type: 'string', description: 'Dashboard ID' },
  components: {
    type: 'array',
    description: 'Array of dashboard component data with visualizations and filters',
  },
  dashboardName: {
    type: 'string',
    description: 'Display name of the dashboard',
    optional: true,
  },
  folderId: {
    type: 'string',
    description: 'ID of the folder containing the dashboard',
    optional: true,
  },
  runningUser: {
    type: 'object',
    description: 'User context under which the dashboard data was retrieved',
    optional: true,
  },
  success: { type: 'boolean', description: 'Salesforce operation success' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for dashboard refresh response.
 * @see https://developer.salesforce.com/docs/atlas.en-us.api_analytics.meta/api_analytics/sforce_analytics_rest_api_refresh_dashboard.htm
 */
export const REFRESH_DASHBOARD_OUTPUT_PROPERTIES = {
  dashboard: { type: 'object', description: 'Full dashboard details object' },
  dashboardId: { type: 'string', description: 'Dashboard ID' },
  components: {
    type: 'array',
    description: 'Array of dashboard component data with fresh visualizations',
  },
  status: {
    type: 'object',
    description: 'Dashboard refresh status information',
    optional: true,
  },
  dashboardName: {
    type: 'string',
    description: 'Display name of the dashboard',
    optional: true,
  },
  refreshDate: {
    type: 'string',
    description: 'ISO 8601 timestamp when the dashboard was last refreshed',
    optional: true,
  },
  success: { type: 'boolean', description: 'Salesforce operation success' },
} as const satisfies Record<string, OutputProperty>

/**
 * Base parameters shared by all Salesforce operations
 */
export interface BaseSalesforceParams {
  accessToken: string
  idToken?: string
  instanceUrl?: string
}

/**
 * Common paging structure for list operations
 */
export interface SalesforcePaging {
  nextRecordsUrl?: string
  totalSize: number
  done: boolean
}

export interface SalesforceAccount {
  Id: string
  Name: string
  Type?: string
  Industry?: string
  BillingStreet?: string
  BillingCity?: string
  BillingState?: string
  BillingPostalCode?: string
  BillingCountry?: string
  Phone?: string
  Website?: string
  AnnualRevenue?: number
  NumberOfEmployees?: number
  Description?: string
  OwnerId?: string
  CreatedDate?: string
  LastModifiedDate?: string
  [key: string]: any
}

export interface SalesforceGetAccountsParams extends BaseSalesforceParams {
  limit?: string
  fields?: string
  orderBy?: string
}

export interface SalesforceGetAccountsResponse extends ToolResponse {
  output: {
    accounts: SalesforceAccount[]
    paging?: SalesforcePaging
    metadata?: {
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}

export interface SalesforceCreateAccountParams extends BaseSalesforceParams {
  name: string
  type?: string
  industry?: string
  phone?: string
  website?: string
  billingStreet?: string
  billingCity?: string
  billingState?: string
  billingPostalCode?: string
  billingCountry?: string
  description?: string
  annualRevenue?: string
  numberOfEmployees?: string
}

export interface SalesforceCreateAccountResponse {
  success: boolean
  output: {
    id: string
    success: boolean
    created: boolean
  }
}

export interface SalesforceUpdateAccountParams extends BaseSalesforceParams {
  accountId: string
  name?: string
  type?: string
  industry?: string
  phone?: string
  website?: string
  billingStreet?: string
  billingCity?: string
  billingState?: string
  billingPostalCode?: string
  billingCountry?: string
  description?: string
  annualRevenue?: string
  numberOfEmployees?: string
}

export interface SalesforceUpdateAccountResponse {
  success: boolean
  output: {
    id: string
    updated: boolean
  }
}

export interface SalesforceDeleteAccountParams extends BaseSalesforceParams {
  accountId: string
}

export interface SalesforceDeleteAccountResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
  }
}

export interface SalesforceGetContactsParams extends BaseSalesforceParams {
  contactId?: string
  limit?: string
  fields?: string
  orderBy?: string
}

export interface SalesforceGetContactsResponse {
  success: boolean
  output: {
    contacts?: any[]
    contact?: any
    paging?: SalesforcePaging
    metadata?: {
      totalReturned: number
      hasMore: boolean
    }
    singleContact?: boolean
    success: boolean
  }
}

export interface SalesforceCreateContactParams extends BaseSalesforceParams {
  lastName: string
  firstName?: string
  email?: string
  phone?: string
  accountId?: string
  title?: string
  department?: string
  mailingStreet?: string
  mailingCity?: string
  mailingState?: string
  mailingPostalCode?: string
  mailingCountry?: string
  description?: string
}

export interface SalesforceCreateContactResponse {
  success: boolean
  output: {
    id: string
    success: boolean
    created: boolean
  }
}

export interface SalesforceUpdateContactParams extends BaseSalesforceParams {
  contactId: string
  lastName?: string
  firstName?: string
  email?: string
  phone?: string
  accountId?: string
  title?: string
  department?: string
  mailingStreet?: string
  mailingCity?: string
  mailingState?: string
  mailingPostalCode?: string
  mailingCountry?: string
  description?: string
}

export interface SalesforceUpdateContactResponse {
  success: boolean
  output: {
    id: string
    updated: boolean
  }
}

export interface SalesforceDeleteContactParams extends BaseSalesforceParams {
  contactId: string
}

export interface SalesforceDeleteContactResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
  }
}

export interface SalesforceGetLeadsParams extends BaseSalesforceParams {
  leadId?: string
  limit?: string
  fields?: string
  orderBy?: string
}

export interface SalesforceGetLeadsResponse {
  success: boolean
  output: {
    lead?: any
    leads?: any[]
    paging?: SalesforcePaging
    metadata?: {
      totalReturned: number
      hasMore: boolean
    }
    singleLead?: boolean
    success: boolean
  }
}

export interface SalesforceCreateLeadParams extends BaseSalesforceParams {
  lastName: string
  company: string
  firstName?: string
  email?: string
  phone?: string
  status?: string
  leadSource?: string
  title?: string
  description?: string
}

export interface SalesforceCreateLeadResponse {
  success: boolean
  output: {
    id: string
    success: boolean
    created: boolean
  }
}

export interface SalesforceUpdateLeadParams extends BaseSalesforceParams {
  leadId: string
  lastName?: string
  company?: string
  firstName?: string
  email?: string
  phone?: string
  status?: string
  leadSource?: string
  title?: string
  description?: string
}

export interface SalesforceUpdateLeadResponse {
  success: boolean
  output: {
    id: string
    updated: boolean
  }
}

export interface SalesforceDeleteLeadParams extends BaseSalesforceParams {
  leadId: string
}

export interface SalesforceDeleteLeadResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
  }
}

export interface SalesforceGetOpportunitiesParams extends BaseSalesforceParams {
  opportunityId?: string
  limit?: string
  fields?: string
  orderBy?: string
}

export interface SalesforceGetOpportunitiesResponse {
  success: boolean
  output: {
    opportunity?: any
    opportunities?: any[]
    paging?: SalesforcePaging
    metadata?: {
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}

export interface SalesforceCreateOpportunityParams extends BaseSalesforceParams {
  name: string
  stageName: string
  closeDate: string
  accountId?: string
  amount?: string
  probability?: string
  description?: string
}

export interface SalesforceCreateOpportunityResponse {
  success: boolean
  output: {
    id: string
    success: boolean
    created: boolean
  }
}

export interface SalesforceUpdateOpportunityParams extends BaseSalesforceParams {
  opportunityId: string
  name?: string
  stageName?: string
  closeDate?: string
  accountId?: string
  amount?: string
  probability?: string
  description?: string
}

export interface SalesforceUpdateOpportunityResponse {
  success: boolean
  output: {
    id: string
    updated: boolean
  }
}

export interface SalesforceDeleteOpportunityParams extends BaseSalesforceParams {
  opportunityId: string
}

export interface SalesforceDeleteOpportunityResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
  }
}

export interface SalesforceGetCasesParams extends BaseSalesforceParams {
  caseId?: string
  limit?: string
  fields?: string
  orderBy?: string
}

export interface SalesforceGetCasesResponse {
  success: boolean
  output: {
    case?: any
    cases?: any[]
    paging?: SalesforcePaging
    metadata?: {
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}

export interface SalesforceCreateCaseParams extends BaseSalesforceParams {
  subject: string
  status?: string
  priority?: string
  origin?: string
  contactId?: string
  accountId?: string
  description?: string
}

export interface SalesforceCreateCaseResponse {
  success: boolean
  output: {
    id: string
    success: boolean
    created: boolean
  }
}

export interface SalesforceUpdateCaseParams extends BaseSalesforceParams {
  caseId: string
  subject?: string
  status?: string
  priority?: string
  description?: string
}

export interface SalesforceUpdateCaseResponse {
  success: boolean
  output: {
    id: string
    updated: boolean
  }
}

export interface SalesforceDeleteCaseParams extends BaseSalesforceParams {
  caseId: string
}

export interface SalesforceDeleteCaseResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
  }
}

export interface SalesforceGetTasksParams extends BaseSalesforceParams {
  taskId?: string
  limit?: string
  fields?: string
  orderBy?: string
}

export interface SalesforceGetTasksResponse {
  success: boolean
  output: {
    task?: any
    tasks?: any[]
    paging?: SalesforcePaging
    metadata?: {
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}

export interface SalesforceCreateTaskParams extends BaseSalesforceParams {
  subject: string
  status?: string
  priority?: string
  activityDate?: string
  whoId?: string
  whatId?: string
  description?: string
}

export interface SalesforceCreateTaskResponse {
  success: boolean
  output: {
    id: string
    success: boolean
    created: boolean
  }
}

export interface SalesforceUpdateTaskParams extends BaseSalesforceParams {
  taskId: string
  subject?: string
  status?: string
  priority?: string
  activityDate?: string
  description?: string
}

export interface SalesforceUpdateTaskResponse {
  success: boolean
  output: {
    id: string
    updated: boolean
  }
}

export interface SalesforceDeleteTaskParams extends BaseSalesforceParams {
  taskId: string
}

export interface SalesforceDeleteTaskResponse {
  success: boolean
  output: {
    id: string
    deleted: boolean
  }
}

export interface SalesforceListReportsParams extends BaseSalesforceParams {
  folderName?: string
  searchTerm?: string
}

export interface SalesforceListReportsResponse {
  success: boolean
  output: {
    reports: any[]
    totalReturned: number
    success: boolean
  }
}

export interface SalesforceGetReportParams extends BaseSalesforceParams {
  reportId: string
}

export interface SalesforceGetReportResponse {
  success: boolean
  output: {
    report: any
    reportId: string
    success: boolean
  }
}

export interface SalesforceRunReportParams extends BaseSalesforceParams {
  reportId: string
  includeDetails?: string
  filters?: string
}

export interface SalesforceRunReportResponse {
  success: boolean
  output: {
    reportId: string
    reportMetadata?: any
    reportExtendedMetadata?: any
    factMap?: any
    groupingsDown?: any
    groupingsAcross?: any
    hasDetailRows?: boolean
    allData?: boolean
    reportName?: string
    reportFormat?: string
    success: boolean
  }
}

export interface SalesforceListReportTypesParams extends BaseSalesforceParams {}

export interface SalesforceListReportTypesResponse {
  success: boolean
  output: {
    reportTypes: any[]
    totalReturned: number
    success: boolean
  }
}

export interface SalesforceListDashboardsParams extends BaseSalesforceParams {
  folderName?: string
}

export interface SalesforceListDashboardsResponse {
  success: boolean
  output: {
    dashboards: any[]
    totalReturned: number
    success: boolean
  }
}

export interface SalesforceGetDashboardParams extends BaseSalesforceParams {
  dashboardId: string
}

export interface SalesforceGetDashboardResponse {
  success: boolean
  output: {
    dashboard: any
    dashboardId: string
    components: any[]
    dashboardName?: string
    folderId?: string
    runningUser?: any
    success: boolean
  }
}

export interface SalesforceRefreshDashboardParams extends BaseSalesforceParams {
  dashboardId: string
}

export interface SalesforceRefreshDashboardResponse {
  success: boolean
  output: {
    dashboard: any
    dashboardId: string
    components: any[]
    status?: any
    dashboardName?: string
    refreshDate?: string
    success: boolean
  }
}

export interface SalesforceQueryParams extends BaseSalesforceParams {
  query: string
}

export interface SalesforceQueryResponse {
  success: boolean
  output: {
    records: any[]
    totalSize: number
    done: boolean
    nextRecordsUrl?: string
    query: string
    metadata: {
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}

export interface SalesforceQueryMoreParams extends BaseSalesforceParams {
  nextRecordsUrl: string
}

export interface SalesforceQueryMoreResponse {
  success: boolean
  output: {
    records: any[]
    totalSize: number
    done: boolean
    nextRecordsUrl?: string
    metadata: {
      totalReturned: number
      hasMore: boolean
    }
    success: boolean
  }
}

export interface SalesforceDescribeObjectParams extends BaseSalesforceParams {
  objectName: string
}

export interface SalesforceDescribeObjectResponse {
  success: boolean
  output: {
    objectName: string
    label?: string
    labelPlural?: string
    fields?: any[]
    keyPrefix?: string
    queryable?: boolean
    createable?: boolean
    updateable?: boolean
    deletable?: boolean
    childRelationships?: any[]
    recordTypeInfos?: any[]
    fieldCount: number
    success: boolean
  }
}

export interface SalesforceListObjectsParams extends BaseSalesforceParams {}

export interface SalesforceListObjectsResponse {
  success: boolean
  output: {
    objects: any[]
    encoding?: string
    maxBatchSize?: number
    totalReturned: number
    success: boolean
  }
}

export type SalesforceResponse =
  | SalesforceGetAccountsResponse
  | SalesforceCreateAccountResponse
  | SalesforceUpdateAccountResponse
  | SalesforceDeleteAccountResponse
  | SalesforceGetContactsResponse
  | SalesforceCreateContactResponse
  | SalesforceUpdateContactResponse
  | SalesforceDeleteContactResponse
  | SalesforceGetLeadsResponse
  | SalesforceCreateLeadResponse
  | SalesforceUpdateLeadResponse
  | SalesforceDeleteLeadResponse
  | SalesforceGetOpportunitiesResponse
  | SalesforceCreateOpportunityResponse
  | SalesforceUpdateOpportunityResponse
  | SalesforceDeleteOpportunityResponse
  | SalesforceGetCasesResponse
  | SalesforceCreateCaseResponse
  | SalesforceUpdateCaseResponse
  | SalesforceDeleteCaseResponse
  | SalesforceGetTasksResponse
  | SalesforceCreateTaskResponse
  | SalesforceUpdateTaskResponse
  | SalesforceDeleteTaskResponse
  | SalesforceListReportsResponse
  | SalesforceGetReportResponse
  | SalesforceRunReportResponse
  | SalesforceListReportTypesResponse
  | SalesforceListDashboardsResponse
  | SalesforceGetDashboardResponse
  | SalesforceRefreshDashboardResponse
  | SalesforceQueryResponse
  | SalesforceQueryMoreResponse
  | SalesforceDescribeObjectResponse
  | SalesforceListObjectsResponse
