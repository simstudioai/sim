import { isPlainRecord } from '@sim/utils/object'
import {
  type OracleFusionRequest,
  type OracleFusionResolvedCredential,
  requestOracleFusionEmpty,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  parseOracleFusionCollection,
} from '@/lib/internal/oracle-fusion/protocol'
import { oracleFusionExactInteger } from '@/lib/internal/oracle-fusion/request-body'
import type { ToolResponse } from '@/tools/types'

export class OracleFusionProjectManagementInputError extends Error {}

type FieldRule = {
  kind: 'string' | 'id' | 'number' | 'integer' | 'boolean' | 'resources'
  nullable?: boolean
  maxLength?: number
  format?: 'date' | 'date-time'
}
type BodyField = FieldRule & { field: string }
type OperationSpec = {
  family: keyof typeof responseFields
  path: string
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  list?: boolean
  action?: boolean
  required: readonly string[]
  body: Record<string, BodyField>
  filter?: string
  fixedBody?: Record<string, boolean>
}

// These are projections of the 26C schemas, not alternate transport or authentication rules.
// Numeric measures are returned as decimal text; identifiers remain exact decimal strings.
const responseFields = {
  project: {
    ProjectId: { kind: 'id' },
    ProjectName: { kind: 'string' },
    ProjectNumber: { kind: 'string' },
    ProjectDescription: { kind: 'string', nullable: true },
    ProjectStatusCode: { kind: 'string', nullable: true },
    ProjectStatus: { kind: 'string', nullable: true },
    ProjectStartDate: { kind: 'string' },
    ProjectEndDate: { kind: 'string', nullable: true },
    ProjectManagerEmail: { kind: 'string', nullable: true },
    ProjectManagerName: { kind: 'string', nullable: true },
    OwningOrganizationId: { kind: 'id' },
    OwningOrganizationName: { kind: 'string' },
    BusinessUnitId: { kind: 'id' },
    BusinessUnitName: { kind: 'string' },
    ProjectTypeId: { kind: 'id' },
    ProjectTypeName: { kind: 'string' },
    ProjectCurrencyCode: { kind: 'string' },
    CreationDate: { kind: 'string' },
    LastUpdateDate: { kind: 'string' },
  },
  plan: {
    ProjectId: { kind: 'id' },
    Name: { kind: 'string' },
    ProjectNumber: { kind: 'string' },
    Description: { kind: 'string', nullable: true },
    StartDate: { kind: 'string' },
    EndDate: { kind: 'string', nullable: true },
    Status: { kind: 'string' },
    StatusCode: { kind: 'string' },
    PercentComplete: { kind: 'number', nullable: true },
    CurrencyCode: { kind: 'string' },
    OrganizationId: { kind: 'id' },
    PrimaryProjectManagerName: { kind: 'string' },
    FinanciallyEnabledFlag: { kind: 'boolean', nullable: true },
    ViewAccessCode: { kind: 'string', nullable: true },
  },
  task: {
    TaskId: { kind: 'id' },
    Name: { kind: 'string' },
    TaskNumber: { kind: 'string' },
    TaskLevel: { kind: 'integer' },
    Description: { kind: 'string', nullable: true },
    ParentTaskId: { kind: 'id', nullable: true },
    MilestoneFlag: { kind: 'boolean', nullable: true },
    TaskStatusCode: { kind: 'string', nullable: true },
    PhysicalPercentComplete: { kind: 'number', nullable: true },
    PercentComplete: { kind: 'number', nullable: true },
    PlannedStartDateTime: { kind: 'string', nullable: true },
    PlannedFinishDateTime: { kind: 'string', nullable: true },
    PlannedEffort: { kind: 'number', nullable: true },
    PlannedDuration: { kind: 'number', nullable: true },
    ActualStartDateTime: { kind: 'string', nullable: true },
    ActualFinishDateTime: { kind: 'string', nullable: true },
    ActualHours: { kind: 'number', nullable: true },
    PrimaryResourceName: { kind: 'string' },
    PrimaryResourceEmail: { kind: 'string', nullable: true },
  },
  deliverable: {
    DeliverableId: { kind: 'id' },
    DeliverableName: { kind: 'string' },
    ShortName: { kind: 'string' },
    Description: { kind: 'string', nullable: true },
    NeedByDate: { kind: 'string', nullable: true },
    OwnerId: { kind: 'id', nullable: true },
    OwnerEmail: { kind: 'string', nullable: true },
    OwnerName: { kind: 'string', nullable: true },
    PriorityCode: { kind: 'string' },
    Priority: { kind: 'string', nullable: true },
    StatusCode: { kind: 'string' },
    Status: { kind: 'string', nullable: true },
    TypeId: { kind: 'id' },
    Type: { kind: 'string', nullable: true },
    CreationDate: { kind: 'string' },
  },
  association: {
    ObjectAssociationId: { kind: 'id' },
    ProjectId: { kind: 'id', nullable: true },
    ProjectName: { kind: 'string', nullable: true },
    ProjectNumber: { kind: 'string', nullable: true },
    TaskId: { kind: 'id' },
    TaskName: { kind: 'string', nullable: true },
    TaskNumber: { kind: 'string', nullable: true },
  },
  teamMember: {
    TeamMemberId: { kind: 'id', nullable: true },
    ProjectId: { kind: 'id', nullable: true },
    PersonId: { kind: 'id', nullable: true },
    PersonEmail: { kind: 'string', nullable: true },
    PersonName: { kind: 'string', nullable: true },
    ProjectRole: { kind: 'string', nullable: true },
    StartDate: { kind: 'string', nullable: true },
    FinishDate: { kind: 'string', nullable: true },
    AssignmentTypeCode: { kind: 'string', nullable: true },
    AssignmentType: { kind: 'string', nullable: true },
    ResourceAllocationPercentage: { kind: 'number', nullable: true },
    ResourceAssignmentEffortInHours: { kind: 'number', nullable: true },
    BillablePercent: { kind: 'string', nullable: true },
    TrackTimeFlag: { kind: 'boolean', nullable: true },
  },
  laborAssignment: {
    TaskLaborResourceAssignmentId: { kind: 'id' },
    TaskId: { kind: 'id' },
    LaborResourceId: { kind: 'id', nullable: true },
    ResourceEmail: { kind: 'string', nullable: true },
    ResourceName: { kind: 'string' },
    PrimaryResourceFlag: { kind: 'boolean', nullable: true },
    ResourceAllocation: { kind: 'number', nullable: true },
    PlannedEffortinHours: { kind: 'number', nullable: true },
    ActualEffortinHours: { kind: 'number', nullable: true },
    RemainingEffortinHours: { kind: 'number', nullable: true },
    PercentComplete: { kind: 'number', nullable: true },
    ProgressStatus: { kind: 'string', nullable: true },
    EffectiveBillRate: { kind: 'number', nullable: true },
    EffectiveCostRate: { kind: 'number', nullable: true },
  },
  resource: {
    ResourceId: { kind: 'id' },
    ResourceDisplayName: { kind: 'string' },
    ResourceEmail: { kind: 'string', nullable: true },
    PersonId: { kind: 'id', nullable: true },
    ResourceProjectPrimaryRole: { kind: 'string' },
    ResourceType: { kind: 'string', nullable: true },
  },
  cost: {
    CostId: { kind: 'id', nullable: true },
    ProjectId: { kind: 'id', nullable: true },
    ProjectName: { kind: 'string' },
    ProjectNumber: { kind: 'string' },
    TaskId: { kind: 'id' },
    TaskName: { kind: 'string' },
    TaskNumber: { kind: 'string', nullable: true },
    ExpenditureItemDate: { kind: 'string' },
    ExpenditureType: { kind: 'string' },
    ExpenditureOrganization: { kind: 'string' },
    Quantity: { kind: 'number', nullable: true },
    UnitOfMeasureCode: { kind: 'string', nullable: true },
    TransactionCurrency: { kind: 'string' },
    RawCostInTransactionCurrency: { kind: 'number', nullable: true },
    BurdenedCostInTransactionCurrency: { kind: 'number', nullable: true },
    RawCostInProjectCurrency: { kind: 'number', nullable: true },
    BurdenedCostInProjectCurrency: { kind: 'number', nullable: true },
    BillableFlag: { kind: 'boolean' },
    CapitalizableFlag: { kind: 'boolean', nullable: true },
    HoldInvoiceFlag: { kind: 'boolean' },
    HoldRevenueFlag: { kind: 'boolean', nullable: true },
    AccountingDate: { kind: 'string', nullable: true },
    AdjustmentStatus: { kind: 'string' },
    Comment: { kind: 'string' },
    ExternalBillRate: { kind: 'number', nullable: true },
    ExternalBillRateCurrency: { kind: 'string', nullable: true },
    IntercompanyBillRate: { kind: 'number', nullable: true },
    IntercompanyBillRateCurrency: { kind: 'string', nullable: true },
    LastUpdateDate: { kind: 'string' },
  },
  budget: {
    PlanVersionId: { kind: 'id' },
    PlanVersionName: { kind: 'string' },
    PlanVersionNumber: { kind: 'id', nullable: true },
    PlanVersionDescription: { kind: 'string', nullable: true },
    PlanVersionStatus: { kind: 'string', nullable: true },
    ProjectId: { kind: 'id' },
    ProjectName: { kind: 'string' },
    ProjectNumber: { kind: 'string' },
    FinancialPlanType: { kind: 'string', nullable: true },
    PlanningAmounts: { kind: 'string', nullable: true },
    LockedFlag: { kind: 'boolean', nullable: true },
    LockedBy: { kind: 'string', nullable: true },
    PCRawCostAmounts: { kind: 'number', nullable: true },
    PCBurdenedCostAmounts: { kind: 'number', nullable: true },
    PCRevenueAmounts: { kind: 'number', nullable: true },
    PFCRawCostAmounts: { kind: 'number', nullable: true },
    PFCBurdenedCostAmounts: { kind: 'number', nullable: true },
    PFCRevenueAmounts: { kind: 'number', nullable: true },
  },
  invoice: {
    InvoiceId: { kind: 'id' },
    InvoiceNumber: { kind: 'id' },
    InvoiceStatusCode: { kind: 'string' },
    InvoiceStatusMeaning: { kind: 'string' },
    InvoiceTypeCode: { kind: 'string', nullable: true },
    InvoiceTypeMeaning: { kind: 'string' },
    InvoiceAmount: { kind: 'number', nullable: true },
    TaxAmount: { kind: 'number', nullable: true },
    InvoiceCurrencyCode: { kind: 'string' },
    InvoiceDate: { kind: 'string', nullable: true },
    ContractId: { kind: 'id' },
    ContractNumber: { kind: 'string' },
    ProjectId: { kind: 'id', nullable: true },
    ProjectName: { kind: 'string', nullable: true },
    ProjectNumber: { kind: 'string', nullable: true },
    OrganizationId: { kind: 'id' },
    OrganizationName: { kind: 'string', nullable: true },
    InvoiceComment: { kind: 'string', nullable: true },
    InvoiceInstructions: { kind: 'string', nullable: true },
    ReceivablesNumber: { kind: 'string', nullable: true },
    SubmittedDate: { kind: 'string', nullable: true },
    ApprovedDate: { kind: 'string', nullable: true },
    ReleasedDate: { kind: 'string', nullable: true },
    TransferredDate: { kind: 'string', nullable: true },
    AcceptedDate: { kind: 'string', nullable: true },
    Canceled: { kind: 'string', nullable: true },
  },
  status: {
    ProjectStatusCode: { kind: 'string' },
    ProjectStatusName: { kind: 'string' },
    Description: { kind: 'string', nullable: true },
    StatusObjectCode: { kind: 'string' },
    StatusClassificationCode: { kind: 'string' },
    StartDateActive: { kind: 'string' },
    EndDateActive: { kind: 'string', nullable: true },
    WorkflowEnabledFlag: { kind: 'boolean', nullable: true },
  },
  history: {
    StatusHistoryId: { kind: 'id' },
    ObjectId: { kind: 'id' },
    StatusObject: { kind: 'string' },
    OldStatusCode: { kind: 'string' },
    OldStatus: { kind: 'string' },
    NewStatusCode: { kind: 'string' },
    NewStatus: { kind: 'string' },
    StatusChangeComments: { kind: 'string', nullable: true },
    CreationDate: { kind: 'string' },
    LastUpdateDate: { kind: 'string' },
  },
} as const satisfies Record<string, Record<string, FieldRule>>

