import type { ToolResponse } from '@/tools/types'

export interface OracleFusionProjectManagementAuthParams {
  oauthCredential: string
  /** Credential-injected values, never a workflow-selected destination. */
  accessToken?: string
  instanceUrl?: string
}

export interface OracleFusionProject {
  ProjectId: string
  ProjectName?: string
  ProjectNumber?: string
  ProjectDescription?: string | null
  ProjectStatusCode?: string | null
  ProjectStatus?: string | null
  ProjectStartDate?: string
  ProjectEndDate?: string | null
  ProjectManagerEmail?: string | null
  ProjectManagerName?: string | null
  OwningOrganizationId?: string
  OwningOrganizationName?: string
  BusinessUnitId?: string
  BusinessUnitName?: string
  ProjectTypeId?: string
  ProjectTypeName?: string
  ProjectCurrencyCode?: string
  CreationDate?: string
  LastUpdateDate?: string
}

export interface OracleFusionPlan {
  ProjectId: string
  Name?: string
  ProjectNumber?: string
  Description?: string | null
  StartDate?: string
  EndDate?: string | null
  Status?: string
  StatusCode?: string
  PercentComplete?: string | null
  CurrencyCode?: string
  OrganizationId?: string
  PrimaryProjectManagerName?: string
  FinanciallyEnabledFlag?: boolean | null
  ViewAccessCode?: string | null
}

export interface OracleFusionTask {
  TaskId: string
  Name?: string
  TaskNumber?: string
  TaskLevel?: number
  Description?: string | null
  ParentTaskId?: string | null
  MilestoneFlag?: boolean | null
  TaskStatusCode?: string | null
  PhysicalPercentComplete?: string | null
  PercentComplete?: string | null
  PlannedStartDateTime?: string | null
  PlannedFinishDateTime?: string | null
  PlannedEffort?: string | null
  PlannedDuration?: string | null
  ActualStartDateTime?: string | null
  ActualFinishDateTime?: string | null
  ActualHours?: string | null
  PrimaryResourceName?: string
  PrimaryResourceEmail?: string | null
}

export interface OracleFusionDeliverable {
  DeliverableId: string
  DeliverableName?: string
  ShortName?: string
  Description?: string | null
  NeedByDate?: string | null
  OwnerId?: string | null
  OwnerEmail?: string | null
  OwnerName?: string | null
  PriorityCode?: string
  Priority?: string | null
  StatusCode?: string
  Status?: string | null
  TypeId?: string
  Type?: string | null
  CreationDate?: string
}

export interface OracleFusionAssociation {
  ObjectAssociationId: string
  ProjectId?: string | null
  ProjectName?: string | null
  ProjectNumber?: string | null
  TaskId?: string
  TaskName?: string | null
  TaskNumber?: string | null
}

export interface OracleFusionTeamMember {
  TeamMemberId: string | null
  ProjectId?: string | null
  PersonId?: string | null
  PersonEmail?: string | null
  PersonName?: string | null
  ProjectRole?: string | null
  StartDate?: string | null
  FinishDate?: string | null
  AssignmentTypeCode?: string | null
  AssignmentType?: string | null
  ResourceAllocationPercentage?: string | null
  ResourceAssignmentEffortInHours?: string | null
  BillablePercent?: string | null
  TrackTimeFlag?: boolean | null
}

export interface OracleFusionLaborAssignment {
  TaskLaborResourceAssignmentId: string
  TaskId?: string
  LaborResourceId?: string | null
  ResourceEmail?: string | null
  ResourceName?: string
  PrimaryResourceFlag?: boolean | null
  ResourceAllocation?: string | null
  PlannedEffortinHours?: string | null
  ActualEffortinHours?: string | null
  RemainingEffortinHours?: string | null
  PercentComplete?: string | null
  ProgressStatus?: string | null
  EffectiveBillRate?: string | null
  EffectiveCostRate?: string | null
}

