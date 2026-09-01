import type { ToolOutputProperty } from '@/tools/types'

const string = (description: string, optional = true, nullable = false): ToolOutputProperty => ({
  type: 'string',
  description,
  optional,
  ...(nullable ? { nullable: true } : {}),
})
const number = (description: string, optional = true): ToolOutputProperty => ({
  type: 'number',
  description,
  optional,
})
const boolean = (description: string, optional = true): ToolOutputProperty => ({
  type: 'boolean',
  description,
  optional,
})
const json = (description: string, optional = true, nullable = false): ToolOutputProperty => ({
  type: 'json',
  description,
  optional,
  ...(nullable ? { nullable: true } : {}),
})
const array = (
  description: string,
  optional = true,
  nullable = false,
  items: NonNullable<ToolOutputProperty['items']> = { type: 'json' }
): ToolOutputProperty => ({
  type: 'array',
  description,
  optional,
  ...(nullable ? { nullable: true } : {}),
  items,
})

const OWNER_REF_PROPERTIES = {
  id: string('Identity ID'),
  type: string('IDENTITY'),
  name: string('Identity display name'),
} satisfies Record<string, ToolOutputProperty>

const PERMISSION_PROPERTIES = {
  rights: array('Rights granted on the target', true, false, { type: 'string' }),
  target: string('Permission target'),
} satisfies Record<string, ToolOutputProperty>

const ADDITIONAL_OWNER_REF_PROPERTIES = {
  type: string('IDENTITY or GOVERNANCE_GROUP'),
  id: string('Identity or governance-group ID'),
  name: string('Display name', true, true),
} satisfies Record<string, ToolOutputProperty>

const ENTITLEMENT_PRIVILEGE_LEVEL_PROPERTIES = {
  direct: string('Direct privilege level assigned to the entitlement'),
  setBy: string('User or process that set the privilege level'),
  setByType: string('Method by which the privilege level was set', true, true),
  inherited: string('Inherited privilege level on the entitlement', true, true),
  effective: string('Effective privilege level assigned to the entitlement'),
} satisfies Record<string, ToolOutputProperty>

const ACCESS_MODEL_METADATA_VALUE_PROPERTIES = {
  value: string('Metadata value'),
  name: string('Metadata value display name'),
  status: string('Metadata value status'),
} satisfies Record<string, ToolOutputProperty>

const ACCESS_MODEL_METADATA_PROPERTIES = {
  key: string('Metadata type identifier'),
  name: string('Metadata type display name'),
  multiselect: boolean('Whether the metadata accepts multiple values'),
  status: string('Metadata item status'),
  type: string('Metadata item type'),
  objectTypes: array('Applicable object types', true, false, { type: 'string' }),
  description: string('Metadata item description'),
  values: array('Metadata values', true, false, {
    type: 'object',
    properties: ACCESS_MODEL_METADATA_VALUE_PROPERTIES,
  }),
} satisfies Record<string, ToolOutputProperty>

const SOURCE_REFERENCE_PROPERTIES = {
  id: string('Source ID'),
  type: string('SOURCE'),
  name: string('Source name'),
} satisfies Record<string, ToolOutputProperty>

const ACCESS_MODEL_METADATA_OUTPUT: ToolOutputProperty = {
  type: 'object',
  description: 'Access-model metadata',
  optional: true,
  properties: {
    attributes: array('Access-model metadata attributes', true, false, {
      type: 'object',
      properties: ACCESS_MODEL_METADATA_PROPERTIES,
    }),
  },
}

const SOURCE_REFERENCE_OUTPUT: ToolOutputProperty = {
  type: 'object',
  description: 'Source reference',
  optional: true,
  properties: SOURCE_REFERENCE_PROPERTIES,
}