const responseIds = {
  project: 'ProjectId',
  plan: 'ProjectId',
  task: 'TaskId',
  deliverable: 'DeliverableId',
  association: 'ObjectAssociationId',
  teamMember: 'TeamMemberId',
  laborAssignment: 'TaskLaborResourceAssignmentId',
  resource: 'ResourceId',
  cost: 'CostId',
  budget: 'PlanVersionId',
  invoice: 'InvoiceId',
  status: 'ProjectStatusCode',
  history: 'StatusHistoryId',
} as const

// Source-to-operation matrix. All resources use the foundation's fixed FSCM API version.
const operations = {
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-get.html
  list_projects: {
    family: 'project',
    path: 'projects',
    method: 'GET',
    list: true,
    required: [],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-get.html
  get_project: {
    family: 'project',
    path: 'projects/{projectId}',
    method: 'GET',
    required: ['projectId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-post.html
  create_project: {
    family: 'project',
    path: 'projects',
    method: 'POST',
    required: ['projectName', 'organizationName'],
    body: {
      projectName: { field: 'ProjectName', kind: 'string', maxLength: 240 },
      projectNumber: { field: 'ProjectNumber', kind: 'string', maxLength: 25 },
      projectDescription: {
        field: 'ProjectDescription',
        kind: 'string',
        nullable: true,
        maxLength: 2000,
      },
      projectStartDate: { field: 'ProjectStartDate', kind: 'string', format: 'date' },
      projectEndDate: { field: 'ProjectEndDate', kind: 'string', nullable: true, format: 'date' },
      projectStatusCode: {
        field: 'ProjectStatusCode',
        kind: 'string',
        nullable: true,
        maxLength: 30,
      },
      projectStatusChangeComment: {
        field: 'ProjectStatusChangeComment',
        kind: 'string',
        nullable: true,
        maxLength: 4000,
      },
      projectManagerEmail: { field: 'ProjectManagerEmail', kind: 'string', nullable: true },
      organizationName: { field: 'OwningOrganizationName', kind: 'string', maxLength: 240 },
      projectCurrencyCode: { field: 'ProjectCurrencyCode', kind: 'string', maxLength: 15 },
      sourceTemplateId: { field: 'SourceTemplateId', kind: 'id', nullable: true },
      sourceTemplateName: {
        field: 'SourceTemplateName',
        kind: 'string',
        nullable: true,
        maxLength: 255,
      },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-patch.html
  update_project: {
    family: 'project',
    path: 'projects/{projectId}',
    method: 'PATCH',
    required: ['projectId'],
    body: {
      projectName: { field: 'ProjectName', kind: 'string', maxLength: 240 },
      projectNumber: { field: 'ProjectNumber', kind: 'string', maxLength: 25 },
      projectDescription: {
        field: 'ProjectDescription',
        kind: 'string',
        nullable: true,
        maxLength: 2000,
      },
      projectStartDate: { field: 'ProjectStartDate', kind: 'string', format: 'date' },
      projectEndDate: { field: 'ProjectEndDate', kind: 'string', nullable: true, format: 'date' },
      projectStatusCode: {
        field: 'ProjectStatusCode',
        kind: 'string',
        nullable: true,
        maxLength: 30,
      },
      projectStatusChangeComment: {
        field: 'ProjectStatusChangeComment',
        kind: 'string',
        nullable: true,
        maxLength: 4000,
      },
      projectManagerEmail: { field: 'ProjectManagerEmail', kind: 'string', nullable: true },
      organizationName: { field: 'OwningOrganizationName', kind: 'string', maxLength: 240 },
      projectCurrencyCode: { field: 'ProjectCurrencyCode', kind: 'string', maxLength: 15 },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectstatuseslov-get.html
  list_project_statuses: {
    family: 'status',
    path: 'projectStatusesLOV',
    method: 'GET',
    list: true,
    required: [],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-child-projectstatushistory-get.html
  list_project_status_history: {
    family: 'history',
    path: 'projects/{projectId}/child/ProjectStatusHistory',
    method: 'GET',
    list: true,
    required: ['projectId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplandetails-get.html
  list_project_plans: {
    family: 'plan',
    path: 'projectPlanDetails',
    method: 'GET',
    list: true,
    required: [],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplandetails-projectid-get.html
  get_project_plan: {
    family: 'plan',
    path: 'projectPlanDetails/{projectId}',
    method: 'GET',
    required: ['projectId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplandetails-projectid-child-tasks-get.html
  list_tasks: {
    family: 'task',
    path: 'projectPlanDetails/{projectId}/child/Tasks',
    method: 'GET',
    list: true,
    required: ['projectId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplandetails-projectid-child-tasks-taskid-get.html
  get_task: {
    family: 'task',
    path: 'projectPlanDetails/{projectId}/child/Tasks/{taskId}',
    method: 'GET',
    required: ['projectId', 'taskId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasks-post.html
  create_task: {
    family: 'task',
    path: 'projectPlans/{projectId}/child/Tasks',
    method: 'POST',
    required: ['projectId', 'taskName', 'taskNumber', 'taskLevel'],
    body: {
      taskName: { field: 'Name', kind: 'string', maxLength: 255 },
      taskNumber: { field: 'TaskNumber', kind: 'string', maxLength: 100 },
      taskLevel: { field: 'TaskLevel', kind: 'integer' },
      description: { field: 'Description', kind: 'string', nullable: true, maxLength: 2000 },
      parentTaskId: { field: 'ParentTaskId', kind: 'id', nullable: true },
      milestoneFlag: { field: 'MilestoneFlag', kind: 'boolean', nullable: true, maxLength: 1 },
      plannedStartDateTime: {
        field: 'PlannedStartDateTime',
        kind: 'string',
        nullable: true,
        format: 'date-time',
      },
      plannedFinishDateTime: {
        field: 'PlannedFinishDateTime',
        kind: 'string',
        nullable: true,
        format: 'date-time',
      },
      plannedEffort: { field: 'PlannedEffort', kind: 'number', nullable: true },
      plannedDuration: { field: 'PlannedDuration', kind: 'number', nullable: true },
      taskStatusCode: { field: 'TaskStatusCode', kind: 'string', nullable: true, maxLength: 20 },
      statusChangeComments: {
        field: 'StatusChangeComments',
        kind: 'string',
        nullable: true,
        maxLength: 4000,
      },
      physicalPercentComplete: { field: 'PhysicalPercentComplete', kind: 'number', nullable: true },
      percentComplete: { field: 'PercentComplete', kind: 'number', nullable: true },
      actualStartDateTime: {
        field: 'ActualStartDateTime',
        kind: 'string',
        nullable: true,
        format: 'date-time',
      },
      actualFinishDateTime: {
        field: 'ActualFinishDateTime',
        kind: 'string',
        nullable: true,
        format: 'date-time',
      },
      actualHours: { field: 'ActualHours', kind: 'number', nullable: true },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasks-taskid-patch.html
  update_task: {
    family: 'task',
    path: 'projectPlans/{projectId}/child/Tasks/{taskId}',
    method: 'PATCH',
    required: ['projectId', 'taskId'],
    body: {
      taskName: { field: 'Name', kind: 'string', maxLength: 255 },
      taskNumber: { field: 'TaskNumber', kind: 'string', maxLength: 100 },
      taskLevel: { field: 'TaskLevel', kind: 'integer' },
      description: { field: 'Description', kind: 'string', nullable: true, maxLength: 2000 },
      parentTaskId: { field: 'ParentTaskId', kind: 'id', nullable: true },
      milestoneFlag: { field: 'MilestoneFlag', kind: 'boolean', nullable: true, maxLength: 1 },
      plannedStartDateTime: {
        field: 'PlannedStartDateTime',
        kind: 'string',
        nullable: true,
        format: 'date-time',
      },
      plannedFinishDateTime: {
        field: 'PlannedFinishDateTime',
        kind: 'string',
        nullable: true,
        format: 'date-time',
      },
      plannedEffort: { field: 'PlannedEffort', kind: 'number', nullable: true },
      plannedDuration: { field: 'PlannedDuration', kind: 'number', nullable: true },
      taskStatusCode: { field: 'TaskStatusCode', kind: 'string', nullable: true, maxLength: 20 },
      statusChangeComments: {
        field: 'StatusChangeComments',
        kind: 'string',
        nullable: true,
        maxLength: 4000,
      },
      physicalPercentComplete: { field: 'PhysicalPercentComplete', kind: 'number', nullable: true },
      percentComplete: { field: 'PercentComplete', kind: 'number', nullable: true },
      actualStartDateTime: {
        field: 'ActualStartDateTime',
        kind: 'string',
        nullable: true,
        format: 'date-time',
      },
      actualFinishDateTime: {
        field: 'ActualFinishDateTime',
        kind: 'string',
        nullable: true,
        format: 'date-time',
      },
      actualHours: { field: 'ActualHours', kind: 'number', nullable: true },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasks-taskid-delete.html
  delete_task: {
    family: 'task',
    path: 'projectPlans/{projectId}/child/Tasks/{taskId}',
    method: 'DELETE',
    required: ['projectId', 'taskId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplandetails-projectid-child-tasks-get.html
  list_milestones: {
    family: 'task',
    path: 'projectPlanDetails/{projectId}/child/Tasks',
    method: 'GET',
    list: true,
    required: ['projectId'],
    body: {},
    filter: 'MilestoneFlag=true',
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasks-post.html
  create_milestone: {
    family: 'task',
    path: 'projectPlans/{projectId}/child/Tasks',
    method: 'POST',
    required: ['projectId', 'taskName', 'taskNumber', 'taskLevel'],
    body: {
      taskName: { field: 'Name', kind: 'string', maxLength: 255 },
      taskNumber: { field: 'TaskNumber', kind: 'string', maxLength: 100 },
      taskLevel: { field: 'TaskLevel', kind: 'integer' },
      description: { field: 'Description', kind: 'string', nullable: true, maxLength: 2000 },
      parentTaskId: { field: 'ParentTaskId', kind: 'id', nullable: true },
      plannedStartDateTime: {
        field: 'PlannedStartDateTime',
        kind: 'string',
        nullable: true,
        format: 'date-time',
      },
      plannedFinishDateTime: {
        field: 'PlannedFinishDateTime',
        kind: 'string',
        nullable: true,
        format: 'date-time',
      },
      plannedEffort: { field: 'PlannedEffort', kind: 'number', nullable: true },
      plannedDuration: { field: 'PlannedDuration', kind: 'number', nullable: true },
      taskStatusCode: { field: 'TaskStatusCode', kind: 'string', nullable: true, maxLength: 20 },
      statusChangeComments: {
        field: 'StatusChangeComments',
        kind: 'string',
        nullable: true,
        maxLength: 4000,
      },
      physicalPercentComplete: { field: 'PhysicalPercentComplete', kind: 'number', nullable: true },
      percentComplete: { field: 'PercentComplete', kind: 'number', nullable: true },
      actualStartDateTime: {
        field: 'ActualStartDateTime',
        kind: 'string',
        nullable: true,
        format: 'date-time',
      },
      actualFinishDateTime: {
        field: 'ActualFinishDateTime',
        kind: 'string',
        nullable: true,
        format: 'date-time',
      },
      actualHours: { field: 'ActualHours', kind: 'number', nullable: true },
    },
    fixedBody: { MilestoneFlag: true },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasks-taskid-child-statushistory-get.html
  list_task_status_history: {
    family: 'history',
    path: 'projectPlans/{projectId}/child/Tasks/{taskId}/child/StatusHistory',
    method: 'GET',
    list: true,
    required: ['projectId', 'taskId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-get.html
  list_deliverables: {
    family: 'deliverable',
    path: 'deliverables',
    method: 'GET',
    list: true,
    required: [],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-deliverableid-get.html
  get_deliverable: {
    family: 'deliverable',
    path: 'deliverables/{deliverableId}',
    method: 'GET',
    required: ['deliverableId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-post.html
  create_deliverable: {
    family: 'deliverable',
    path: 'deliverables',
    method: 'POST',
    required: [
      'deliverableName',
      'shortName',
      'deliverablePriorityCode',
      'deliverableStatusCode',
      'deliverableTypeId',
    ],
    body: {
      deliverableName: { field: 'DeliverableName', kind: 'string', maxLength: 150 },
      shortName: { field: 'ShortName', kind: 'string', maxLength: 30 },
      description: { field: 'Description', kind: 'string', nullable: true, maxLength: 1000 },
      needByDate: { field: 'NeedByDate', kind: 'string', nullable: true, format: 'date' },
      ownerEmail: { field: 'OwnerEmail', kind: 'string', nullable: true },
      deliverablePriorityCode: { field: 'PriorityCode', kind: 'string', maxLength: 30 },
      deliverableStatusCode: { field: 'StatusCode', kind: 'string', maxLength: 30 },
      deliverableTypeId: { field: 'TypeId', kind: 'id' },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-deliverableid-patch.html
  update_deliverable: {
    family: 'deliverable',
    path: 'deliverables/{deliverableId}',
    method: 'PATCH',
    required: ['deliverableId'],
    body: {
      deliverableName: { field: 'DeliverableName', kind: 'string', maxLength: 150 },
      shortName: { field: 'ShortName', kind: 'string', maxLength: 30 },
      description: { field: 'Description', kind: 'string', nullable: true, maxLength: 1000 },
      needByDate: { field: 'NeedByDate', kind: 'string', nullable: true, format: 'date' },
      ownerEmail: { field: 'OwnerEmail', kind: 'string', nullable: true },
      deliverablePriorityCode: { field: 'PriorityCode', kind: 'string', maxLength: 30 },
      deliverableStatusCode: { field: 'StatusCode', kind: 'string', maxLength: 30 },
      deliverableTypeId: { field: 'TypeId', kind: 'id' },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-deliverableid-delete.html
  delete_deliverable: {
    family: 'deliverable',
    path: 'deliverables/{deliverableId}',
    method: 'DELETE',
    required: ['deliverableId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-deliverableid-child-projecttaskassociation-get.html
  list_deliverable_task_associations: {
    family: 'association',
    path: 'deliverables/{deliverableId}/child/ProjectTaskAssociation',
    method: 'GET',
    list: true,
    required: ['deliverableId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-deliverableid-child-projecttaskassociation-objectassociationid-get.html
  get_deliverable_task_association: {
    family: 'association',
    path: 'deliverables/{deliverableId}/child/ProjectTaskAssociation/{associationId}',
    method: 'GET',
    required: ['deliverableId', 'associationId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-deliverableid-child-projecttaskassociation-post.html
  create_deliverable_task_association: {
    family: 'association',
    path: 'deliverables/{deliverableId}/child/ProjectTaskAssociation',
    method: 'POST',
    required: ['deliverableId', 'projectId', 'taskId'],
    body: {
      projectId: { field: 'ProjectId', kind: 'id', nullable: true },
      taskId: { field: 'TaskId', kind: 'id' },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-deliverableid-child-projecttaskassociation-objectassociationid-patch.html
  update_deliverable_task_association: {
    family: 'association',
    path: 'deliverables/{deliverableId}/child/ProjectTaskAssociation/{associationId}',
    method: 'PATCH',
    required: ['deliverableId', 'associationId'],
    body: {
      projectId: { field: 'ProjectId', kind: 'id', nullable: true },
      taskId: { field: 'TaskId', kind: 'id' },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-deliverableid-child-projecttaskassociation-objectassociationid-delete.html
  delete_deliverable_task_association: {
    family: 'association',
    path: 'deliverables/{deliverableId}/child/ProjectTaskAssociation/{associationId}',
    method: 'DELETE',
    required: ['deliverableId', 'associationId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-child-projectteammembers-get.html
  list_project_team_members: {
    family: 'teamMember',
    path: 'projects/{projectId}/child/ProjectTeamMembers',
    method: 'GET',
    list: true,
    required: ['projectId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-child-projectteammembers-teammemberid-get.html
  get_project_team_member: {
    family: 'teamMember',
    path: 'projects/{projectId}/child/ProjectTeamMembers/{teamMemberId}',
    method: 'GET',
    required: ['projectId', 'teamMemberId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-child-projectteammembers-post.html
  create_project_team_member: {
    family: 'teamMember',
    path: 'projects/{projectId}/child/ProjectTeamMembers',
    method: 'POST',
    required: ['projectId', 'personEmail', 'projectRole'],
    body: {
      personEmail: { field: 'PersonEmail', kind: 'string', nullable: true, maxLength: 240 },
      projectRole: { field: 'ProjectRole', kind: 'string', nullable: true, maxLength: 240 },
      startDate: { field: 'StartDate', kind: 'string', nullable: true, format: 'date' },
      finishDate: { field: 'FinishDate', kind: 'string', nullable: true, format: 'date' },
      assignmentTypeCode: { field: 'AssignmentTypeCode', kind: 'string', nullable: true },
      resourceAllocationPercentage: {
        field: 'ResourceAllocationPercentage',
        kind: 'number',
        nullable: true,
      },
      resourceAssignmentEffortInHours: {
        field: 'ResourceAssignmentEffortInHours',
        kind: 'number',
        nullable: true,
      },
      billablePercent: { field: 'BillablePercent', kind: 'string', nullable: true },
      trackTimeFlag: { field: 'TrackTimeFlag', kind: 'boolean', nullable: true, maxLength: 255 },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-child-projectteammembers-teammemberid-patch.html
  update_project_team_member: {
    family: 'teamMember',
    path: 'projects/{projectId}/child/ProjectTeamMembers/{teamMemberId}',
    method: 'PATCH',
    required: ['projectId', 'teamMemberId'],
    body: {
      startDate: { field: 'StartDate', kind: 'string', nullable: true, format: 'date' },
      finishDate: { field: 'FinishDate', kind: 'string', nullable: true, format: 'date' },
      assignmentTypeCode: { field: 'AssignmentTypeCode', kind: 'string', nullable: true },
      resourceAllocationPercentage: {
        field: 'ResourceAllocationPercentage',
        kind: 'number',
        nullable: true,
      },
      resourceAssignmentEffortInHours: {
        field: 'ResourceAssignmentEffortInHours',
        kind: 'number',
        nullable: true,
      },
      billablePercent: { field: 'BillablePercent', kind: 'string', nullable: true },
      trackTimeFlag: { field: 'TrackTimeFlag', kind: 'boolean', nullable: true, maxLength: 255 },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-child-projectteammembers-teammemberid-delete.html
  delete_project_team_member: {
    family: 'teamMember',
    path: 'projects/{projectId}/child/ProjectTeamMembers/{teamMemberId}',
    method: 'DELETE',
    required: ['projectId', 'teamMemberId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasklaborresourceassignments-get.html
  list_task_labor_resource_assignments: {
    family: 'laborAssignment',
    path: 'projectPlans/{projectId}/child/TaskLaborResourceAssignments',
    method: 'GET',
    list: true,
    required: ['projectId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasklaborresourceassignments-tasklaborresourceassignmentid-get.html
  get_task_labor_resource_assignment: {
    family: 'laborAssignment',
    path: 'projectPlans/{projectId}/child/TaskLaborResourceAssignments/{assignmentId}',
    method: 'GET',
    required: ['projectId', 'assignmentId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasklaborresourceassignments-post.html
  create_task_labor_resource_assignment: {
    family: 'laborAssignment',
    path: 'projectPlans/{projectId}/child/TaskLaborResourceAssignments',
    method: 'POST',
    required: ['projectId', 'taskId'],
    body: {
      taskId: { field: 'TaskId', kind: 'id' },
      resourceEmail: { field: 'ResourceEmail', kind: 'string', nullable: true, maxLength: 240 },
      laborResourceId: { field: 'LaborResourceId', kind: 'id', nullable: true },
      plannedEffortinHours: { field: 'PlannedEffortinHours', kind: 'number', nullable: true },
      actualEffortinHours: { field: 'ActualEffortinHours', kind: 'number', nullable: true },
      remainingEffortinHours: { field: 'RemainingEffortinHours', kind: 'number', nullable: true },
      percentComplete: { field: 'PercentComplete', kind: 'number', nullable: true },
      primaryResourceFlag: { field: 'PrimaryResourceFlag', kind: 'boolean', nullable: true },
      resourceAllocation: { field: 'ResourceAllocation', kind: 'number', nullable: true },
      effectiveBillRate: { field: 'EffectiveBillRate', kind: 'number', nullable: true },
      effectiveCostRate: { field: 'EffectiveCostRate', kind: 'number', nullable: true },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasklaborresourceassignments-tasklaborresourceassignmentid-patch.html
  update_task_labor_resource_assignment: {
    family: 'laborAssignment',
    path: 'projectPlans/{projectId}/child/TaskLaborResourceAssignments/{assignmentId}',
    method: 'PATCH',
    required: ['projectId', 'assignmentId'],
    body: {
      resourceEmail: { field: 'ResourceEmail', kind: 'string', nullable: true, maxLength: 240 },
      laborResourceId: { field: 'LaborResourceId', kind: 'id', nullable: true },
      plannedEffortinHours: { field: 'PlannedEffortinHours', kind: 'number', nullable: true },
      actualEffortinHours: { field: 'ActualEffortinHours', kind: 'number', nullable: true },
      remainingEffortinHours: { field: 'RemainingEffortinHours', kind: 'number', nullable: true },
      percentComplete: { field: 'PercentComplete', kind: 'number', nullable: true },
      primaryResourceFlag: { field: 'PrimaryResourceFlag', kind: 'boolean', nullable: true },
      resourceAllocation: { field: 'ResourceAllocation', kind: 'number', nullable: true },
      effectiveBillRate: { field: 'EffectiveBillRate', kind: 'number', nullable: true },
      effectiveCostRate: { field: 'EffectiveCostRate', kind: 'number', nullable: true },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasklaborresourceassignments-tasklaborresourceassignmentid-delete.html
  delete_task_labor_resource_assignment: {
    family: 'laborAssignment',
    path: 'projectPlans/{projectId}/child/TaskLaborResourceAssignments/{assignmentId}',
    method: 'DELETE',
    required: ['projectId', 'assignmentId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectenterpriseresources-get.html
  list_project_enterprise_resources: {
    family: 'resource',
    path: 'projectEnterpriseResources',
    method: 'GET',
    list: true,
    required: [],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcosts-get.html
  list_project_costs: {
    family: 'cost',
    path: 'projectCosts',
    method: 'GET',
    list: true,
    required: [],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcosts-projectcostsuniqid-get.html
  get_project_cost: {
    family: 'cost',
    path: 'projectCosts/{costKey}',
    method: 'GET',
    required: ['costKey'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcosts-projectcostsuniqid-patch.html
  update_project_cost: {
    family: 'cost',
    path: 'projectCosts/{costKey}',
    method: 'PATCH',
    required: ['costKey'],
    body: {
      externalBillRate: { field: 'ExternalBillRate', kind: 'number', nullable: true },
      externalBillRateCurrency: {
        field: 'ExternalBillRateCurrency',
        kind: 'string',
        nullable: true,
        maxLength: 15,
      },
      externalBillRateSourceName: {
        field: 'ExternalBillRateSourceName',
        kind: 'string',
        nullable: true,
        maxLength: 150,
      },
      externalBillRateSourceReference: {
        field: 'ExternalBillRateSourceReference',
        kind: 'string',
        nullable: true,
        maxLength: 30,
      },
      intercompanyBillRate: { field: 'IntercompanyBillRate', kind: 'number', nullable: true },
      intercompanyBillRateCurrency: {
        field: 'IntercompanyBillRateCurrency',
        kind: 'string',
        nullable: true,
        maxLength: 15,
      },
      intercompanyBillRateSourceName: {
        field: 'IntercompanyBillRateSourceName',
        kind: 'string',
        nullable: true,
        maxLength: 150,
      },
      intercompanyBillRateSourceReference: {
        field: 'IntercompanyBillRateSourceReference',
        kind: 'string',
        nullable: true,
        maxLength: 20,
      },
      payrollCostedCode: {
        field: 'PayrollCostedCode',
        kind: 'string',
        nullable: true,
        maxLength: 1,
      },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcosts-projectcostsuniqid-action-adjustprojectcosts-post.html
  adjust_project_cost: {
    family: 'cost',
    path: 'projectCosts/{costKey}/action/adjustProjectCosts',
    method: 'POST',
    action: true,
    required: ['costKey', 'adjustmentTypeCode'],
    body: {
      adjustmentTypeCode: { field: 'AdjustmentTypeCode', kind: 'string', nullable: true },
      justification: { field: 'Justification', kind: 'string', nullable: true },
      comment: { field: 'Comment', kind: 'string', nullable: true },
      quantity: { field: 'Quantity', kind: 'number', nullable: true },
      billableFlag: { field: 'BillableFlag', kind: 'boolean', nullable: true },
      capitalizableFlag: { field: 'CapitalizableFlag', kind: 'boolean', nullable: true },
      holdInvoiceFlag: { field: 'HoldInvoiceFlag', kind: 'boolean', nullable: true },
      holdRevenueFlag: { field: 'HoldRevenueFlag', kind: 'boolean', nullable: true },
      targetProjectId: { field: 'ProjectId', kind: 'id', nullable: true },
      targetTaskId: { field: 'TaskId', kind: 'id', nullable: true },
      rawCostInTransactionCurrency: {
        field: 'RawCostInTransactionCurrency',
        kind: 'number',
        nullable: true,
      },
      transactionCurrencyCode: { field: 'TransactionCurrencyCode', kind: 'string', nullable: true },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-get.html
  list_project_budgets: {
    family: 'budget',
    path: 'projectBudgets',
    method: 'GET',
    list: true,
    required: [],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-planversionid-get.html
  get_project_budget: {
    family: 'budget',
    path: 'projectBudgets/{planVersionId}',
    method: 'GET',
    required: ['planVersionId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-post.html
  create_project_budget: {
    family: 'budget',
    path: 'projectBudgets',
    method: 'POST',
    required: ['projectId', 'projectName', 'projectNumber', 'planVersionName'],
    body: {
      projectId: { field: 'ProjectId', kind: 'id' },
      projectName: { field: 'ProjectName', kind: 'string', maxLength: 240 },
      projectNumber: { field: 'ProjectNumber', kind: 'string', maxLength: 25 },
      planVersionName: { field: 'PlanVersionName', kind: 'string', maxLength: 225 },
      planVersionDescription: {
        field: 'PlanVersionDescription',
        kind: 'string',
        nullable: true,
        maxLength: 2000,
      },
      financialPlanType: {
        field: 'FinancialPlanType',
        kind: 'string',
        nullable: true,
        maxLength: 240,
      },
      planVersionStatus: { field: 'PlanVersionStatus', kind: 'string', nullable: true },
      budgetCreationMethod: { field: 'BudgetCreationMethod', kind: 'string', nullable: true },
      budgetGenerationSource: { field: 'BudgetGenerationSource', kind: 'string', nullable: true },
      planningAmounts: { field: 'PlanningAmounts', kind: 'string', nullable: true, maxLength: 30 },
      sourcePlanType: { field: 'SourcePlanType', kind: 'string', nullable: true },
      sourcePlanVersionId: { field: 'SourcePlanVersionId', kind: 'id', nullable: true },
      sourcePlanVersionNumber: {
        field: 'SourcePlanVersionNumber',
        kind: 'integer',
        nullable: true,
      },
      sourcePlanVersionStatus: { field: 'SourcePlanVersionStatus', kind: 'string', nullable: true },
      copyAdjustmentPercentage: {
        field: 'CopyAdjustmentPercentage',
        kind: 'number',
        nullable: true,
      },
      deferFinancialPlanCreation: {
        field: 'DeferFinancialPlanCreation',
        kind: 'string',
        nullable: true,
      },
      planningResources: { field: 'PlanningResources', kind: 'resources' },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-planversionid-patch.html
  update_project_budget: {
    family: 'budget',
    path: 'projectBudgets/{planVersionId}',
    method: 'PATCH',
    required: ['planVersionId'],
    body: {
      planVersionName: { field: 'PlanVersionName', kind: 'string', maxLength: 225 },
      planVersionDescription: {
        field: 'PlanVersionDescription',
        kind: 'string',
        nullable: true,
        maxLength: 2000,
      },
      financialPlanType: {
        field: 'FinancialPlanType',
        kind: 'string',
        nullable: true,
        maxLength: 240,
      },
      planVersionStatus: { field: 'PlanVersionStatus', kind: 'string', nullable: true },
      lockedFlag: { field: 'LockedFlag', kind: 'boolean', nullable: true },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-planversionid-delete.html
  delete_project_budget: {
    family: 'budget',
    path: 'projectBudgets/{planVersionId}',
    method: 'DELETE',
    required: ['planVersionId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-planversionid-action-adjust-post.html
  adjust_project_budget: {
    family: 'budget',
    path: 'projectBudgets/{planVersionId}/action/adjust',
    method: 'POST',
    action: true,
    required: ['planVersionId', 'adjustmentPercentage', 'adjustmentType'],
    body: {
      adjustmentPercentage: { field: 'adjustmentPercentage', kind: 'number', nullable: true },
      fromPeriod: { field: 'fromPeriod', kind: 'string', nullable: true },
      adjustmentType: { field: 'adjustmentType', kind: 'string', nullable: true },
      toPeriod: { field: 'toPeriod', kind: 'string', nullable: true },
      createNewWorkingVersion: { field: 'createNewWorkingVersion', kind: 'string', nullable: true },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-planversionid-action-refreshrates-post.html
  refresh_project_budget_rates: {
    family: 'budget',
    path: 'projectBudgets/{planVersionId}/action/refreshRates',
    method: 'POST',
    action: true,
    required: ['planVersionId'],
    body: {
      retainRateOverride: { field: 'retainRateOverride', kind: 'string', nullable: true },
      refreshOnlyConversionRates: {
        field: 'refreshOnlyConversionRates',
        kind: 'string',
        nullable: true,
      },
      refreshRatesPeriodForward: {
        field: 'refreshRatesPeriodForward',
        kind: 'string',
        nullable: true,
      },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcontractinvoices-get.html
  list_project_contract_invoices: {
    family: 'invoice',
    path: 'projectContractInvoices',
    method: 'GET',
    list: true,
    required: [],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcontractinvoices-invoiceid-get.html
  get_project_contract_invoice: {
    family: 'invoice',
    path: 'projectContractInvoices/{invoiceId}',
    method: 'GET',
    required: ['invoiceId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcontractinvoices-invoiceid-patch.html
  update_project_contract_invoice: {
    family: 'invoice',
    path: 'projectContractInvoices/{invoiceId}',
    method: 'PATCH',
    required: ['invoiceId'],
    body: {
      invoiceComment: { field: 'InvoiceComment', kind: 'string', nullable: true, maxLength: 240 },
      invoiceDate: { field: 'InvoiceDate', kind: 'string', nullable: true, format: 'date' },
      invoiceInstructions: {
        field: 'InvoiceInstructions',
        kind: 'string',
        nullable: true,
        maxLength: 240,
      },
      unreleaseComments: {
        field: 'UnreleaseComments',
        kind: 'string',
        nullable: true,
        maxLength: 240,
      },
    },
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcontractinvoices-invoiceid-delete.html
  delete_draft_project_contract_invoice: {
    family: 'invoice',
    path: 'projectContractInvoices/{invoiceId}',
    method: 'DELETE',
    required: ['invoiceId'],
    body: {},
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcontractinvoices-invoiceid-action-releaseprojectcontractinvoice-post.html
  transition_project_contract_invoice: {
    family: 'invoice',
    path: 'projectContractInvoices/{invoiceId}',
    method: 'POST',
    action: true,
    required: ['invoiceId', 'action'],
    body: {
      receivablesNumber: { field: 'receivablesNumber', kind: 'string', nullable: true },
      creditMemoReasonCode: { field: 'creditMemoReasonCode', kind: 'string', nullable: true },
      invoiceDate: { field: 'invoiceDate', kind: 'string', nullable: true, format: 'date' },
      creditMemoReasonMeaning: { field: 'creditMemoReasonMeaning', kind: 'string', nullable: true },
      unreleaseComments: { field: 'unreleaseComments', kind: 'string', nullable: true },
    },
  },
} as const satisfies Record<string, OperationSpec>

export type OracleFusionProjectManagementOperation = keyof typeof operations

const INVOICE_ACTIONS = {
  submit: 'submitProjectContractInvoice',
  approve: 'approveProjectContractInvoice',
  reject: 'rejectProjectContractInvoice',
  release: 'releaseProjectContractInvoice',
  return_to_draft: 'returnToDraftProjectContractInvoice',
  unrelease: 'unreleaseProjectContractInvoice',
  cancel: 'cancelProjectContractInvoice',
} as const

function invalid(field: string, requirement: string): never {
  throw new OracleFusionProjectManagementInputError(`${field} ${requirement}`)
}

export function requireProjectManagementId(value: unknown, field = 'ID'): string {
  if (typeof value !== 'string') invalid(field, 'must be a decimal ID string')
  const id = normalizeOracleFusionDecimalIdentifier(value.trim(), { maxDigits: 18 })
  if (!id || id === '0') invalid(field, 'must be a positive decimal ID of at most 18 digits')
  return id
}

function parseValue(value: unknown, rule: FieldRule, field: string): unknown {
  if (value === null) {
    if (rule.nullable) return null
    invalid(field, 'cannot be null')
  }
  if (rule.kind === 'id') return oracleFusionExactInteger(requireProjectManagementId(value, field))
  if (rule.kind === 'resources') return parseBudgetResources(value)
  if (rule.kind === 'string') {
    if (typeof value !== 'string' || value.length > (rule.maxLength ?? 4000)) {
      invalid(field, 'must be a string within the documented length limit')
    }
    if (rule.format) {
      const date = value.slice(0, 10)
      const validDate =
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        Number.isFinite(Date.parse(date)) &&
        new Date(date).toISOString().slice(0, 10) === date
      if (
        !validDate ||
        (rule.format === 'date'
          ? value !== date
          : !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
            !Number.isFinite(Date.parse(value)))
      ) {
        invalid(field, `must be an ISO ${rule.format}`)
      }
    }
    return value
  }
  if (rule.kind === 'boolean') {
    if (typeof value !== 'boolean') invalid(field, 'must be a boolean')
    return value
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (Number.isInteger(value) && !Number.isSafeInteger(value)) ||
    (rule.kind === 'integer' && !Number.isSafeInteger(value))
  ) {
    invalid(field, 'must be a finite, safely represented number')
  }
  if (/percent|allocation/i.test(field) && !/adjustment/i.test(field) && (value < 0 || value > 100)) {
    invalid(field, 'must be between 0 and 100')
  }
  if (field === 'taskLevel' && (value < 1 || value > 999)) {
    invalid(field, 'must be between 1 and 999; level 0 is reserved for the project rollup')
  }
  return value
}

// Budget lines follow the nested POST schema, not the unrelated root PlanningAmounts string.
// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-post.html
function parseBudgetResources(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 100) {
    invalid('planningResources', 'must be an array of at most 100 lines')
  }
  const amountFields: Record<string, FieldRule> = {
    Currency: { kind: 'string', maxLength: 15 },
    Quantity: { kind: 'number', nullable: true },
    RawCostAmounts: { kind: 'number', nullable: true },
    BurdenedCostAmounts: { kind: 'number', nullable: true },
    RevenueAmounts: { kind: 'number', nullable: true },
  }
  return value.map((line) => {
    if (!isPlainRecord(line)) invalid('planningResources', 'must contain objects')
    const allowed = ['RbsElementId', 'TaskId', 'PlanningStartDate', 'PlanningEndDate', 'PlanningAmounts']
    if (Object.keys(line).some((key) => !allowed.includes(key))) {
      invalid('planningResources', 'contains an unsupported line field')
    }
    const result: Record<string, unknown> = {
      RbsElementId: oracleFusionExactInteger(requireProjectManagementId(line.RbsElementId, 'RbsElementId')),
      TaskId: oracleFusionExactInteger(requireProjectManagementId(line.TaskId, 'TaskId')),
    }
    for (const key of ['PlanningStartDate', 'PlanningEndDate']) {
      if (line[key] !== undefined) {
        result[key] = parseValue(line[key], { kind: 'string', format: 'date-time', nullable: true }, key)
      }
    }
    if (line.PlanningAmounts !== undefined) {
      if (!Array.isArray(line.PlanningAmounts) || line.PlanningAmounts.length > 100) {
        invalid('PlanningAmounts', 'must be an array of at most 100 amounts')
      }
      result.PlanningAmounts = line.PlanningAmounts.map((amount) => {
        if (
          !isPlainRecord(amount) ||
          Object.keys(amount).some((key) => !Object.hasOwn(amountFields, key))
        ) {
          invalid('PlanningAmounts', 'contains an unsupported amount field')
        }
        if (typeof amount.Currency !== 'string' || !amount.Currency.trim()) {
          invalid('Currency', 'is required for each planning amount')
        }
        return Object.fromEntries(
          Object.entries(amount).map(([key, entry]) => [key, parseValue(entry, amountFields[key], key)])
        )
      })
    }
    return result
  })
}

function pageInteger(value: unknown, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    invalid(name, `must be an integer between ${min} and ${max}`)
  }
  return value
}

function optionalQuery(value: unknown, name: string): string | undefined {
  if (value === undefined || value === '') return undefined
  if (typeof value !== 'string' || value.length > 4000 || /[\u0000-\u001f\u007f]/.test(value)) {
    invalid(name, 'must be a bounded query string')
  }
  return value
}

function projectRecord(
  family: keyof typeof responseFields,
  value: unknown,
  credential: OracleFusionResolvedCredential
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error('Invalid Oracle resource')
  const fields: Record<string, FieldRule> = responseFields[family]
  const result: Record<string, unknown> = {}
  for (const [field, rule] of Object.entries(fields)) {
    const entry = value[field]
    if (entry === undefined) {
      if (field === responseIds[family]) throw new Error('Missing Oracle resource identifier')
      continue
    }
    if (entry === null) {
      if (!rule.nullable) throw new Error('Unexpected null Oracle field')
      result[field] = null
    } else if (rule.kind === 'id') {
      const id = normalizeOracleFusionDecimalIdentifier(entry, { maxDigits: 18 })
      if (!id) throw new Error('Invalid Oracle identifier')
      result[field] = id
    } else if (rule.kind === 'number') {
      // Framework 9 may return numeric measures as strings. Do not coerce large integers.
      if (
        typeof entry === 'number'
          ? !Number.isFinite(entry) || (Number.isInteger(entry) && !Number.isSafeInteger(entry))
          : typeof entry !== 'string' ||
            entry.length > 128 ||
            !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(entry)
      ) {
        throw new Error('Invalid Oracle numeric measure')
      }
      result[field] = String(entry)
    } else if (rule.kind === 'integer') {
      if (typeof entry !== 'number' || !Number.isSafeInteger(entry)) {
        throw new Error('Invalid Oracle integer')
      }
      result[field] = entry
    } else {
      if (typeof entry !== rule.kind) throw new Error('Invalid Oracle field')
      result[field] = entry
    }
  }
  if (family === 'cost') {
    result.costKey = extractOracleFusionOpaqueKey(value, credential.instanceUrl, {
      family: 'fscm',
      relativePath: 'projectCosts',
    })
  }
  return result
}

export async function executeOracleFusionProjectManagementOperation(
  operation: OracleFusionProjectManagementOperation,
  input: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  signal?.throwIfAborted()
  if (!isPlainRecord(input)) invalid('Input', 'must be an object')
  const spec: OperationSpec = operations[operation]
  if (!spec) invalid('Operation', 'is not supported')
  for (const name of spec.required) {
    if (
      input[name] === undefined ||
      input[name] === null ||
      (typeof input[name] === 'string' && !input[name].trim())
    ) {
      invalid(name, 'is required')
    }
  }
  if (
    typeof input.accessToken !== 'string' ||
    !input.accessToken ||
    typeof input.instanceUrl !== 'string' ||
    !input.instanceUrl
  ) {
    invalid('Credential', 'must provide resolved authentication and an application origin')
  }
  const credential = { accessToken: input.accessToken, instanceUrl: input.instanceUrl }
  let path = spec.path.replace(/\{([^}]+)\}/g, (_, field: string) => {
    if (field !== 'costKey') return requireProjectManagementId(input[field], field)
    if (typeof input[field] !== 'string') invalid(field, 'must be an opaque key string')
    try {
      return encodeOracleFusionPathSegment(input[field])
    } catch {
      return invalid(field, 'must be a safe opaque resource key')
    }
  })
  const body: Record<string, unknown> = { ...spec.fixedBody }
  for (const [name, field] of Object.entries(spec.body)) {
    if (input[name] !== undefined) body[field.field] = parseValue(input[name], field, name)
  }
  if (spec.method === 'PATCH' && Object.keys(body).length === 0) {
    invalid('Update', 'requires at least one editable field')
  }
  if (operation === 'create_project_budget') {
    // Oracle documents a returned budget version only for synchronous creation.
    if (input.deferFinancialPlanCreation !== undefined && input.deferFinancialPlanCreation !== 'N') {
      invalid('deferFinancialPlanCreation', 'must be N; deferred budget responses are not supported')
    }
    body.DeferFinancialPlanCreation = 'N'
  }
  if (
    operation === 'create_task_labor_resource_assignment' ||
    operation === 'update_task_labor_resource_assignment'
  ) {
    const hasEmail = typeof input.resourceEmail === 'string' && input.resourceEmail.trim().length > 0
    const hasId = typeof input.laborResourceId === 'string' && input.laborResourceId.trim().length > 0
    if (hasEmail === hasId || input.resourceEmail === null || input.laborResourceId === null) {
      invalid('Resource', 'requires exactly one of resourceEmail and laborResourceId')
    }
  }
  if (operation === 'transition_project_contract_invoice') {
    if (typeof input.action !== 'string' || !Object.hasOwn(INVOICE_ACTIONS, input.action)) {
      invalid('action', 'is not a supported invoice transition')
    }
    const action = input.action as keyof typeof INVOICE_ACTIONS
    const allowed =
      action === 'release'
        ? ['receivablesNumber', 'creditMemoReasonCode', 'invoiceDate', 'creditMemoReasonMeaning']
        : action === 'unrelease'
          ? ['unreleaseComments']
          : []
    if (Object.keys(body).some((name) => !allowed.includes(name))) {
      invalid('Invoice transition', 'contains fields that do not apply to the selected action')
    }
    path += `/action/${INVOICE_ACTIONS[action]}`
  }
  const query: Record<string, string | number | boolean | undefined> = {}
  if (spec.list) {
    query.limit = pageInteger(input.limit, 'limit', 100, 1, 1000)
    query.offset = pageInteger(input.offset, 'offset', 0, 0, 1_000_000_000)
    query.orderBy = optionalQuery(input.orderBy, 'orderBy') ?? `${responseIds[spec.family]}:asc`
    if (input.totalResults !== undefined) {
      query.totalResults = parseValue(input.totalResults, { kind: 'boolean' }, 'totalResults') as boolean
    }
    const filters: string[] = spec.filter ? [spec.filter] : []
    if (
      ['cost', 'budget', 'invoice'].includes(spec.family) &&
      input.projectId !== undefined &&
      input.projectId !== ''
    ) {
      filters.push(`ProjectId=${requireProjectManagementId(input.projectId, 'projectId')}`)
    }
    if (spec.family === 'laborAssignment' && input.taskId !== undefined && input.taskId !== '') {
      filters.push(`TaskId=${requireProjectManagementId(input.taskId, 'taskId')}`)
    }
    if (
      spec.family === 'status' &&
      input.statusObjectCode !== undefined &&
      input.statusObjectCode !== ''
    ) {
      const code = optionalQuery(input.statusObjectCode, 'statusObjectCode') as string
      filters.push(`StatusObjectCode='${code.replace(/'/g, "''")}'`)
    }
    const filter = optionalQuery(input.q, 'q')
    if (filter) filters.push(`(${filter})`)
    if (filters.length) query.q = filters.join(' and ')
  }
  if (spec.method === 'GET') {
    query.fields = Object.keys(responseFields[spec.family]).join(',')
    // Costs require their bound self link, not onlyData or @context.key.
    if (spec.family !== 'cost') query.onlyData = true
  }
  const address = { family: 'fscm' as const, relativePath: path }
  try {
    if (spec.method === 'DELETE') {
      await requestOracleFusionEmpty(credential, { address, method: 'DELETE' }, signal)
      signal?.throwIfAborted()
      const idField = [...spec.path.matchAll(/\{([^}]+)\}/g)].at(-1)?.[1]
      return {
        success: true,
        output: {
          deleted: true,
          id: idField ? requireProjectManagementId(input[idField], idField) : undefined,
        },
      }
    }
    const request: OracleFusionRequest =
      spec.method === 'GET'
        ? { address, method: 'GET', query }
        : {
            address,
            method: spec.method,
            body,
            mediaType: spec.action ? 'application/vnd.oracle.adf.action+json' : 'application/json',
          }
    const data = await requestOracleFusionJson(credential, request, signal)
    signal?.throwIfAborted()
    if (spec.action) {
      if (!isPlainRecord(data) || typeof data.result !== 'string') {
        throw new Error('Invalid Oracle action result')
      }
      return { success: true, output: { result: data.result } }
    }
    if (spec.list) {
      const page = parseOracleFusionCollection(
        data,
        (item) => projectRecord(spec.family, item, credential),
        { expectedOffset: query.offset as number, maxItems: query.limit as number }
      )
      return { success: true, output: page }
    }
    return { success: true, output: { [spec.family]: projectRecord(spec.family, data, credential) } }
  } catch (error) {
    signal?.throwIfAborted()
    return {
      success: false,
      output: {},
      error:
        error instanceof OracleFusionProviderError
          ? error.message
          : spec.method === 'GET'
            ? 'Oracle Project Management returned an invalid response.'
            : 'The Oracle Project Management response could not be validated. The change may have completed; read the resource before retrying.',
      ...(spec.method !== 'GET' ? { retryable: false } : {}),
    }
  }
}