export interface OracleFusionResource {
  ResourceId: string
  ResourceDisplayName?: string
  ResourceEmail?: string | null
  PersonId?: string | null
  ResourceProjectPrimaryRole?: string
  ResourceType?: string | null
}

export interface OracleFusionCost {
  /** Bound self-link key for subsequent cost operations; distinct from CostId. */
  costKey: string
  CostId: string | null
  ProjectId?: string | null
  ProjectName?: string
  ProjectNumber?: string
  TaskId?: string
  TaskName?: string
  TaskNumber?: string | null
  ExpenditureItemDate?: string
  ExpenditureType?: string
  ExpenditureOrganization?: string
  Quantity?: string | null
  UnitOfMeasureCode?: string | null
  TransactionCurrency?: string
  RawCostInTransactionCurrency?: string | null
  BurdenedCostInTransactionCurrency?: string | null
  RawCostInProjectCurrency?: string | null
  BurdenedCostInProjectCurrency?: string | null
  BillableFlag?: boolean
  CapitalizableFlag?: boolean | null
  HoldInvoiceFlag?: boolean
  HoldRevenueFlag?: boolean | null
  AccountingDate?: string | null
  AdjustmentStatus?: string
  Comment?: string
  ExternalBillRate?: string | null
  ExternalBillRateCurrency?: string | null
  IntercompanyBillRate?: string | null
  IntercompanyBillRateCurrency?: string | null
  LastUpdateDate?: string
}

export interface OracleFusionBudget {
  PlanVersionId: string
  PlanVersionName?: string
  PlanVersionNumber?: string | null
  PlanVersionDescription?: string | null
  PlanVersionStatus?: string | null
  ProjectId?: string
  ProjectName?: string
  ProjectNumber?: string
  FinancialPlanType?: string | null
  PlanningAmounts?: string | null
  LockedFlag?: boolean | null
  LockedBy?: string | null
  PCRawCostAmounts?: string | null
  PCBurdenedCostAmounts?: string | null
  PCRevenueAmounts?: string | null
  PFCRawCostAmounts?: string | null
  PFCBurdenedCostAmounts?: string | null
  PFCRevenueAmounts?: string | null
}

export interface OracleFusionInvoice {
  InvoiceId: string
  InvoiceNumber?: string
  InvoiceStatusCode?: string
  InvoiceStatusMeaning?: string
  InvoiceTypeCode?: string | null
  InvoiceTypeMeaning?: string
  InvoiceAmount?: string | null
  TaxAmount?: string | null
  InvoiceCurrencyCode?: string
  InvoiceDate?: string | null
  ContractId?: string
  ContractNumber?: string
  ProjectId?: string | null
  ProjectName?: string | null
  ProjectNumber?: string | null
  OrganizationId?: string
  OrganizationName?: string | null
  InvoiceComment?: string | null
  InvoiceInstructions?: string | null
  ReceivablesNumber?: string | null
  SubmittedDate?: string | null
  ApprovedDate?: string | null
  ReleasedDate?: string | null
  TransferredDate?: string | null
  AcceptedDate?: string | null
  Canceled?: string | null
}

export interface OracleFusionStatus {
  ProjectStatusCode: string
  ProjectStatusName?: string
  Description?: string | null
  StatusObjectCode?: string
  StatusClassificationCode?: string
  StartDateActive?: string
  EndDateActive?: string | null
  WorkflowEnabledFlag?: boolean | null
}

export interface OracleFusionHistory {
  StatusHistoryId: string
  ObjectId?: string
  StatusObject?: string
  OldStatusCode?: string
  OldStatus?: string
  NewStatusCode?: string
  NewStatus?: string
  StatusChangeComments?: string | null
  CreationDate?: string
  LastUpdateDate?: string
}

export interface OracleFusionBudgetAmountInput {
  Currency: string
  Quantity?: number | null
  RawCostAmounts?: number | null
  BurdenedCostAmounts?: number | null
  RevenueAmounts?: number | null
}