export const SAILPOINT_IDENTITY_OUTPUT_PROPERTIES = {
  id: string('Identity ID'),
  name: string('Identity name'),
  created: string('Creation timestamp'),
  modified: string('Last modification timestamp'),
  alias: string('Identity alias'),
  emailAddress: string('Identity email address'),
  processingState: string('Identity processing state'),
  identityStatus: string('Identity status'),
  managerRef: json('Manager reference'),
  isManager: boolean('Whether the identity manages other identities'),
  lastRefresh: string('Last identity refresh timestamp'),
  attributes: json('Tenant-defined identity attributes'),
  lifecycleState: json('Lifecycle-state reference'),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_ACCOUNT_OUTPUT_PROPERTIES = {
  id: string('Account ID'),
  name: string('Account name'),
  created: string('Creation timestamp'),
  modified: string('Last modification timestamp'),
  sourceId: string('Source ID'),
  sourceName: string('Source name'),
  identityId: string('Correlated identity ID'),
  cloudLifecycleState: string('Cloud lifecycle state'),
  identityState: string('Identity state'),
  connectionType: string('Source connection type'),
  isMachine: boolean('Whether this is a machine account'),
  recommendation: json('Correlation recommendation'),
  attributes: json('Source-defined account attributes'),
  authoritative: boolean('Whether the account is authoritative'),
  description: string('Account description'),
  disabled: boolean('Whether the account is disabled'),
  locked: boolean('Whether the account is locked'),
  nativeIdentity: string('Native account identifier'),
  systemAccount: boolean('Whether this is a system account'),
  uncorrelated: boolean('Whether the account is uncorrelated'),
  uuid: string('Account UUID'),
  manuallyCorrelated: boolean('Whether the account was manually correlated'),
  hasEntitlements: boolean('Whether the account has entitlements'),
  identity: json('Correlated identity reference'),
  sourceOwner: json('Source owner reference'),
  features: string('Account features', true, true),
  origin: string('Account origin'),
  ownerIdentity: json('Owner identity reference'),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_ACCOUNT_ACTIVITY_OUTPUT_PROPERTIES = {
  id: string('Account activity ID'),
  name: string('Account activity name'),
  created: string('Creation timestamp'),
  modified: string('Last modification timestamp'),
  completed: string('Completion timestamp'),
  completionStatus: string('Completion status'),
  type: string('Activity type'),
  requesterIdentitySummary: json('Requester identity summary'),
  targetIdentitySummary: json('Target identity summary'),
  errors: array('Provisioning errors'),
  warnings: array('Provisioning warnings'),
  items: array('Account activity items'),
  executionStatus: string('Execution status'),
  clientMetadata: json('Caller-provided string metadata'),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_SOURCE_OUTPUT_PROPERTIES = {
  id: string('Source ID'),
  name: string('Source name'),
  description: string('Source description'),
  owner: json('Source owner reference'),
  cluster: json('Virtual appliance cluster reference'),
  accountCorrelationConfig: json('Account correlation configuration'),
  accountCorrelationRule: json('Account correlation rule reference'),
  managerCorrelationMapping: json('Manager correlation mapping'),
  managerCorrelationRule: json('Manager correlation rule reference'),
  beforeProvisioningRule: json('Before-provisioning rule reference'),
  schemas: array('Source schemas'),
  passwordPolicies: array('Password policy references'),
  features: array('Source features'),
  type: string('Source type'),
  connector: string('Connector name'),
  connectorClass: string('Connector implementation class'),
  connectorAttributes: json('Connector-specific attributes'),
  deleteThreshold: number('Account deletion threshold'),
  authoritative: boolean('Whether the source is authoritative'),
  managementWorkgroup: json('Management workgroup reference'),
  healthy: boolean('Whether the source is healthy'),
  status: string('Source status'),
  since: string('Status start timestamp'),
  connectorId: string('Connector ID'),
  connectorName: string('Connector display name'),
  connectionType: string('Connection type'),
  connectorImplementationId: string('Connector implementation ID'),
  created: string('Creation timestamp'),
  modified: string('Last modification timestamp'),
  credentialProviderEnabled: boolean('Whether a credential provider is enabled'),
  category: string('Source category'),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_ENTITLEMENT_V2_OUTPUT_PROPERTIES = {
  id: string('Entitlement ID'),
  name: string('Entitlement name'),
  attribute: string('Source entitlement attribute'),
  value: string('Source entitlement value'),
  sourceSchemaObjectType: string('Source schema object type'),
  description: string('Entitlement description', true, true),
  privilegeLevel: {
    type: 'object',
    description: 'Privilege-level details',
    optional: true,
    nullable: true,
    properties: ENTITLEMENT_PRIVILEGE_LEVEL_PROPERTIES,
  },
  tags: array('Entitlement tags', true, true, { type: 'string' }),
  cloudGoverned: boolean('Whether SailPoint governs the entitlement'),
  requestable: boolean('Whether the entitlement is requestable'),
  owner: {
    type: 'object',
    description: 'Primary owner reference',
    optional: true,
    nullable: true,
    properties: OWNER_REF_PROPERTIES,
  },
  manuallyUpdatedFields: json('Fields manually updated in SailPoint', true, true),
  accessModelMetadata: ACCESS_MODEL_METADATA_OUTPUT,
  created: string('Creation timestamp'),
  modified: string('Last modification timestamp'),
  source: SOURCE_REFERENCE_OUTPUT,
  attributes: json('Source-defined entitlement attributes'),
  segments: array('Segment IDs', true, true, { type: 'string' }),
  directPermissions: array('Direct permissions', true, false, {
    type: 'object',
    properties: PERMISSION_PROPERTIES,
  }),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_ENTITLEMENT_OUTPUT_PROPERTIES = {
  id: string('Entitlement ID'),
  name: string('Entitlement name'),
  attribute: string('Source entitlement attribute'),
  value: string('Source entitlement value'),
  sourceSchemaObjectType: string('Source schema object type'),
  description: string('Entitlement description', true, true),
  privileged: boolean('Whether the entitlement is privileged'),
  cloudGoverned: boolean('Whether SailPoint governs the entitlement'),
  requestable: boolean('Whether the entitlement is requestable'),
  owner: {
    type: 'object',
    description: 'Primary owner reference',
    optional: true,
    nullable: true,
    properties: OWNER_REF_PROPERTIES,
  },
  additionalOwners: array('Additional owner references', true, true, {
    type: 'object',
    properties: ADDITIONAL_OWNER_REF_PROPERTIES,
  }),
  manuallyUpdatedFields: json('Fields manually updated in SailPoint', true, true),
  accessModelMetadata: ACCESS_MODEL_METADATA_OUTPUT,
  created: string('Creation timestamp'),
  modified: string('Last modification timestamp'),
  source: SOURCE_REFERENCE_OUTPUT,
  attributes: json('Source-defined entitlement attributes'),
  segments: array('Segment IDs', true, true, { type: 'string' }),
  directPermissions: array('Direct permissions', true, false, {
    type: 'object',
    properties: PERMISSION_PROPERTIES,
  }),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_IDENTITY_ENTITLEMENT_OUTPUT_PROPERTIES = {
  objectRef: json('Tagged entitlement reference'),
  tags: array('Tags applied to the entitlement'),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_ACCESS_PROFILE_OUTPUT_PROPERTIES = {
  id: string('Access profile ID'),
  name: string('Access profile name'),
  description: string('Access profile description'),
  created: string('Creation timestamp'),
  modified: string('Last modification timestamp'),
  enabled: boolean('Whether the access profile is enabled'),
  owner: json('Primary owner reference'),
  source: json('Source reference'),
  entitlements: array('Entitlement references'),
  requestable: boolean('Whether the access profile is requestable'),
  accessRequestConfig: json('Access-request configuration'),
  revocationRequestConfig: json('Revocation-request configuration'),
  segments: array('Segment IDs'),
  accessModelMetadata: json('Access-model metadata'),
  provisioningCriteria: json('Multi-account provisioning criteria'),
  additionalOwners: array('Additional owner references'),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_ROLE_OUTPUT_PROPERTIES = {
  id: string('Role ID'),
  name: string('Role name'),
  created: string('Creation timestamp'),
  modified: string('Last modification timestamp'),
  description: string('Role description'),
  owner: json('Primary owner reference'),
  additionalOwners: array('Additional owner references'),
  accessProfiles: array('Access profile references'),
  entitlements: array('Entitlement references'),
  membership: json('Role membership selector'),
  legacyMembershipInfo: json('Legacy membership information'),
  enabled: boolean('Whether the role is enabled'),
  requestable: boolean('Whether the role is requestable'),
  accessRequestConfig: json('Access-request configuration'),
  revocationRequestConfig: json('Revocation-request configuration'),
  segments: array('Segment IDs'),
  dimensional: boolean('Whether the role is dimensional'),
  dimensionRefs: array('Dimension references'),
  accessModelMetadata: json('Access-model metadata'),
  privilegeLevel: string('Role privilege level'),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_CAMPAIGN_OUTPUT_PROPERTIES = {
  id: string('Campaign ID'),
  name: string('Campaign name'),
  description: string('Campaign description'),
  deadline: string('Campaign deadline'),
  type: string('Campaign type'),
  status: string('Campaign status'),
  correlatedStatus: string('Campaign correlation status'),
  mandatoryCommentRequirement: string('Decision comment requirement'),
  created: string('Creation timestamp'),
  modified: string('Last modification timestamp'),
  recommendationsEnabled: boolean('Whether recommendations are enabled'),
  emailNotificationEnabled: boolean('Whether email notifications are enabled'),
  autoRevokeAllowed: boolean('Whether automatic revocation is allowed'),
  totalCertifications: number('Total certifications'),
  completedCertifications: number('Completed certifications'),
  alerts: array('Campaign alerts'),
  filter: json('Campaign filter reference'),
  sunsetCommentsRequired: boolean('Whether sunset-date changes require comments'),
  sourceOwnerCampaignInfo: json('Source-owner campaign configuration'),
  searchCampaignInfo: json('Search campaign configuration'),
  roleCompositionCampaignInfo: json('Role-composition campaign configuration'),
  machineAccountCampaignInfo: json('Machine-account campaign configuration'),
  sourcesWithOrphanEntitlements: array('Sources containing orphan entitlements'),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_CERTIFICATION_OUTPUT_PROPERTIES = {
  id: string('Certification ID'),
  name: string('Certification name'),
  campaign: json('Campaign reference'),
  completed: boolean('Whether all decisions are complete'),
  identitiesCompleted: number('Identities fully reviewed'),
  identitiesTotal: number('Total identities'),
  created: string('Creation timestamp'),
  modified: string('Last modification timestamp'),
  decisionsMade: number('Decisions made'),
  decisionsTotal: number('Total decisions'),
  due: string('Certification due timestamp'),
  signed: string('Sign-off timestamp'),
  reviewer: json('Reviewer reference'),
  reassignment: json('Reassignment details'),
  hasErrors: boolean('Whether the certification has errors'),
  errorMessage: string('Certification error message'),
  phase: string('Certification phase'),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_REVIEW_ITEM_OUTPUT_PROPERTIES = {
  accessSummary: json('Reviewed access summary'),
  identitySummary: json('Reviewed identity summary'),
  id: string('Review item ID'),
  completed: boolean('Whether review is complete'),
  newAccess: boolean('Whether this is newly granted access'),
  decision: string('Current certification decision'),
  comments: string('Reviewer comments'),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_ACCESS_REQUEST_STATUS_OUTPUT_PROPERTIES = {
  id: string('Requested item status ID'),
  name: string('Requested item name'),
  type: string('Requested item type'),
  cancelledRequestDetails: json('Cancellation details'),
  errorMessages: array('Localized request errors'),
  state: string('Request state'),
  approvalDetails: array('Approval details'),
  approvalIds: array('Approval IDs'),
  manualWorkItemDetails: array('Manual provisioning work items'),
  accountActivityItemId: string('Account activity item ID'),
  requestType: string('Access request type'),
  modified: string('Last modification timestamp'),
  created: string('Creation timestamp'),
  requester: json('Requester reference'),
  requestedFor: json('Requested-for identity reference'),
  identityType: string('HUMAN or MACHINE'),
  requesterComment: json('Requester comment'),
  sodViolationContext: json('Separation-of-duties violation context'),
  provisioningDetails: json('Provisioning details'),
  preApprovalTriggerDetails: json('Pre-approval trigger details'),
  accessRequestPhases: array('Request lifecycle phases'),
  description: string('Requested object description'),
  startDate: string('Requested start date'),
  removeDate: string('Requested removal date'),
  cancelable: boolean('Whether the request can be cancelled'),
  accessRequestId: string('Access request ID'),
  clientMetadata: json('Caller-provided string metadata'),
  requestedAccounts: array('Selected account references'),
  privilegeLevel: string('Requested object privilege level'),
  jitDetails: array('Just-in-time access details'),
  form: json('Completed request form'),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_PENDING_APPROVAL_OUTPUT_PROPERTIES = {
  id: string('Approval ID'),
  accessRequestId: string('Access request ID'),
  name: string('Approval name'),
  created: string('Creation timestamp'),
  modified: string('Last modification timestamp'),
  requestCreated: string('Access-request creation timestamp'),
  requestType: string('GRANT_ACCESS, REVOKE_ACCESS, or MODIFY_ACCESS'),
  identityType: string('HUMAN or MACHINE'),
  requester: json('Requester reference'),
  requestedFor: json('Requested-for identity reference'),
  owner: json('Access item owner'),
  requestedObject: json('Requested access object'),
  requesterComment: json('Requester comment'),
  previousReviewersComments: array('Previous reviewer comments'),
  forwardHistory: array('Approval forwarding history'),
  commentRequiredWhenRejected: boolean('Whether rejection requires a comment'),
  actionInProcess: string('Asynchronous action in progress'),
  removeDate: string('Requested removal date'),
  removeDateUpdateRequested: boolean('Whether this request changes the removal date'),
  currentRemoveDate: string('Removal date at request time'),
  startDate: string('Requested start date'),
  startUpdateRequested: boolean('Whether this request changes the start date'),
  currentStartDate: string('Start date at request time'),
  sodViolationContext: json('Separation-of-duties violation context'),
  clientMetadata: json('Caller-provided metadata'),
  requestedAccounts: array('Selected account references'),
  privilegeLevel: string('Requested object privilege level'),
  maxPermittedAccessDuration: json('Maximum allowed access duration'),
  jitDetails: array('Just-in-time access details'),
  form: json('Completed request form'),
} satisfies Record<string, ToolOutputProperty>

const TASK_STATUS_MESSAGE_PROPERTIES = {
  type: string('INFO, WARN, or ERROR'),
  localizedText: {
    type: 'object',
    description: 'Localized task message',
    optional: true,
    nullable: true,
    properties: {
      locale: string('Message locale'),
      message: string('Message text'),
    },
  },
  key: string('Message key'),
  parameters: array('Internationalization parameters', true, true),
} satisfies Record<string, ToolOutputProperty>

const TASK_RETURN_PROPERTIES = {
  name: string('Return value display name'),
  attributeName: string('Task attribute name'),
} satisfies Record<string, ToolOutputProperty>

const LOAD_TASK_MESSAGE_PROPERTIES = {
  type: string('INFO, WARN, or ERROR'),
  error: boolean('Whether the message is an error'),
  warning: boolean('Whether the message is a warning'),
  key: string('Message key'),
  localizedText: string('Localized message text'),
} satisfies Record<string, ToolOutputProperty>

const LOAD_TASK_RETURN_PROPERTIES = {
  displayLabel: string('Return value display label'),
  attributeName: string('Task attribute name'),
} satisfies Record<string, ToolOutputProperty>

const TASK_TARGET_PROPERTIES = {
  id: string('Target ID'),
  type: string('APPLICATION or IDENTITY', true, true),
  name: string('Target name'),
} satisfies Record<string, ToolOutputProperty>

const TASK_DEFINITION_SUMMARY_PROPERTIES = {
  id: string('Task-definition ID', false),
  uniqueName: string('Task-definition unique name', false),
  description: string('Task-definition description', false, true),
  parentName: string('Parent task-definition name', false),
  executor: string('Task-definition executor', false, true),
  arguments: json('Task-definition arguments', false),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_TASK_STATUS_OUTPUT_PROPERTIES = {
  id: string('Task ID'),
  type: string('Task type'),
  uniqueName: string('Task unique name'),
  description: string('Task description'),
  parentName: string('Parent task name', true, true),
  launcher: string('Task launcher'),
  target: {
    type: 'object',
    description: 'Task target',
    optional: true,
    nullable: true,
    properties: TASK_TARGET_PROPERTIES,
  },
  created: string('Creation timestamp'),
  modified: string('Last modification timestamp', true, true),
  launched: string('Launch timestamp', true, true),
  completed: string('Completion timestamp', true, true),
  completionStatus: string('Task completion status', true, true),
  messages: array('Task messages', true, false, {
    type: 'object',
    properties: TASK_STATUS_MESSAGE_PROPERTIES,
  }),
  returns: array('Task return descriptors', true, false, {
    type: 'object',
    properties: TASK_RETURN_PROPERTIES,
  }),
  attributes: json('Task-specific attributes'),
  progress: string('Human-readable progress', true, true),
  percentComplete: number('Completion percentage'),
  taskDefinitionSummary: {
    type: 'object',
    description: 'Task definition summary',
    optional: true,
    properties: TASK_DEFINITION_SUMMARY_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_LOAD_ACCOUNTS_TASK_OUTPUT_PROPERTIES = {
  id: string('Task ID'),
  type: string('Task type'),
  name: string('Task name'),
  description: string('Task description'),
  launcher: string('Task launcher'),
  created: string('Creation timestamp'),
  launched: string('Launch timestamp', true, true),
  completed: string('Completion timestamp', true, true),
  completionStatus: string('Task completion status', true, true),
  parentName: string('Parent task name', true, true),
  messages: array('Task messages', true, false, {
    type: 'object',
    properties: LOAD_TASK_MESSAGE_PROPERTIES,
  }),
  progress: string('Human-readable progress', true, true),
  attributes: json('Task-specific attributes'),
  returns: array('Task return descriptors', true, false, {
    type: 'object',
    properties: LOAD_TASK_RETURN_PROPERTIES,
  }),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_LOAD_ENTITLEMENTS_TASK_OUTPUT_PROPERTIES = {
  id: string('Task ID'),
  type: string('Task type'),
  uniqueName: string('Task unique name'),
  description: string('Task description'),
  launcher: string('Task launcher'),
  created: string('Creation timestamp'),
  returns: array('Task return descriptors', true, false, {
    type: 'object',
    properties: LOAD_TASK_RETURN_PROPERTIES,
  }),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_ACCESS_REQUEST_TRACKING_PROPERTIES = {
  requestedFor: string('Requested-for identity ID'),
  requestedItemsDetails: {
    type: 'array',
    description: 'Requested item references',
    optional: true,
    items: {
      type: 'object',
      properties: {
        type: string('ACCESS_PROFILE, ROLE, or ENTITLEMENT'),
        id: string('Requested item ID'),
      },
    },
  },
  attributesHash: number('Stable request attributes hash'),
  accessRequestIds: {
    type: 'array',
    description: 'Access request tracking IDs',
    optional: true,
    items: { type: 'string', description: 'Access request ID' },
  },
} satisfies Record<string, ToolOutputProperty>

const SAILPOINT_ACCOUNT_INFO_REF_PROPERTIES = {
  uuid: string('Account UUID'),
  nativeIdentity: string('Native account identifier'),
  type: string('ACCOUNT or provider reference type'),
  id: string('Account reference ID'),
  name: string('Account name'),
} satisfies Record<string, ToolOutputProperty>

const SAILPOINT_SOURCE_ACCOUNT_SELECTION_PROPERTIES = {
  type: string('SOURCE or provider reference type'),
  id: string('Source ID'),
  name: string('Source name'),
  accounts: {
    type: 'array',
    description: 'Eligible accounts on this source',
    optional: true,
    items: { type: 'object', properties: SAILPOINT_ACCOUNT_INFO_REF_PROPERTIES },
  },
} satisfies Record<string, ToolOutputProperty>

const SAILPOINT_REQUESTED_ITEM_ACCOUNT_SELECTION_PROPERTIES = {
  description: string('Requested item description'),
  accountsSelectionBlocked: boolean('Whether account selection is blocked'),
  accountsSelectionBlockedReason: string(
    'Provider reason account selection is blocked',
    true,
    true
  ),
  type: string('ACCESS_PROFILE, ROLE, or ENTITLEMENT'),
  id: string('Requested item ID'),
  name: string('Requested item name'),
  sources: {
    type: 'array',
    description: 'Sources and eligible accounts for this item',
    optional: true,
    items: { type: 'object', properties: SAILPOINT_SOURCE_ACCOUNT_SELECTION_PROPERTIES },
  },
} satisfies Record<string, ToolOutputProperty>

const SAILPOINT_IDENTITY_ACCOUNT_SELECTION_PROPERTIES = {
  requestedItems: {
    type: 'array',
    description: 'Requested items and their eligible accounts',
    optional: true,
    items: {
      type: 'object',
      properties: SAILPOINT_REQUESTED_ITEM_ACCOUNT_SELECTION_PROPERTIES,
    },
  },
  accountsSelectionRequired: boolean('Whether this identity requires account selection'),
  type: string('IDENTITY, MACHINE_IDENTITY, or provider reference type'),
  id: string('Identity ID'),
  name: string('Identity name'),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_ACCOUNT_SELECTIONS_OUTPUT_PROPERTIES = {
  identities: {
    type: 'array',
    description: 'Identity-specific eligible account selections',
    optional: true,
    items: { type: 'object', properties: SAILPOINT_IDENTITY_ACCOUNT_SELECTION_PROPERTIES },
  },
} satisfies Record<string, ToolOutputProperty>

const SAILPOINT_APPROVAL_SCHEME_PROPERTIES = {
  approverType: string('ENTITLEMENT_OWNER, SOURCE_OWNER, MANAGER, GOVERNANCE_GROUP, or WORKFLOW'),
  approverId: string('Governance group or workflow approver ID', true, true),
} satisfies Record<string, ToolOutputProperty>

const SAILPOINT_ACCESS_DURATION_PROPERTIES = {
  value: number('Duration value'),
  timeUnit: string('HOURS, DAYS, WEEKS, or MONTHS'),
} satisfies Record<string, ToolOutputProperty>

const SAILPOINT_ENTITLEMENT_ACCESS_REQUEST_CONFIG_PROPERTIES = {
  approvalSchemes: {
    type: 'array',
    description: 'Ordered approval schemes',
    optional: true,
    items: { type: 'object', properties: SAILPOINT_APPROVAL_SCHEME_PROPERTIES },
  },
  requestCommentRequired: boolean('Whether a request comment is required'),
  denialCommentRequired: boolean('Whether a denial comment is required'),
  reauthorizationRequired: boolean('Whether reauthorization is required'),
  requireEndDate: boolean('Whether an end date is required'),
  maxPermittedAccessDuration: {
    type: 'object',
    description: 'Maximum permitted access duration',
    optional: true,
    nullable: true,
    properties: SAILPOINT_ACCESS_DURATION_PROPERTIES,
  },
  formDefinitionId: string('Request form definition ID', true, true),
} satisfies Record<string, ToolOutputProperty>

const SAILPOINT_ENTITLEMENT_REVOCATION_REQUEST_CONFIG_PROPERTIES = {
  approvalSchemes: {
    type: 'array',
    description: 'Ordered revocation approval schemes',
    optional: true,
    items: { type: 'object', properties: SAILPOINT_APPROVAL_SCHEME_PROPERTIES },
  },
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_ENTITLEMENT_REQUEST_CONFIG_OUTPUT_PROPERTIES = {
  accessRequestConfig: {
    type: 'object',
    description: 'Entitlement grant request configuration',
    optional: true,
    properties: SAILPOINT_ENTITLEMENT_ACCESS_REQUEST_CONFIG_PROPERTIES,
  },
  revocationRequestConfig: {
    type: 'object',
    description: 'Entitlement revocation request configuration',
    optional: true,
    properties: SAILPOINT_ENTITLEMENT_REVOCATION_REQUEST_CONFIG_PROPERTIES,
  },
} satisfies Record<string, ToolOutputProperty>

const SAILPOINT_REQUEST_ON_BEHALF_OF_CONFIG_PROPERTIES = {
  allowRequestOnBehalfOfAnyoneByAnyone: boolean('Whether anyone may request for anyone'),
  allowRequestOnBehalfOfEmployeeByManager: boolean(
    'Whether managers may request for their employees'
  ),
  allowRequestOnBehalfOfForMachineIdentity: boolean(
    'Whether anyone may request for a machine identity'
  ),
  allowRequestForMachineByOwner: boolean('Whether machine owners may request for their machines'),
} satisfies Record<string, ToolOutputProperty>

export const SAILPOINT_ACCESS_REQUEST_CONFIG_OUTPUT_PROPERTIES = {
  approvalsMustBeExternal: boolean('Whether approvals must be handled externally'),
  reauthorizationEnabled: boolean('Whether reauthorization is enabled'),
  requestOnBehalfOfConfig: {
    type: 'object',
    description: 'Request-on-behalf-of policy',
    optional: true,
    properties: SAILPOINT_REQUEST_ON_BEHALF_OF_CONFIG_PROPERTIES,
  },
  entitlementRequestConfig: {
    type: 'object',
    description: 'Tenant entitlement request configuration',
    optional: true,
    properties: SAILPOINT_ENTITLEMENT_REQUEST_CONFIG_OUTPUT_PROPERTIES,
  },
  govGroupVisibilityEnabled: boolean('Whether governance group visibility is enabled'),
  machineIdentityAccessRequestEnabled: boolean(
    'Whether machine identity access requests are enabled'
  ),
} satisfies Record<string, ToolOutputProperty>
