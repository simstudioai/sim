import type { OAuthConfig, ToolOutputProperty, ToolParameterItemSchema } from '@/tools/types'

/** Pure declaration metadata only. Provider execution belongs under lib/internal. */
export const ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG = {
  required: true,
  provider: 'oracle_fusion_project_management',
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
} as const satisfies OAuthConfig

export const oracleFusionProjectManagementAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Reusable Oracle Fusion service-account credential',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Authentication injected by the credential executor',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Oracle Fusion application origin bound to the selected credential',
  },
} as const

export const oracleFusionBudgetResourceItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['RbsElementId', 'TaskId'],
  properties: {
    RbsElementId: {
      type: 'string',
      description: 'Resource breakdown structure element ID',
      pattern: '^[1-9][0-9]{0,17}$',
    },
    TaskId: { type: 'string', description: 'Budget task ID', pattern: '^[1-9][0-9]{0,17}$' },
    PlanningStartDate: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    PlanningEndDate: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    PlanningAmounts: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['Currency'],
        properties: {
          Currency: { type: 'string', minLength: 1, maxLength: 15 },
          Quantity: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          RawCostAmounts: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          BurdenedCostAmounts: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          RevenueAmounts: { anyOf: [{ type: 'number' }, { type: 'null' }] },
        },
      },
    },
  },
} as const satisfies ToolParameterItemSchema

// Oracle 26C: https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-get.html
export const oracleFusionProjectOutput = {
  ProjectId: { type: 'string', description: 'Project ID (exact decimal ID)' },
  ProjectName: { type: 'string', description: 'Project Name', optional: true },
  ProjectNumber: { type: 'string', description: 'Project Number', optional: true },
  ProjectDescription: {
    type: 'string',
    description: 'Project Description',
    optional: true,
    nullable: true,
  },
  ProjectStatusCode: {
    type: 'string',
    description: 'Project Status Code',
    optional: true,
    nullable: true,
  },
  ProjectStatus: { type: 'string', description: 'Project Status', optional: true, nullable: true },
  ProjectStartDate: { type: 'string', description: 'Project Start Date', optional: true },
  ProjectEndDate: {
    type: 'string',
    description: 'Project End Date',
    optional: true,
    nullable: true,
  },
  ProjectManagerEmail: {
    type: 'string',
    description: 'Project Manager Email',
    optional: true,
    nullable: true,
  },
  ProjectManagerName: {
    type: 'string',
    description: 'Project Manager Name',
    optional: true,
    nullable: true,
  },
  OwningOrganizationId: {
    type: 'string',
    description: 'Owning Organization ID (exact decimal ID)',
    optional: true,
  },
  OwningOrganizationName: {
    type: 'string',
    description: 'Owning Organization Name',
    optional: true,
  },
  BusinessUnitId: {
    type: 'string',
    description: 'Business Unit ID (exact decimal ID)',
    optional: true,
  },
  BusinessUnitName: { type: 'string', description: 'Business Unit Name', optional: true },
  ProjectTypeId: {
    type: 'string',
    description: 'Project Type ID (exact decimal ID)',
    optional: true,
  },
  ProjectTypeName: { type: 'string', description: 'Project Type Name', optional: true },
  ProjectCurrencyCode: { type: 'string', description: 'Project Currency Code', optional: true },
  CreationDate: { type: 'string', description: 'Creation Date', optional: true },
  LastUpdateDate: { type: 'string', description: 'Last Update Date', optional: true },
} as const satisfies Record<string, ToolOutputProperty>