export interface OracleFusionBudgetResourceInput {
  RbsElementId: string
  TaskId: string
  PlanningStartDate?: string | null
  PlanningEndDate?: string | null
  PlanningAmounts?: OracleFusionBudgetAmountInput[]
}

export interface OracleFusionListProjectsParams extends OracleFusionProjectManagementAuthParams {
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export interface OracleFusionGetProjectParams extends OracleFusionProjectManagementAuthParams {
  projectId: string
}

export interface OracleFusionCreateProjectParams extends OracleFusionProjectManagementAuthParams {
  projectName: string
  projectNumber?: string
  projectDescription?: string | null
  projectStartDate?: string
  projectEndDate?: string | null
  projectStatusCode?: string | null
  projectStatusChangeComment?: string | null
  projectManagerEmail?: string | null
  organizationName: string
  projectCurrencyCode?: string
  sourceTemplateId?: string | null
  sourceTemplateName?: string | null
}

export interface OracleFusionUpdateProjectParams extends OracleFusionProjectManagementAuthParams {
  projectId: string
  projectName?: string
  projectNumber?: string
  projectDescription?: string | null
  projectStartDate?: string
  projectEndDate?: string | null
  projectStatusCode?: string | null
  projectStatusChangeComment?: string | null
  projectManagerEmail?: string | null
  organizationName?: string
  projectCurrencyCode?: string
}

export interface OracleFusionListProjectStatusesParams
  extends OracleFusionProjectManagementAuthParams {
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
  statusObjectCode?: string
}

export interface OracleFusionListProjectStatusHistoryParams
  extends OracleFusionProjectManagementAuthParams {
  projectId: string
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export interface OracleFusionListProjectPlansParams
  extends OracleFusionProjectManagementAuthParams {
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export interface OracleFusionGetProjectPlanParams extends OracleFusionProjectManagementAuthParams {
  projectId: string
}

export interface OracleFusionListTasksParams extends OracleFusionProjectManagementAuthParams {
  projectId: string
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export interface OracleFusionGetTaskParams extends OracleFusionProjectManagementAuthParams {
  projectId: string
  taskId: string
}

export interface OracleFusionCreateTaskParams extends OracleFusionProjectManagementAuthParams {
  projectId: string
  taskName: string
  taskNumber: string
  taskLevel: number
  description?: string | null
  parentTaskId?: string | null
  milestoneFlag?: boolean | null
  plannedStartDateTime?: string | null
  plannedFinishDateTime?: string | null
  plannedEffort?: number | null
  plannedDuration?: number | null
  taskStatusCode?: string | null
  statusChangeComments?: string | null
  physicalPercentComplete?: number | null
  percentComplete?: number | null
  actualStartDateTime?: string | null
  actualFinishDateTime?: string | null
  actualHours?: number | null
}

export interface OracleFusionUpdateTaskParams extends OracleFusionProjectManagementAuthParams {
  projectId: string
  taskId: string
  taskName?: string
  taskNumber?: string
  taskLevel?: number
  description?: string | null
  parentTaskId?: string | null
  milestoneFlag?: boolean | null
  plannedStartDateTime?: string | null
  plannedFinishDateTime?: string | null
  plannedEffort?: number | null
  plannedDuration?: number | null
  taskStatusCode?: string | null
  statusChangeComments?: string | null
  physicalPercentComplete?: number | null
  percentComplete?: number | null
  actualStartDateTime?: string | null
  actualFinishDateTime?: string | null
  actualHours?: number | null
}

export interface OracleFusionDeleteTaskParams extends OracleFusionProjectManagementAuthParams {
  projectId: string
  taskId: string
}

export interface OracleFusionListMilestonesParams extends OracleFusionProjectManagementAuthParams {
  projectId: string
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export interface OracleFusionCreateMilestoneParams extends OracleFusionProjectManagementAuthParams {
  projectId: string
  taskName: string
  taskNumber: string
  taskLevel: number
  description?: string | null
  parentTaskId?: string | null
  plannedStartDateTime?: string | null
  plannedFinishDateTime?: string | null
  plannedEffort?: number | null
  plannedDuration?: number | null
  taskStatusCode?: string | null
  statusChangeComments?: string | null
  physicalPercentComplete?: number | null
  percentComplete?: number | null
  actualStartDateTime?: string | null
  actualFinishDateTime?: string | null
  actualHours?: number | null
}

export interface OracleFusionListTaskStatusHistoryParams
  extends OracleFusionProjectManagementAuthParams {
  projectId: string
  taskId: string
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export interface OracleFusionListDeliverablesParams
  extends OracleFusionProjectManagementAuthParams {
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export interface OracleFusionGetDeliverableParams extends OracleFusionProjectManagementAuthParams {
  deliverableId: string
}

export interface OracleFusionCreateDeliverableParams
  extends OracleFusionProjectManagementAuthParams {
  deliverableName: string
  shortName: string
  description?: string | null
  needByDate?: string | null
  ownerEmail?: string | null
  deliverablePriorityCode: string
  deliverableStatusCode: string
  deliverableTypeId: string
}

export interface OracleFusionUpdateDeliverableParams
  extends OracleFusionProjectManagementAuthParams {
  deliverableId: string
  deliverableName?: string
  shortName?: string
  description?: string | null
  needByDate?: string | null
  ownerEmail?: string | null
  deliverablePriorityCode?: string
  deliverableStatusCode?: string
  deliverableTypeId?: string
}

export interface OracleFusionDeleteDeliverableParams
  extends OracleFusionProjectManagementAuthParams {
  deliverableId: string
}

export interface OracleFusionListDeliverableTaskAssociationsParams
  extends OracleFusionProjectManagementAuthParams {
  deliverableId: string
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export interface OracleFusionGetDeliverableTaskAssociationParams
  extends OracleFusionProjectManagementAuthParams {
  deliverableId: string
  associationId: string
}

export interface OracleFusionCreateDeliverableTaskAssociationParams
  extends OracleFusionProjectManagementAuthParams {
  deliverableId: string
  projectId: string | null
  taskId: string
}

export interface OracleFusionUpdateDeliverableTaskAssociationParams
  extends OracleFusionProjectManagementAuthParams {
  deliverableId: string
  associationId: string
  projectId?: string | null
  taskId?: string
}

export interface OracleFusionDeleteDeliverableTaskAssociationParams
  extends OracleFusionProjectManagementAuthParams {
  deliverableId: string
  associationId: string
}

export interface OracleFusionListProjectTeamMembersParams
  extends OracleFusionProjectManagementAuthParams {
  projectId: string
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export interface OracleFusionGetProjectTeamMemberParams
  extends OracleFusionProjectManagementAuthParams {
  projectId: string
  teamMemberId: string
}

export interface OracleFusionCreateProjectTeamMemberParams
  extends OracleFusionProjectManagementAuthParams {
  projectId: string
  personEmail: string | null
  projectRole: string | null
  startDate?: string | null
  finishDate?: string | null
  assignmentTypeCode?: string | null
  resourceAllocationPercentage?: number | null
  resourceAssignmentEffortInHours?: number | null
  billablePercent?: string | null
  trackTimeFlag?: boolean | null
}

export interface OracleFusionUpdateProjectTeamMemberParams
  extends OracleFusionProjectManagementAuthParams {
  projectId: string
  teamMemberId: string
  startDate?: string | null
  finishDate?: string | null
  assignmentTypeCode?: string | null
  resourceAllocationPercentage?: number | null
  resourceAssignmentEffortInHours?: number | null
  billablePercent?: string | null
  trackTimeFlag?: boolean | null
}

export interface OracleFusionDeleteProjectTeamMemberParams
  extends OracleFusionProjectManagementAuthParams {
  projectId: string
  teamMemberId: string
}

export interface OracleFusionListTaskLaborResourceAssignmentsParams
  extends OracleFusionProjectManagementAuthParams {
  projectId: string
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
  taskId?: string
}

export interface OracleFusionGetTaskLaborResourceAssignmentParams
  extends OracleFusionProjectManagementAuthParams {
  projectId: string
  assignmentId: string
}

export interface OracleFusionCreateTaskLaborResourceAssignmentParams
  extends OracleFusionProjectManagementAuthParams {
  projectId: string
  taskId: string
  resourceEmail?: string | null
  laborResourceId?: string | null
  plannedEffortinHours?: number | null
  actualEffortinHours?: number | null
  remainingEffortinHours?: number | null
  percentComplete?: number | null
  primaryResourceFlag?: boolean | null
  resourceAllocation?: number | null
  effectiveBillRate?: number | null
  effectiveCostRate?: number | null
}

export interface OracleFusionUpdateTaskLaborResourceAssignmentParams
  extends OracleFusionProjectManagementAuthParams {
  projectId: string
  assignmentId: string
  resourceEmail?: string | null
  laborResourceId?: string | null
  plannedEffortinHours?: number | null
  actualEffortinHours?: number | null
  remainingEffortinHours?: number | null
  percentComplete?: number | null
  primaryResourceFlag?: boolean | null
  resourceAllocation?: number | null
  effectiveBillRate?: number | null
  effectiveCostRate?: number | null
}

export interface OracleFusionDeleteTaskLaborResourceAssignmentParams
  extends OracleFusionProjectManagementAuthParams {
  projectId: string
  assignmentId: string
}

export interface OracleFusionListProjectEnterpriseResourcesParams
  extends OracleFusionProjectManagementAuthParams {
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
}

export interface OracleFusionListProjectCostsParams
  extends OracleFusionProjectManagementAuthParams {
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
  projectId?: string
}

export interface OracleFusionGetProjectCostParams extends OracleFusionProjectManagementAuthParams {
  costKey: string
}

export interface OracleFusionUpdateProjectCostParams
  extends OracleFusionProjectManagementAuthParams {
  costKey: string
  externalBillRate?: number | null
  externalBillRateCurrency?: string | null
  externalBillRateSourceName?: string | null
  externalBillRateSourceReference?: string | null
  intercompanyBillRate?: number | null
  intercompanyBillRateCurrency?: string | null
  intercompanyBillRateSourceName?: string | null
  intercompanyBillRateSourceReference?: string | null
  payrollCostedCode?: string | null
}

export interface OracleFusionAdjustProjectCostParams
  extends OracleFusionProjectManagementAuthParams {
  costKey: string
  adjustmentTypeCode: string | null
  justification?: string | null
  comment?: string | null
  quantity?: number | null
  billableFlag?: boolean | null
  capitalizableFlag?: boolean | null
  holdInvoiceFlag?: boolean | null
  holdRevenueFlag?: boolean | null
  targetProjectId?: string | null
  targetTaskId?: string | null
  rawCostInTransactionCurrency?: number | null
  transactionCurrencyCode?: string | null
}

export interface OracleFusionListProjectBudgetsParams
  extends OracleFusionProjectManagementAuthParams {
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
  projectId?: string
}

export interface OracleFusionGetProjectBudgetParams
  extends OracleFusionProjectManagementAuthParams {
  planVersionId: string
}

export interface OracleFusionCreateProjectBudgetParams
  extends OracleFusionProjectManagementAuthParams {
  projectId: string
  projectName: string
  projectNumber: string
  planVersionName: string
  planVersionDescription?: string | null
  financialPlanType?: string | null
  planVersionStatus?: string | null
  budgetCreationMethod?: string | null
  budgetGenerationSource?: string | null
  planningAmounts?: string | null
  sourcePlanType?: string | null
  sourcePlanVersionId?: string | null
  sourcePlanVersionNumber?: number | null
  sourcePlanVersionStatus?: string | null
  copyAdjustmentPercentage?: number | null
  deferFinancialPlanCreation?: string | null
  planningResources?: OracleFusionBudgetResourceInput[]
}

export interface OracleFusionUpdateProjectBudgetParams
  extends OracleFusionProjectManagementAuthParams {
  planVersionId: string
  planVersionName?: string
  planVersionDescription?: string | null
  financialPlanType?: string | null
  planVersionStatus?: string | null
  lockedFlag?: boolean | null
}

export interface OracleFusionDeleteProjectBudgetParams
  extends OracleFusionProjectManagementAuthParams {
  planVersionId: string
}

export interface OracleFusionAdjustProjectBudgetParams
  extends OracleFusionProjectManagementAuthParams {
  planVersionId: string
  adjustmentPercentage: number | null
  fromPeriod?: string | null
  adjustmentType: string | null
  toPeriod?: string | null
  createNewWorkingVersion?: string | null
}

export interface OracleFusionRefreshProjectBudgetRatesParams
  extends OracleFusionProjectManagementAuthParams {
  planVersionId: string
  retainRateOverride?: string | null
  refreshOnlyConversionRates?: string | null
  refreshRatesPeriodForward?: string | null
}

export interface OracleFusionListProjectContractInvoicesParams
  extends OracleFusionProjectManagementAuthParams {
  q?: string
  orderBy?: string
  limit?: number
  offset?: number
  totalResults?: boolean
  projectId?: string
}

export interface OracleFusionGetProjectContractInvoiceParams
  extends OracleFusionProjectManagementAuthParams {
  invoiceId: string
}

export interface OracleFusionUpdateProjectContractInvoiceParams
  extends OracleFusionProjectManagementAuthParams {
  invoiceId: string
  invoiceComment?: string | null
  invoiceDate?: string | null
  invoiceInstructions?: string | null
  unreleaseComments?: string | null
}

export interface OracleFusionDeleteDraftProjectContractInvoiceParams
  extends OracleFusionProjectManagementAuthParams {
  invoiceId: string
}

export interface OracleFusionTransitionProjectContractInvoiceParams
  extends OracleFusionProjectManagementAuthParams {
  invoiceId: string
  receivablesNumber?: string | null
  creditMemoReasonCode?: string | null
  invoiceDate?: string | null
  creditMemoReasonMeaning?: string | null
  unreleaseComments?: string | null
  action: 'submit' | 'approve' | 'reject' | 'release' | 'return_to_draft' | 'unrelease' | 'cancel'
}

export interface OracleFusionProjectManagementResponse extends ToolResponse {
  output: {
    project?: OracleFusionProject
    plan?: OracleFusionPlan
    task?: OracleFusionTask
    deliverable?: OracleFusionDeliverable
    association?: OracleFusionAssociation
    teamMember?: OracleFusionTeamMember
    laborAssignment?: OracleFusionLaborAssignment
    resource?: OracleFusionResource
    cost?: OracleFusionCost
    budget?: OracleFusionBudget
    invoice?: OracleFusionInvoice
    status?: OracleFusionStatus
    history?: OracleFusionHistory
    items?: Array<
      | OracleFusionProject
      | OracleFusionPlan
      | OracleFusionTask
      | OracleFusionDeliverable
      | OracleFusionAssociation
      | OracleFusionTeamMember
      | OracleFusionLaborAssignment
      | OracleFusionResource
      | OracleFusionCost
      | OracleFusionBudget
      | OracleFusionInvoice
      | OracleFusionStatus
      | OracleFusionHistory
    >
    count?: number
    hasMore?: boolean
    limit?: number
    offset?: number
    nextOffset?: number
    totalResults?: number
    result?: string
    deleted?: boolean
    id?: string
  }
}