// Oracle 26C: https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplandetails-get.html
export const oracleFusionPlanOutput = {
  ProjectId: { type: 'string', description: 'Project ID (exact decimal ID)' },
  Name: { type: 'string', description: 'Name', optional: true },
  ProjectNumber: { type: 'string', description: 'Project Number', optional: true },
  Description: { type: 'string', description: 'Description', optional: true, nullable: true },
  StartDate: { type: 'string', description: 'Start Date', optional: true },
  EndDate: { type: 'string', description: 'End Date', optional: true, nullable: true },
  Status: { type: 'string', description: 'Status', optional: true },
  StatusCode: { type: 'string', description: 'Status Code', optional: true },
  PercentComplete: {
    type: 'string',
    description: 'Percent Complete (decimal text)',
    optional: true,
    nullable: true,
  },
  CurrencyCode: { type: 'string', description: 'Currency Code', optional: true },
  OrganizationId: {
    type: 'string',
    description: 'Organization ID (exact decimal ID)',
    optional: true,
  },
  PrimaryProjectManagerName: {
    type: 'string',
    description: 'Primary Project Manager Name',
    optional: true,
  },
  FinanciallyEnabledFlag: {
    type: 'boolean',
    description: 'Financially Enabled Flag',
    optional: true,
    nullable: true,
  },
  ViewAccessCode: {
    type: 'string',
    description: 'View Access Code',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

// Oracle 26C: https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplandetails-projectid-child-tasks-get.html
export const oracleFusionTaskOutput = {
  TaskId: { type: 'string', description: 'Task ID (exact decimal ID)' },
  Name: { type: 'string', description: 'Name', optional: true },
  TaskNumber: { type: 'string', description: 'Task Number', optional: true },
  TaskLevel: { type: 'number', description: 'Task Level', optional: true },
  Description: { type: 'string', description: 'Description', optional: true, nullable: true },
  ParentTaskId: {
    type: 'string',
    description: 'Parent Task ID (exact decimal ID)',
    optional: true,
    nullable: true,
  },
  MilestoneFlag: { type: 'boolean', description: 'Milestone Flag', optional: true, nullable: true },
  TaskStatusCode: {
    type: 'string',
    description: 'Task Status Code',
    optional: true,
    nullable: true,
  },
  PhysicalPercentComplete: {
    type: 'string',
    description: 'Physical Percent Complete (decimal text)',
    optional: true,
    nullable: true,
  },
  PercentComplete: {
    type: 'string',
    description: 'Percent Complete (decimal text)',
    optional: true,
    nullable: true,
  },
  PlannedStartDateTime: {
    type: 'string',
    description: 'Planned Start Date Time',
    optional: true,
    nullable: true,
  },
  PlannedFinishDateTime: {
    type: 'string',
    description: 'Planned Finish Date Time',
    optional: true,
    nullable: true,
  },
  PlannedEffort: {
    type: 'string',
    description: 'Planned Effort (decimal text)',
    optional: true,
    nullable: true,
  },
  PlannedDuration: {
    type: 'string',
    description: 'Planned Duration (decimal text)',
    optional: true,
    nullable: true,
  },
  ActualStartDateTime: {
    type: 'string',
    description: 'Actual Start Date Time',
    optional: true,
    nullable: true,
  },
  ActualFinishDateTime: {
    type: 'string',
    description: 'Actual Finish Date Time',
    optional: true,
    nullable: true,
  },
  ActualHours: {
    type: 'string',
    description: 'Actual Hours (decimal text)',
    optional: true,
    nullable: true,
  },
  PrimaryResourceName: { type: 'string', description: 'Primary Resource Name', optional: true },
  PrimaryResourceEmail: {
    type: 'string',
    description: 'Primary Resource Email',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

// Oracle 26C: https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-get.html
export const oracleFusionDeliverableOutput = {
  DeliverableId: { type: 'string', description: 'Deliverable ID (exact decimal ID)' },
  DeliverableName: { type: 'string', description: 'Deliverable Name', optional: true },
  ShortName: { type: 'string', description: 'Short Name', optional: true },
  Description: { type: 'string', description: 'Description', optional: true, nullable: true },
  NeedByDate: { type: 'string', description: 'Need By Date', optional: true, nullable: true },
  OwnerId: {
    type: 'string',
    description: 'Owner ID (exact decimal ID)',
    optional: true,
    nullable: true,
  },
  OwnerEmail: { type: 'string', description: 'Owner Email', optional: true, nullable: true },
  OwnerName: { type: 'string', description: 'Owner Name', optional: true, nullable: true },
  PriorityCode: { type: 'string', description: 'Priority Code', optional: true },
  Priority: { type: 'string', description: 'Priority', optional: true, nullable: true },
  StatusCode: { type: 'string', description: 'Status Code', optional: true },
  Status: { type: 'string', description: 'Status', optional: true, nullable: true },
  TypeId: { type: 'string', description: 'Type ID (exact decimal ID)', optional: true },
  Type: { type: 'string', description: 'Type', optional: true, nullable: true },
  CreationDate: { type: 'string', description: 'Creation Date', optional: true },
} as const satisfies Record<string, ToolOutputProperty>

// Oracle 26C: https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-deliverableid-child-projecttaskassociation-get.html
export const oracleFusionAssociationOutput = {
  ObjectAssociationId: { type: 'string', description: 'Object Association ID (exact decimal ID)' },
  ProjectId: {
    type: 'string',
    description: 'Project ID (exact decimal ID)',
    optional: true,
    nullable: true,
  },
  ProjectName: { type: 'string', description: 'Project Name', optional: true, nullable: true },
  ProjectNumber: { type: 'string', description: 'Project Number', optional: true, nullable: true },
  TaskId: { type: 'string', description: 'Task ID (exact decimal ID)', optional: true },
  TaskName: { type: 'string', description: 'Task Name', optional: true, nullable: true },
  TaskNumber: { type: 'string', description: 'Task Number', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

// Oracle 26C: https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-child-projectteammembers-get.html
export const oracleFusionTeamMemberOutput = {
  TeamMemberId: {
    type: 'string',
    description: 'Team Member ID (exact decimal ID)',
    nullable: true,
  },
  ProjectId: {
    type: 'string',
    description: 'Project ID (exact decimal ID)',
    optional: true,
    nullable: true,
  },
  PersonId: {
    type: 'string',
    description: 'Person ID (exact decimal ID)',
    optional: true,
    nullable: true,
  },
  PersonEmail: { type: 'string', description: 'Person Email', optional: true, nullable: true },
  PersonName: { type: 'string', description: 'Person Name', optional: true, nullable: true },
  ProjectRole: { type: 'string', description: 'Project Role', optional: true, nullable: true },
  StartDate: { type: 'string', description: 'Start Date', optional: true, nullable: true },
  FinishDate: { type: 'string', description: 'Finish Date', optional: true, nullable: true },
  AssignmentTypeCode: {
    type: 'string',
    description: 'Assignment Type Code',
    optional: true,
    nullable: true,
  },
  AssignmentType: {
    type: 'string',
    description: 'Assignment Type',
    optional: true,
    nullable: true,
  },
  ResourceAllocationPercentage: {
    type: 'string',
    description: 'Resource Allocation Percentage (decimal text)',
    optional: true,
    nullable: true,
  },
  ResourceAssignmentEffortInHours: {
    type: 'string',
    description: 'Resource Assignment Effort In Hours (decimal text)',
    optional: true,
    nullable: true,
  },
  BillablePercent: {
    type: 'string',
    description: 'Billable Percent',
    optional: true,
    nullable: true,
  },
  TrackTimeFlag: {
    type: 'boolean',
    description: 'Track Time Flag',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

// Oracle 26C: https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasklaborresourceassignments-get.html
export const oracleFusionLaborAssignmentOutput = {
  TaskLaborResourceAssignmentId: {
    type: 'string',
    description: 'Task Labor Resource Assignment ID (exact decimal ID)',
  },
  TaskId: { type: 'string', description: 'Task ID (exact decimal ID)', optional: true },
  LaborResourceId: {
    type: 'string',
    description: 'Labor Resource ID (exact decimal ID)',
    optional: true,
    nullable: true,
  },
  ResourceEmail: { type: 'string', description: 'Resource Email', optional: true, nullable: true },
  ResourceName: { type: 'string', description: 'Resource Name', optional: true },
  PrimaryResourceFlag: {
    type: 'boolean',
    description: 'Primary Resource Flag',
    optional: true,
    nullable: true,
  },
  ResourceAllocation: {
    type: 'string',
    description: 'Resource Allocation (decimal text)',
    optional: true,
    nullable: true,
  },
  PlannedEffortinHours: {
    type: 'string',
    description: 'Planned Effort in hours (decimal text)',
    optional: true,
    nullable: true,
  },
  ActualEffortinHours: {
    type: 'string',
    description: 'Actual Effort in hours (decimal text)',
    optional: true,
    nullable: true,
  },
  RemainingEffortinHours: {
    type: 'string',
    description: 'Remaining Effort in hours (decimal text)',
    optional: true,
    nullable: true,
  },
  PercentComplete: {
    type: 'string',
    description: 'Percent Complete (decimal text)',
    optional: true,
    nullable: true,
  },
  ProgressStatus: {
    type: 'string',
    description: 'Progress Status',
    optional: true,
    nullable: true,
  },
  EffectiveBillRate: {
    type: 'string',
    description: 'Effective Bill Rate (decimal text)',
    optional: true,
    nullable: true,
  },
  EffectiveCostRate: {
    type: 'string',
    description: 'Effective Cost Rate (decimal text)',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

// Oracle 26C: https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectenterpriseresources-get.html
export const oracleFusionResourceOutput = {
  ResourceId: { type: 'string', description: 'Resource ID (exact decimal ID)' },
  ResourceDisplayName: { type: 'string', description: 'Resource Display Name', optional: true },
  ResourceEmail: { type: 'string', description: 'Resource Email', optional: true, nullable: true },
  PersonId: {
    type: 'string',
    description: 'Person ID (exact decimal ID)',
    optional: true,
    nullable: true,
  },
  ResourceProjectPrimaryRole: {
    type: 'string',
    description: 'Resource Project Primary Role',
    optional: true,
  },
  ResourceType: { type: 'string', description: 'Resource Type', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

// Oracle 26C: https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcosts-get.html
export const oracleFusionCostOutput = {
  costKey: {
    type: 'string',
    description: 'Opaque key extracted from the credential-bound self link; not CostId',
  },
  CostId: { type: 'string', description: 'Cost ID (exact decimal ID)', nullable: true },
  ProjectId: {
    type: 'string',
    description: 'Project ID (exact decimal ID)',
    optional: true,
    nullable: true,
  },
  ProjectName: { type: 'string', description: 'Project Name', optional: true },
  ProjectNumber: { type: 'string', description: 'Project Number', optional: true },
  TaskId: { type: 'string', description: 'Task ID (exact decimal ID)', optional: true },
  TaskName: { type: 'string', description: 'Task Name', optional: true },
  TaskNumber: { type: 'string', description: 'Task Number', optional: true, nullable: true },
  ExpenditureItemDate: { type: 'string', description: 'Expenditure Item Date', optional: true },
  ExpenditureType: { type: 'string', description: 'Expenditure Type', optional: true },
  ExpenditureOrganization: {
    type: 'string',
    description: 'Expenditure Organization',
    optional: true,
  },
  Quantity: {
    type: 'string',
    description: 'Quantity (decimal text)',
    optional: true,
    nullable: true,
  },
  UnitOfMeasureCode: {
    type: 'string',
    description: 'Unit Of Measure Code',
    optional: true,
    nullable: true,
  },
  TransactionCurrency: { type: 'string', description: 'Transaction Currency', optional: true },
  RawCostInTransactionCurrency: {
    type: 'string',
    description: 'Raw Cost In Transaction Currency (decimal text)',
    optional: true,
    nullable: true,
  },
  BurdenedCostInTransactionCurrency: {
    type: 'string',
    description: 'Burdened Cost In Transaction Currency (decimal text)',
    optional: true,
    nullable: true,
  },
  RawCostInProjectCurrency: {
    type: 'string',
    description: 'Raw Cost In Project Currency (decimal text)',
    optional: true,
    nullable: true,
  },
  BurdenedCostInProjectCurrency: {
    type: 'string',
    description: 'Burdened Cost In Project Currency (decimal text)',
    optional: true,
    nullable: true,
  },
  BillableFlag: { type: 'boolean', description: 'Billable Flag', optional: true },
  CapitalizableFlag: {
    type: 'boolean',
    description: 'Capitalizable Flag',
    optional: true,
    nullable: true,
  },
  HoldInvoiceFlag: { type: 'boolean', description: 'Hold Invoice Flag', optional: true },
  HoldRevenueFlag: {
    type: 'boolean',
    description: 'Hold Revenue Flag',
    optional: true,
    nullable: true,
  },
  AccountingDate: {
    type: 'string',
    description: 'Accounting Date',
    optional: true,
    nullable: true,
  },
  AdjustmentStatus: { type: 'string', description: 'Adjustment Status', optional: true },
  Comment: { type: 'string', description: 'Comment', optional: true },
  ExternalBillRate: {
    type: 'string',
    description: 'External Bill Rate (decimal text)',
    optional: true,
    nullable: true,
  },
  ExternalBillRateCurrency: {
    type: 'string',
    description: 'External Bill Rate Currency',
    optional: true,
    nullable: true,
  },
  IntercompanyBillRate: {
    type: 'string',
    description: 'Intercompany Bill Rate (decimal text)',
    optional: true,
    nullable: true,
  },
  IntercompanyBillRateCurrency: {
    type: 'string',
    description: 'Intercompany Bill Rate Currency',
    optional: true,
    nullable: true,
  },
  LastUpdateDate: { type: 'string', description: 'Last Update Date', optional: true },
} as const satisfies Record<string, ToolOutputProperty>

// Oracle 26C: https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-get.html
export const oracleFusionBudgetOutput = {
  PlanVersionId: { type: 'string', description: 'Plan Version ID (exact decimal ID)' },
  PlanVersionName: { type: 'string', description: 'Plan Version Name', optional: true },
  PlanVersionNumber: {
    type: 'string',
    description: 'Plan Version Number (exact decimal ID)',
    optional: true,
    nullable: true,
  },
  PlanVersionDescription: {
    type: 'string',
    description: 'Plan Version Description',
    optional: true,
    nullable: true,
  },
  PlanVersionStatus: {
    type: 'string',
    description: 'Plan Version Status',
    optional: true,
    nullable: true,
  },
  ProjectId: { type: 'string', description: 'Project ID (exact decimal ID)', optional: true },
  ProjectName: { type: 'string', description: 'Project Name', optional: true },
  ProjectNumber: { type: 'string', description: 'Project Number', optional: true },
  FinancialPlanType: {
    type: 'string',
    description: 'Financial Plan Type',
    optional: true,
    nullable: true,
  },
  PlanningAmounts: {
    type: 'string',
    description: 'Planning Amounts',
    optional: true,
    nullable: true,
  },
  LockedFlag: { type: 'boolean', description: 'Locked Flag', optional: true, nullable: true },
  LockedBy: { type: 'string', description: 'Locked By', optional: true, nullable: true },
  PCRawCostAmounts: {
    type: 'string',
    description: 'PCRaw Cost Amounts (decimal text)',
    optional: true,
    nullable: true,
  },
  PCBurdenedCostAmounts: {
    type: 'string',
    description: 'PCBurdened Cost Amounts (decimal text)',
    optional: true,
    nullable: true,
  },
  PCRevenueAmounts: {
    type: 'string',
    description: 'PCRevenue Amounts (decimal text)',
    optional: true,
    nullable: true,
  },
  PFCRawCostAmounts: {
    type: 'string',
    description: 'PFCRaw Cost Amounts (decimal text)',
    optional: true,
    nullable: true,
  },
  PFCBurdenedCostAmounts: {
    type: 'string',
    description: 'PFCBurdened Cost Amounts (decimal text)',
    optional: true,
    nullable: true,
  },
  PFCRevenueAmounts: {
    type: 'string',
    description: 'PFCRevenue Amounts (decimal text)',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

// Oracle 26C: https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcontractinvoices-get.html
export const oracleFusionInvoiceOutput = {
  InvoiceId: { type: 'string', description: 'Invoice ID (exact decimal ID)' },
  InvoiceNumber: {
    type: 'string',
    description: 'Invoice Number (exact decimal ID)',
    optional: true,
  },
  InvoiceStatusCode: { type: 'string', description: 'Invoice Status Code', optional: true },
  InvoiceStatusMeaning: { type: 'string', description: 'Invoice Status Meaning', optional: true },
  InvoiceTypeCode: {
    type: 'string',
    description: 'Invoice Type Code',
    optional: true,
    nullable: true,
  },
  InvoiceTypeMeaning: { type: 'string', description: 'Invoice Type Meaning', optional: true },
  InvoiceAmount: {
    type: 'string',
    description: 'Invoice Amount (decimal text)',
    optional: true,
    nullable: true,
  },
  TaxAmount: {
    type: 'string',
    description: 'Tax Amount (decimal text)',
    optional: true,
    nullable: true,
  },
  InvoiceCurrencyCode: { type: 'string', description: 'Invoice Currency Code', optional: true },
  InvoiceDate: { type: 'string', description: 'Invoice Date', optional: true, nullable: true },
  ContractId: { type: 'string', description: 'Contract ID (exact decimal ID)', optional: true },
  ContractNumber: { type: 'string', description: 'Contract Number', optional: true },
  ProjectId: {
    type: 'string',
    description: 'Project ID (exact decimal ID)',
    optional: true,
    nullable: true,
  },
  ProjectName: { type: 'string', description: 'Project Name', optional: true, nullable: true },
  ProjectNumber: { type: 'string', description: 'Project Number', optional: true, nullable: true },
  OrganizationId: {
    type: 'string',
    description: 'Organization ID (exact decimal ID)',
    optional: true,
  },
  OrganizationName: {
    type: 'string',
    description: 'Organization Name',
    optional: true,
    nullable: true,
  },
  InvoiceComment: {
    type: 'string',
    description: 'Invoice Comment',
    optional: true,
    nullable: true,
  },
  InvoiceInstructions: {
    type: 'string',
    description: 'Invoice Instructions',
    optional: true,
    nullable: true,
  },
  ReceivablesNumber: {
    type: 'string',
    description: 'Receivables Number',
    optional: true,
    nullable: true,
  },
  SubmittedDate: { type: 'string', description: 'Submitted Date', optional: true, nullable: true },
  ApprovedDate: { type: 'string', description: 'Approved Date', optional: true, nullable: true },
  ReleasedDate: { type: 'string', description: 'Released Date', optional: true, nullable: true },
  TransferredDate: {
    type: 'string',
    description: 'Transferred Date',
    optional: true,
    nullable: true,
  },
  AcceptedDate: { type: 'string', description: 'Accepted Date', optional: true, nullable: true },
  Canceled: { type: 'string', description: 'Canceled', optional: true, nullable: true },
} as const satisfies Record<string, ToolOutputProperty>

// Oracle 26C: https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectstatuseslov-get.html
export const oracleFusionStatusOutput = {
  ProjectStatusCode: { type: 'string', description: 'Project Status Code' },
  ProjectStatusName: { type: 'string', description: 'Project Status Name', optional: true },
  Description: { type: 'string', description: 'Description', optional: true, nullable: true },
  StatusObjectCode: { type: 'string', description: 'Status Object Code', optional: true },
  StatusClassificationCode: {
    type: 'string',
    description: 'Status Classification Code',
    optional: true,
  },
  StartDateActive: { type: 'string', description: 'Start Date Active', optional: true },
  EndDateActive: { type: 'string', description: 'End Date Active', optional: true, nullable: true },
  WorkflowEnabledFlag: {
    type: 'boolean',
    description: 'Workflow Enabled Flag',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

// Oracle 26C: https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-child-projectstatushistory-get.html
export const oracleFusionHistoryOutput = {
  StatusHistoryId: { type: 'string', description: 'Status History ID (exact decimal ID)' },
  ObjectId: { type: 'string', description: 'Object ID (exact decimal ID)', optional: true },
  StatusObject: { type: 'string', description: 'Status Object', optional: true },
  OldStatusCode: { type: 'string', description: 'Old Status Code', optional: true },
  OldStatus: { type: 'string', description: 'Old Status', optional: true },
  NewStatusCode: { type: 'string', description: 'New Status Code', optional: true },
  NewStatus: { type: 'string', description: 'New Status', optional: true },
  StatusChangeComments: {
    type: 'string',
    description: 'Status Change Comments',
    optional: true,
    nullable: true,
  },
  CreationDate: { type: 'string', description: 'Creation Date', optional: true },
  LastUpdateDate: { type: 'string', description: 'Last Update Date', optional: true },
} as const satisfies Record<string, ToolOutputProperty>
