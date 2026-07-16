import type { OutputProperty, ToolResponse } from '@/tools/types'

/** Base URL for the Rocketlane REST API (v1.0). */
export const ROCKETLANE_API_BASE = 'https://api.rocketlane.com/api/1.0'

/** Every Rocketlane tool authenticates with the account API key via the `api-key` header. */
export interface RocketlaneBaseParams {
  apiKey: string
}

/**
 * Builds the standard auth headers shared by every Rocketlane request.
 */
export function rocketlaneHeaders(apiKey: string): Record<string, string> {
  return {
    'api-key': apiKey,
    'Content-Type': 'application/json',
  }
}

/**
 * Extracts a human-readable error message from a non-OK Rocketlane response.
 * Errors are returned as `{ errors: [{ errorCode, errorMessage, field }] }`.
 */
export async function rocketlaneError(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const parsed = JSON.parse(text)
    const errors = Array.isArray(parsed?.errors) ? parsed.errors : []
    const messages = errors
      .map((e: { errorMessage?: string; field?: string }) =>
        e?.errorMessage
          ? e.field
            ? `${e.errorMessage} (field: ${e.field})`
            : e.errorMessage
          : null
      )
      .filter(Boolean)
    if (messages.length > 0) return messages.join('; ')
  } catch {
    // Fall through to the raw body.
  }
  return text || `Rocketlane API error (HTTP ${response.status})`
}

type Raw = Record<string, unknown>

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function asObject(value: unknown): Raw | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

// region Shared object shapes

/** Compact user reference returned inside most Rocketlane resources. */
export interface RocketlaneUserSummary {
  userId: number | null
  firstName: string | null
  lastName: string | null
  emailId: string | null
}

export function mapUserSummary(value: unknown): RocketlaneUserSummary | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    userId: asNumber(raw.userId),
    firstName: asString(raw.firstName),
    lastName: asString(raw.lastName),
    emailId: asString(raw.emailId),
  }
}

export const USER_SUMMARY_OUTPUT_PROPERTIES = {
  userId: { type: 'number', description: 'Unique identifier of the user', nullable: true },
  firstName: { type: 'string', description: 'First name of the user', nullable: true },
  lastName: { type: 'string', description: 'Last name of the user', nullable: true },
  emailId: { type: 'string', description: 'Email address of the user', nullable: true },
} satisfies Record<string, OutputProperty>

/** Pagination envelope returned by every Rocketlane list endpoint. */
export interface RocketlanePagination {
  pageSize: number | null
  hasMore: boolean | null
  totalRecordCount: number | null
  nextPageToken: string | null
}

export function mapPagination(value: unknown): RocketlanePagination {
  const raw = asObject(value) ?? {}
  return {
    pageSize: asNumber(raw.pageSize),
    hasMore: asBoolean(raw.hasMore),
    totalRecordCount: asNumber(raw.totalRecordCount),
    nextPageToken: asString(raw.nextPageToken),
  }
}

export const PAGINATION_OUTPUT_PROPERTIES = {
  pageSize: {
    type: 'number',
    description: 'Page size used for the current request',
    nullable: true,
  },
  hasMore: { type: 'boolean', description: 'Whether more results are available', nullable: true },
  totalRecordCount: {
    type: 'number',
    description: 'Total number of records matching the request',
    nullable: true,
  },
  nextPageToken: {
    type: 'string',
    description: 'Token for fetching the next page (valid for 15 minutes)',
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

// endregion

// region Tasks

/** Compact project reference returned inside a Rocketlane task. */
export interface RocketlaneTaskProjectRef {
  projectId: number | null
  projectName: string | null
}

/** Compact phase reference returned inside a Rocketlane task. */
export interface RocketlaneTaskPhaseRef {
  phaseId: number | null
  phaseName: string | null
}

/** Value/label pair used for task status and priority fields. */
export interface RocketlaneTaskChoice {
  value: number | null
  label: string | null
}

/** Role associated with a placeholder assignee. */
export interface RocketlaneTaskRole {
  roleId: number | null
  roleName: string | null
}

/** Placeholder assignee on a task, associated with a role. */
export interface RocketlaneTaskPlaceholder {
  placeholderId: number | null
  placeholderName: string | null
  role: RocketlaneTaskRole | null
}

/** Assignees of a task: members (team members or customers) and placeholders. */
export interface RocketlaneTaskAssignees {
  members: RocketlaneUserSummary[]
  placeholders: RocketlaneTaskPlaceholder[]
}

/** Followers of a task (members only). */
export interface RocketlaneTaskFollowers {
  members: RocketlaneUserSummary[]
}

/** Lite task reference used for dependencies and the parent task. */
export interface RocketlaneTaskLite {
  taskId: number | null
  taskName: string | null
}

/** Custom field value attached to a task. */
export interface RocketlaneTaskField {
  fieldId: number | null
  fieldLabel: string | null
  fieldValue: unknown
  fieldValueLabel: string | null
}

/** Time entry category associated with a task. */
export interface RocketlaneTaskTimeEntryCategory {
  categoryId: number | null
  categoryName: string | null
}

/** Financials budget in which the task's time entry is added. */
export interface RocketlaneTaskBudget {
  budgetId: number | null
  budgetName: string | null
}

/** A Rocketlane task as returned by the Tasks endpoints. */
export interface RocketlaneTask {
  taskId: number | null
  taskName: string | null
  taskDescription: string | null
  taskPrivateNote: string | null
  startDate: string | null
  dueDate: string | null
  startDateActual: string | null
  dueDateActual: string | null
  archived: boolean | null
  effortInMinutes: number | null
  progress: number | null
  atRisk: boolean | null
  type: string | null
  createdAt: number | null
  updatedAt: number | null
  createdBy: RocketlaneUserSummary | null
  updatedBy: RocketlaneUserSummary | null
  project: RocketlaneTaskProjectRef | null
  phase: RocketlaneTaskPhaseRef | null
  status: RocketlaneTaskChoice | null
  priority: RocketlaneTaskChoice | null
  fields: RocketlaneTaskField[]
  assignees: RocketlaneTaskAssignees | null
  followers: RocketlaneTaskFollowers | null
  dependencies: RocketlaneTaskLite[]
  parent: RocketlaneTaskLite | null
  externalReferenceId: string | null
  billable: boolean | null
  timeEntryCategory: RocketlaneTaskTimeEntryCategory | null
  financialsBudgets: RocketlaneTaskBudget[]
  csatEnabled: boolean | null
  private: boolean | null
}

function mapTaskProjectRef(value: unknown): RocketlaneTaskProjectRef | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    projectId: asNumber(raw.projectId),
    projectName: asString(raw.projectName),
  }
}

function mapTaskPhaseRef(value: unknown): RocketlaneTaskPhaseRef | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    phaseId: asNumber(raw.phaseId),
    phaseName: asString(raw.phaseName),
  }
}

function mapTaskChoice(value: unknown): RocketlaneTaskChoice | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    value: asNumber(raw.value),
    label: asString(raw.label),
  }
}

function mapTaskRole(value: unknown): RocketlaneTaskRole | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    roleId: asNumber(raw.roleId),
    roleName: asString(raw.roleName),
  }
}

function mapTaskPlaceholder(value: unknown): RocketlaneTaskPlaceholder {
  const raw = asObject(value) ?? {}
  return {
    placeholderId: asNumber(raw.placeholderId),
    placeholderName: asString(raw.placeholderName),
    role: mapTaskRole(raw.role),
  }
}

function mapTaskAssignees(value: unknown): RocketlaneTaskAssignees | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    members: asArray(raw.members)
      .map(mapUserSummary)
      .filter((member): member is RocketlaneUserSummary => member !== null),
    placeholders: asArray(raw.placeholders).map(mapTaskPlaceholder),
  }
}

function mapTaskFollowers(value: unknown): RocketlaneTaskFollowers | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    members: asArray(raw.members)
      .map(mapUserSummary)
      .filter((member): member is RocketlaneUserSummary => member !== null),
  }
}

function mapTaskLite(value: unknown): RocketlaneTaskLite {
  const raw = asObject(value) ?? {}
  return {
    taskId: asNumber(raw.taskId),
    taskName: asString(raw.taskName),
  }
}

function mapTaskField(value: unknown): RocketlaneTaskField {
  const raw = asObject(value) ?? {}
  return {
    fieldId: asNumber(raw.fieldId),
    fieldLabel: asString(raw.fieldLabel),
    fieldValue: raw.fieldValue ?? null,
    fieldValueLabel: asString(raw.fieldValueLabel),
  }
}

function mapTaskTimeEntryCategory(value: unknown): RocketlaneTaskTimeEntryCategory | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    categoryId: asNumber(raw.categoryId),
    categoryName: asString(raw.categoryName),
  }
}

function mapTaskBudget(value: unknown): RocketlaneTaskBudget {
  const raw = asObject(value) ?? {}
  return {
    budgetId: asNumber(raw.budgetId),
    budgetName: asString(raw.budgetName),
  }
}

export function mapTask(value: unknown): RocketlaneTask {
  const raw = asObject(value) ?? {}
  return {
    taskId: asNumber(raw.taskId),
    taskName: asString(raw.taskName),
    taskDescription: asString(raw.taskDescription),
    taskPrivateNote: asString(raw.taskPrivateNote),
    startDate: asString(raw.startDate),
    dueDate: asString(raw.dueDate),
    startDateActual: asString(raw.startDateActual),
    dueDateActual: asString(raw.dueDateActual),
    archived: asBoolean(raw.archived),
    effortInMinutes: asNumber(raw.effortInMinutes),
    progress: asNumber(raw.progress),
    atRisk: asBoolean(raw.atRisk),
    type: asString(raw.type),
    createdAt: asNumber(raw.createdAt),
    updatedAt: asNumber(raw.updatedAt),
    createdBy: mapUserSummary(raw.createdBy),
    updatedBy: mapUserSummary(raw.updatedBy),
    project: mapTaskProjectRef(raw.project),
    phase: mapTaskPhaseRef(raw.phase),
    status: mapTaskChoice(raw.status),
    priority: mapTaskChoice(raw.priority),
    fields: asArray(raw.fields).map(mapTaskField),
    assignees: mapTaskAssignees(raw.assignees),
    followers: mapTaskFollowers(raw.followers),
    dependencies: asArray(raw.dependencies).map(mapTaskLite),
    parent: asObject(raw.parent) ? mapTaskLite(raw.parent) : null,
    externalReferenceId: asString(raw.externalReferenceId),
    billable: asBoolean(raw.billable),
    timeEntryCategory: mapTaskTimeEntryCategory(raw.timeEntryCategory),
    financialsBudgets: asArray(raw.financialsBudgets).map(mapTaskBudget),
    csatEnabled: asBoolean(raw.csatEnabled),
    private: asBoolean(raw.private),
  }
}

/**
 * Builds the `members` array used by assignee/follower request bodies from
 * user IDs and/or email IDs. Each ID becomes its own member entry, so a user
 * referenced by both a user ID and an email produces two entries.
 */
export function buildTaskMembers(
  userIds?: number[],
  emailIds?: string[]
): Array<Record<string, unknown>> {
  const members: Array<Record<string, unknown>> = []
  for (const userId of userIds ?? []) {
    members.push({ userId })
  }
  for (const emailId of emailIds ?? []) {
    members.push({ emailId })
  }
  return members
}

const TASK_LITE_OUTPUT_PROPERTIES = {
  taskId: { type: 'number', description: 'Unique identifier of the task', nullable: true },
  taskName: { type: 'string', description: 'Name of the task', nullable: true },
} satisfies Record<string, OutputProperty>

const TASK_CHOICE_OUTPUT_PROPERTIES = {
  value: { type: 'number', description: 'Unique identifier of the choice', nullable: true },
  label: { type: 'string', description: 'Label of the choice', nullable: true },
} satisfies Record<string, OutputProperty>

export const TASK_OUTPUT_PROPERTIES = {
  taskId: { type: 'number', description: 'Unique identifier of the task', nullable: true },
  taskName: { type: 'string', description: 'Name of the task', nullable: true },
  taskDescription: {
    type: 'string',
    description: 'Description of the task in HTML format',
    nullable: true,
  },
  taskPrivateNote: {
    type: 'string',
    description: 'Private note visible only to team members, in HTML format',
    nullable: true,
  },
  startDate: {
    type: 'string',
    description: 'Date when the task starts (YYYY-MM-DD)',
    nullable: true,
  },
  dueDate: {
    type: 'string',
    description: 'Date when the task is due (YYYY-MM-DD)',
    nullable: true,
  },
  startDateActual: {
    type: 'string',
    description: 'Date the task status changed to In Progress (YYYY-MM-DD)',
    nullable: true,
  },
  dueDateActual: {
    type: 'string',
    description: 'Date the task status changed to Completed (YYYY-MM-DD)',
    nullable: true,
  },
  archived: { type: 'boolean', description: 'Whether the task is archived', nullable: true },
  effortInMinutes: {
    type: 'number',
    description: 'Expected effort to complete the task, in minutes',
    nullable: true,
  },
  progress: { type: 'number', description: 'Progress of the task (0-100)', nullable: true },
  atRisk: {
    type: 'boolean',
    description: 'Whether the task is marked as At Risk',
    nullable: true,
  },
  type: { type: 'string', description: 'Type of the task: TASK or MILESTONE', nullable: true },
  createdAt: {
    type: 'number',
    description: 'Time the task was created, in epoch millis',
    nullable: true,
  },
  updatedAt: {
    type: 'number',
    description: 'Time the task was last updated, in epoch millis',
    nullable: true,
  },
  createdBy: {
    type: 'object',
    description: 'User who created the task',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  updatedBy: {
    type: 'object',
    description: 'User who last updated the task',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  project: {
    type: 'object',
    description: 'Project associated with the task',
    nullable: true,
    properties: {
      projectId: {
        type: 'number',
        description: 'Unique identifier of the project',
        nullable: true,
      },
      projectName: { type: 'string', description: 'Name of the project', nullable: true },
    },
  },
  phase: {
    type: 'object',
    description: 'Phase associated with the task',
    nullable: true,
    properties: {
      phaseId: { type: 'number', description: 'Unique identifier of the phase', nullable: true },
      phaseName: { type: 'string', description: 'Name of the phase', nullable: true },
    },
  },
  status: {
    type: 'object',
    description: 'Status of the task (value and label)',
    nullable: true,
    properties: TASK_CHOICE_OUTPUT_PROPERTIES,
  },
  priority: {
    type: 'object',
    description: 'Priority of the task (value and label)',
    nullable: true,
    properties: TASK_CHOICE_OUTPUT_PROPERTIES,
  },
  fields: {
    type: 'array',
    description: 'Custom field values set on the task',
    items: {
      type: 'object',
      properties: {
        fieldId: { type: 'number', description: 'Unique identifier of the field', nullable: true },
        fieldLabel: { type: 'string', description: 'Label of the field', nullable: true },
        fieldValue: {
          type: 'json',
          description: 'Value of the field (string, number, or array)',
          nullable: true,
        },
        fieldValueLabel: {
          type: 'string',
          description: 'String representation of the field value',
          nullable: true,
        },
      },
    },
  },
  assignees: {
    type: 'object',
    description: 'Assignees of the task (members and placeholders)',
    nullable: true,
    properties: {
      members: {
        type: 'array',
        description: 'Team members and customers assigned to the task',
        items: { type: 'object', properties: USER_SUMMARY_OUTPUT_PROPERTIES },
      },
      placeholders: {
        type: 'array',
        description: 'Placeholders assigned to the task',
        items: {
          type: 'object',
          properties: {
            placeholderId: {
              type: 'number',
              description: 'Unique identifier of the placeholder',
              nullable: true,
            },
            placeholderName: {
              type: 'string',
              description: 'Name of the placeholder',
              nullable: true,
            },
            role: {
              type: 'object',
              description: 'Role associated with the placeholder',
              nullable: true,
              properties: {
                roleId: {
                  type: 'number',
                  description: 'Unique identifier of the role',
                  nullable: true,
                },
                roleName: { type: 'string', description: 'Name of the role', nullable: true },
              },
            },
          },
        },
      },
    },
  },
  followers: {
    type: 'object',
    description: 'Followers of the task',
    nullable: true,
    properties: {
      members: {
        type: 'array',
        description: 'Team members and customers following the task',
        items: { type: 'object', properties: USER_SUMMARY_OUTPUT_PROPERTIES },
      },
    },
  },
  dependencies: {
    type: 'array',
    description: 'Tasks this task depends on (finish-to-start dependencies)',
    items: { type: 'object', properties: TASK_LITE_OUTPUT_PROPERTIES },
  },
  parent: {
    type: 'object',
    description: 'Parent task of the task',
    nullable: true,
    properties: TASK_LITE_OUTPUT_PROPERTIES,
  },
  externalReferenceId: {
    type: 'string',
    description: 'External reference identifier linking the task to an external system',
    nullable: true,
  },
  billable: { type: 'boolean', description: 'Whether the task is billable', nullable: true },
  timeEntryCategory: {
    type: 'object',
    description: 'Category in which the task time entries are added',
    nullable: true,
    properties: {
      categoryId: {
        type: 'number',
        description: 'Unique identifier of the category',
        nullable: true,
      },
      categoryName: { type: 'string', description: 'Name of the category', nullable: true },
    },
  },
  financialsBudgets: {
    type: 'array',
    description: 'Financials budgets in which the task time entries are added',
    items: {
      type: 'object',
      properties: {
        budgetId: {
          type: 'number',
          description: 'Unique identifier of the budget',
          nullable: true,
        },
        budgetName: { type: 'string', description: 'Name of the budget', nullable: true },
      },
    },
  },
  csatEnabled: {
    type: 'boolean',
    description: 'Whether a CSAT survey is sent on completion (milestone tasks)',
    nullable: true,
  },
  private: { type: 'boolean', description: 'Whether the task is private', nullable: true },
} satisfies Record<string, OutputProperty>

export interface RocketlaneCreateTaskParams extends RocketlaneBaseParams {
  taskName: string
  projectId: number
  taskDescription?: string
  taskPrivateNote?: string
  startDate?: string
  dueDate?: string
  effortInMinutes?: number
  progress?: number
  atRisk?: boolean
  type?: string
  phaseId?: number
  statusValue?: number
  assigneeUserIds?: number[]
  assigneeEmailIds?: string[]
  followerUserIds?: number[]
  followerEmailIds?: string[]
  parentTaskId?: number
  externalReferenceId?: string
  private?: boolean
  includeFields?: string[]
  includeAllFields?: boolean
}

export interface RocketlaneGetTaskParams extends RocketlaneBaseParams {
  taskId: number
  includeFields?: string[]
  includeAllFields?: boolean
}

export interface RocketlaneUpdateTaskParams extends RocketlaneBaseParams {
  taskId: number
  taskName?: string
  taskDescription?: string
  taskPrivateNote?: string
  startDate?: string
  dueDate?: string
  effortInMinutes?: number
  progress?: number
  atRisk?: boolean
  type?: string
  statusValue?: number
  externalReferenceId?: string
  private?: boolean
  includeFields?: string[]
  includeAllFields?: boolean
}

export interface RocketlaneDeleteTaskParams extends RocketlaneBaseParams {
  taskId: number
}

export interface RocketlaneListTasksParams extends RocketlaneBaseParams {
  pageSize?: number
  pageToken?: string
  includeFields?: string[]
  includeAllFields?: boolean
  sortBy?: string
  sortOrder?: string
  match?: string
  projectId?: number
  phaseId?: number
  taskName?: string
  taskNameContains?: string
  taskStatus?: string
  startDateFrom?: string
  startDateTo?: string
  dueDateFrom?: string
  dueDateTo?: string
  includeArchive?: boolean
  externalReferenceId?: string
}

export interface RocketlaneTaskAssigneesParams extends RocketlaneBaseParams {
  taskId: number
  memberUserIds?: number[]
  memberEmailIds?: string[]
}

export interface RocketlaneTaskFollowersParams extends RocketlaneBaseParams {
  taskId: number
  memberUserIds?: number[]
  memberEmailIds?: string[]
}

export interface RocketlaneTaskDependenciesParams extends RocketlaneBaseParams {
  taskId: number
  dependencyTaskIds: number[]
}

export interface RocketlaneMoveTaskToPhaseParams extends RocketlaneBaseParams {
  taskId: number
  phaseId: number
}

export interface RocketlaneTaskResponse extends ToolResponse {
  output: {
    task: RocketlaneTask
  }
}

export interface RocketlaneTaskListResponse extends ToolResponse {
  output: {
    tasks: RocketlaneTask[]
    pagination: RocketlanePagination
  }
}

export interface RocketlaneTaskDeleteResponse extends ToolResponse {
  output: {
    deleted: boolean
    taskId: number | null
  }
}

// endregion

// region Projects

/** Company reference (customer or partner) returned on Rocketlane projects. */
export interface RocketlaneProjectCompany {
  companyId: number | null
  companyName: string | null
  companyUrl: string | null
}

export function mapProjectCompany(value: unknown): RocketlaneProjectCompany | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    companyId: asNumber(raw.companyId),
    companyName: asString(raw.companyName),
    companyUrl: asString(raw.companyUrl),
  }
}

export const PROJECT_COMPANY_OUTPUT_PROPERTIES = {
  companyId: { type: 'number', description: 'Unique identifier of the company', nullable: true },
  companyName: { type: 'string', description: 'Name of the company', nullable: true },
  companyUrl: { type: 'string', description: 'Website URL of the company', nullable: true },
} satisfies Record<string, OutputProperty>

/** Project status value/label pair. */
export interface RocketlaneProjectStatus {
  value: number | null
  label: string | null
}

export function mapProjectStatus(value: unknown): RocketlaneProjectStatus | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    value: asNumber(raw.value),
    label: asString(raw.label),
  }
}

export const PROJECT_STATUS_OUTPUT_PROPERTIES = {
  value: { type: 'number', description: 'Unique identifier of the status', nullable: true },
  label: { type: 'string', description: 'Name of the status', nullable: true },
} satisfies Record<string, OutputProperty>

/** Custom project field value returned on Rocketlane projects. */
export interface RocketlaneProjectField {
  fieldId: number | null
  fieldLabel: string | null
  fieldValue: string | null
  fieldValueLabel: string | null
}

export function mapProjectField(value: unknown): RocketlaneProjectField {
  const raw = asObject(value) ?? {}
  return {
    fieldId: asNumber(raw.fieldId),
    fieldLabel: asString(raw.fieldLabel),
    fieldValue: asString(raw.fieldValue),
    fieldValueLabel: asString(raw.fieldValueLabel),
  }
}

export const PROJECT_FIELD_OUTPUT_PROPERTIES = {
  fieldId: { type: 'number', description: 'Unique identifier of the custom field', nullable: true },
  fieldLabel: { type: 'string', description: 'Name of the custom project field', nullable: true },
  fieldValue: { type: 'string', description: 'Value assigned to the field', nullable: true },
  fieldValueLabel: {
    type: 'string',
    description: 'String representation of the field value',
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** In-progress phase reference returned on Rocketlane projects. */
export interface RocketlaneProjectPhase {
  phaseId: number | null
  phaseName: string | null
}

export function mapProjectPhase(value: unknown): RocketlaneProjectPhase {
  const raw = asObject(value) ?? {}
  return {
    phaseId: asNumber(raw.phaseId),
    phaseName: asString(raw.phaseName),
  }
}

export const PROJECT_PHASE_OUTPUT_PROPERTIES = {
  phaseId: { type: 'number', description: 'Unique identifier of the phase', nullable: true },
  phaseName: { type: 'string', description: 'Name of the phase', nullable: true },
} satisfies Record<string, OutputProperty>

/** Template source imported into a Rocketlane project. */
export interface RocketlaneProjectSource {
  prefix: string | null
  startDate: string | null
  templateId: number | null
  templateName: string | null
}

export function mapProjectSource(value: unknown): RocketlaneProjectSource {
  const raw = asObject(value) ?? {}
  return {
    prefix: asString(raw.prefix),
    startDate: asString(raw.startDate),
    templateId: asNumber(raw.templateId),
    templateName: asString(raw.templateName),
  }
}

export const PROJECT_SOURCE_OUTPUT_PROPERTIES = {
  prefix: {
    type: 'string',
    description: 'Prefix distinguishing which phase or task corresponds to which template',
    nullable: true,
  },
  startDate: {
    type: 'string',
    description: 'Date on which the template goes into effect (YYYY-MM-DD)',
    nullable: true,
  },
  templateId: { type: 'number', description: 'Unique identifier of the template', nullable: true },
  templateName: { type: 'string', description: 'Name of the template', nullable: true },
} satisfies Record<string, OutputProperty>

/** Project members, customers, and customer champion. */
export interface RocketlaneProjectTeamMembers {
  members: RocketlaneUserSummary[]
  customers: RocketlaneUserSummary[]
  customerChampion: RocketlaneUserSummary | null
}

export function mapProjectTeamMembers(value: unknown): RocketlaneProjectTeamMembers {
  const raw = asObject(value) ?? {}
  return {
    members: asArray(raw.members)
      .map(mapUserSummary)
      .filter((m): m is RocketlaneUserSummary => m !== null),
    customers: asArray(raw.customers)
      .map(mapUserSummary)
      .filter((m): m is RocketlaneUserSummary => m !== null),
    customerChampion: mapUserSummary(raw.customerChampion),
  }
}

export const PROJECT_TEAM_MEMBERS_OUTPUT_PROPERTIES = {
  members: {
    type: 'array',
    description: 'Team members working on the project',
    items: { type: 'object', properties: USER_SUMMARY_OUTPUT_PROPERTIES },
  },
  customers: {
    type: 'array',
    description: 'Customer stakeholders involved in the project',
    items: { type: 'object', properties: USER_SUMMARY_OUTPUT_PROPERTIES },
  },
  customerChampion: {
    type: 'object',
    description: 'Customer champion of the project',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, OutputProperty>

/**
 * Flattened project financials (contract type plus the per-contract-type fields
 * from fixedFeeContract, timeAndMaterialContract, and subscriptionContract).
 */
export interface RocketlaneProjectFinancials {
  contractType: string | null
  revenueRecognitionType: string | null
  fixedFee: number | null
  projectBudget: number | null
  rateCardId: number | null
  rateCardName: string | null
  subscriptionFrequency: string | null
  subscriptionStartDate: string | null
  periodMinutes: number | null
  periodBudget: number | null
  noOfPeriods: number | null
}

export function mapProjectFinancials(value: unknown): RocketlaneProjectFinancials | null {
  const raw = asObject(value)
  if (!raw) return null
  const fixedFeeContract = asObject(raw.fixedFeeContract) ?? {}
  const timeAndMaterialContract = asObject(raw.timeAndMaterialContract) ?? {}
  const rateCard = asObject(timeAndMaterialContract.rateCard) ?? {}
  const subscriptionContract = asObject(raw.subscriptionContract) ?? {}
  return {
    contractType: asString(raw.contractType),
    revenueRecognitionType: asString(raw.revenueRecognitionType),
    fixedFee: asNumber(fixedFeeContract.fixedFee),
    projectBudget: asNumber(timeAndMaterialContract.projectBudget),
    rateCardId: asNumber(rateCard.rateCardId),
    rateCardName: asString(rateCard.rateCardName),
    subscriptionFrequency: asString(subscriptionContract.subscriptionFrequency),
    subscriptionStartDate: asString(subscriptionContract.subscriptionStartDate),
    periodMinutes: asNumber(subscriptionContract.periodMinutes),
    periodBudget: asNumber(subscriptionContract.periodBudget),
    noOfPeriods: asNumber(subscriptionContract.noOfPeriods),
  }
}

export const PROJECT_FINANCIALS_OUTPUT_PROPERTIES = {
  contractType: {
    type: 'string',
    description:
      'Contract type for the project financials (FIXED_FEE, TIME_AND_MATERIAL, SUBSCRIPTION, or NON_BILLABLE)',
    nullable: true,
  },
  revenueRecognitionType: {
    type: 'string',
    description: 'Method used for revenue recognition',
    nullable: true,
  },
  fixedFee: {
    type: 'number',
    description: 'Project fee for Fixed fee contract type projects',
    nullable: true,
  },
  projectBudget: {
    type: 'number',
    description: 'Budget allocated for Time & Material contract type projects',
    nullable: true,
  },
  rateCardId: { type: 'number', description: 'Unique identifier of the rate card', nullable: true },
  rateCardName: { type: 'string', description: 'Name of the rate card', nullable: true },
  subscriptionFrequency: {
    type: 'string',
    description:
      'Interval at which the subscription renews (MONTHLY, QUARTERLY, HALF_YEARLY, YEARLY)',
    nullable: true,
  },
  subscriptionStartDate: {
    type: 'string',
    description: 'Date when the subscription interval begins (YYYY-MM-DD)',
    nullable: true,
  },
  periodMinutes: {
    type: 'number',
    description: 'Budgeted minutes for each subscription period',
    nullable: true,
  },
  periodBudget: {
    type: 'number',
    description: 'Fixed budget of every subscription period',
    nullable: true,
  },
  noOfPeriods: {
    type: 'number',
    description: 'Number of periods in the subscription',
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** A Rocketlane project as returned by the Projects endpoints. */
export interface RocketlaneProject {
  projectId: number | null
  projectName: string | null
  startDate: string | null
  dueDate: string | null
  createdAt: number | null
  updatedAt: number | null
  owner: RocketlaneUserSummary | null
  teamMembers: RocketlaneProjectTeamMembers
  status: RocketlaneProjectStatus | null
  fields: RocketlaneProjectField[]
  customer: RocketlaneProjectCompany | null
  partnerCompanies: RocketlaneProjectCompany[]
  archived: boolean | null
  visibility: string | null
  createdBy: RocketlaneUserSummary | null
  updatedBy: RocketlaneUserSummary | null
  currency: string | null
  financials: RocketlaneProjectFinancials | null
  startDateActual: string | null
  dueDateActual: string | null
  annualizedRecurringRevenue: number | null
  projectFee: number | null
  budgetedHours: number | null
  percentageBudgetedHoursConsumed: number | null
  percentageBudgetConsumed: number | null
  trackedHours: number | null
  trackedMinutes: number | null
  allocatedHours: number | null
  allocatedMinutes: number | null
  billableHours: number | null
  billableMinutes: number | null
  nonBillableHours: number | null
  nonBillableMinutes: number | null
  remainingHours: number | null
  remainingMinutes: number | null
  progressPercentage: number | null
  currentPhases: RocketlaneProjectPhase[]
  autoAllocation: boolean | null
  sources: RocketlaneProjectSource[]
  plannedDurationInDays: number | null
  inferredProgress: string | null
  projectAgeInDays: number | null
  customersInvited: number | null
  customersJoined: number | null
  externalReferenceId: string | null
}

export function mapProject(value: unknown): RocketlaneProject {
  const raw = asObject(value) ?? {}
  return {
    projectId: asNumber(raw.projectId),
    projectName: asString(raw.projectName),
    startDate: asString(raw.startDate),
    dueDate: asString(raw.dueDate),
    createdAt: asNumber(raw.createdAt),
    updatedAt: asNumber(raw.updatedAt),
    owner: mapUserSummary(raw.owner),
    teamMembers: mapProjectTeamMembers(raw.teamMembers),
    status: mapProjectStatus(raw.status),
    fields: asArray(raw.fields).map(mapProjectField),
    customer: mapProjectCompany(raw.customer),
    partnerCompanies: asArray(raw.partnerCompanies)
      .map(mapProjectCompany)
      .filter((c): c is RocketlaneProjectCompany => c !== null),
    archived: asBoolean(raw.archived),
    visibility: asString(raw.visibility),
    createdBy: mapUserSummary(raw.createdBy),
    updatedBy: mapUserSummary(raw.updatedBy),
    currency: asString(raw.currency),
    financials: mapProjectFinancials(raw.financials),
    startDateActual: asString(raw.startDateActual),
    dueDateActual: asString(raw.dueDateActual),
    annualizedRecurringRevenue: asNumber(raw.annualizedRecurringRevenue),
    projectFee: asNumber(raw.projectFee),
    budgetedHours: asNumber(raw.budgetedHours),
    percentageBudgetedHoursConsumed: asNumber(raw.percentageBudgetedHoursConsumed),
    percentageBudgetConsumed: asNumber(raw.percentageBudgetConsumed),
    trackedHours: asNumber(raw.trackedHours),
    trackedMinutes: asNumber(raw.trackedMinutes),
    allocatedHours: asNumber(raw.allocatedHours),
    allocatedMinutes: asNumber(raw.allocatedMinutes),
    billableHours: asNumber(raw.billableHours),
    billableMinutes: asNumber(raw.billableMinutes),
    nonBillableHours: asNumber(raw.nonBillableHours),
    nonBillableMinutes: asNumber(raw.nonBillableMinutes),
    remainingHours: asNumber(raw.remainingHours),
    remainingMinutes: asNumber(raw.remainingMinutes),
    progressPercentage: asNumber(raw.progressPercentage),
    currentPhases: asArray(raw.currentPhases).map(mapProjectPhase),
    autoAllocation: asBoolean(raw.autoAllocation),
    sources: asArray(raw.sources).map(mapProjectSource),
    plannedDurationInDays: asNumber(raw.plannedDurationInDays),
    inferredProgress: asString(raw.inferredProgress),
    projectAgeInDays: asNumber(raw.projectAgeInDays),
    customersInvited: asNumber(raw.customersInvited),
    customersJoined: asNumber(raw.customersJoined),
    externalReferenceId: asString(raw.externalReferenceId),
  }
}

export const PROJECT_OUTPUT_PROPERTIES = {
  projectId: { type: 'number', description: 'Unique identifier of the project', nullable: true },
  projectName: { type: 'string', description: 'Name of the project', nullable: true },
  startDate: {
    type: 'string',
    description: 'Date on which the project execution begins (YYYY-MM-DD)',
    nullable: true,
  },
  dueDate: {
    type: 'string',
    description: 'Date on which the project execution is planned to complete (YYYY-MM-DD)',
    nullable: true,
  },
  createdAt: {
    type: 'number',
    description: 'Time when the project was created (epoch millis)',
    nullable: true,
  },
  updatedAt: {
    type: 'number',
    description: 'Time when the project was last updated (epoch millis)',
    nullable: true,
  },
  owner: {
    type: 'object',
    description: 'Project owner',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  teamMembers: {
    type: 'object',
    description: 'Project members, customers, and customer champion',
    properties: PROJECT_TEAM_MEMBERS_OUTPUT_PROPERTIES,
  },
  status: {
    type: 'object',
    description: 'Project status value and label',
    nullable: true,
    properties: PROJECT_STATUS_OUTPUT_PROPERTIES,
  },
  fields: {
    type: 'array',
    description: 'Custom project field values',
    items: { type: 'object', properties: PROJECT_FIELD_OUTPUT_PROPERTIES },
  },
  customer: {
    type: 'object',
    description: 'Customer company of the project',
    nullable: true,
    properties: PROJECT_COMPANY_OUTPUT_PROPERTIES,
  },
  partnerCompanies: {
    type: 'array',
    description: 'Partner companies on the project',
    items: { type: 'object', properties: PROJECT_COMPANY_OUTPUT_PROPERTIES },
  },
  archived: { type: 'boolean', description: 'Whether the project is archived', nullable: true },
  visibility: {
    type: 'string',
    description: 'Project visibility (EVERYONE, MEMBERS, or GROUP)',
    nullable: true,
  },
  createdBy: {
    type: 'object',
    description: 'Team member who created the project',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  updatedBy: {
    type: 'object',
    description: 'Team member who last updated the project',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  currency: {
    type: 'string',
    description: 'Currency for the project financials (ISO code)',
    nullable: true,
  },
  financials: {
    type: 'object',
    description: 'Project financials (contract type and per-contract-type fields)',
    nullable: true,
    properties: PROJECT_FINANCIALS_OUTPUT_PROPERTIES,
  },
  startDateActual: {
    type: 'string',
    description: 'Date on which the project status changed to in progress (YYYY-MM-DD)',
    nullable: true,
  },
  dueDateActual: {
    type: 'string',
    description: 'Date on which the project status changed to completed (YYYY-MM-DD)',
    nullable: true,
  },
  annualizedRecurringRevenue: {
    type: 'number',
    description: 'Recurring revenue of the customer subscriptions for a single calendar year',
    nullable: true,
  },
  projectFee: {
    type: 'number',
    description: 'Total fee charged for the project',
    nullable: true,
  },
  budgetedHours: {
    type: 'number',
    description: 'Total hours allocated for project execution',
    nullable: true,
  },
  percentageBudgetedHoursConsumed: {
    type: 'number',
    description: 'Budgeted hours consumed percentage',
    nullable: true,
  },
  percentageBudgetConsumed: {
    type: 'number',
    description: 'Budget consumed percentage',
    nullable: true,
  },
  trackedHours: {
    type: 'number',
    description: 'Hours tracked as part of submitted time entries',
    nullable: true,
  },
  trackedMinutes: {
    type: 'number',
    description: 'Minutes tracked as part of submitted time entries',
    nullable: true,
  },
  allocatedHours: {
    type: 'number',
    description: 'Allocated hours against users or placeholders',
    nullable: true,
  },
  allocatedMinutes: {
    type: 'number',
    description: 'Allocated minutes against users or placeholders',
    nullable: true,
  },
  billableHours: {
    type: 'number',
    description: 'Hours of time entries tracked as billable',
    nullable: true,
  },
  billableMinutes: {
    type: 'number',
    description: 'Minutes of time entries tracked as billable',
    nullable: true,
  },
  nonBillableHours: {
    type: 'number',
    description: 'Hours of time entries tracked as non-billable',
    nullable: true,
  },
  nonBillableMinutes: {
    type: 'number',
    description: 'Minutes of time entries tracked as non-billable',
    nullable: true,
  },
  remainingHours: {
    type: 'number',
    description: 'Hours left to complete the project based on tracked and budgeted hours',
    nullable: true,
  },
  remainingMinutes: {
    type: 'number',
    description: 'Minutes left to complete the project (complements remainingHours)',
    nullable: true,
  },
  progressPercentage: {
    type: 'number',
    description: 'Progress based on completed tasks vs total tasks',
    nullable: true,
  },
  currentPhases: {
    type: 'array',
    description: 'Phases currently marked as in progress',
    items: { type: 'object', properties: PROJECT_PHASE_OUTPUT_PROPERTIES },
  },
  autoAllocation: {
    type: 'boolean',
    description: 'Whether auto allocation is enabled for the project',
    nullable: true,
  },
  sources: {
    type: 'array',
    description: 'Project templates imported into the project',
    items: { type: 'object', properties: PROJECT_SOURCE_OUTPUT_PROPERTIES },
  },
  plannedDurationInDays: {
    type: 'number',
    description: 'Difference between startDate and dueDate in days',
    nullable: true,
  },
  inferredProgress: {
    type: 'string',
    description: 'Inferred progress (ON_TRACK, AHEAD_OF_TIME, RUNNING_LATE, or NONE)',
    nullable: true,
  },
  projectAgeInDays: {
    type: 'number',
    description: 'Age of the project in days based on actual dates',
    nullable: true,
  },
  customersInvited: {
    type: 'number',
    description: 'Number of customers invited to the project',
    nullable: true,
  },
  customersJoined: {
    type: 'number',
    description: 'Number of customers who joined the project',
    nullable: true,
  },
  externalReferenceId: {
    type: 'string',
    description: 'Identifier linking the project to an external system',
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** A project placeholder as returned by the Get placeholders endpoint. */
export interface RocketlanePlaceholder {
  placeholderId: number | null
  placeholderName: string | null
  project: RocketlanePlaceholderProjectRef | null
  role: RocketlanePlaceholderRole | null
  placeholderType: string | null
  createdAt: number | null
  updatedAt: number | null
}

/** Project reference attached to a placeholder. */
export interface RocketlanePlaceholderProjectRef {
  projectId: number | null
  projectName: string | null
}

/** Role reference attached to a placeholder. */
export interface RocketlanePlaceholderRole {
  roleId: number | null
  roleName: string | null
}

export function mapPlaceholder(value: unknown): RocketlanePlaceholder {
  const raw = asObject(value) ?? {}
  const project = asObject(raw.project)
  const role = asObject(raw.role)
  return {
    placeholderId: asNumber(raw.placeholderId),
    placeholderName: asString(raw.placeholderName),
    project: project
      ? { projectId: asNumber(project.projectId), projectName: asString(project.projectName) }
      : null,
    role: role ? { roleId: asNumber(role.roleId), roleName: asString(role.roleName) } : null,
    placeholderType: asString(raw.placeholderType),
    createdAt: asNumber(raw.createdAt),
    updatedAt: asNumber(raw.updatedAt),
  }
}

export const PLACEHOLDER_OUTPUT_PROPERTIES = {
  placeholderId: {
    type: 'number',
    description: 'Unique identifier of the placeholder',
    nullable: true,
  },
  placeholderName: { type: 'string', description: 'Name of the placeholder', nullable: true },
  project: {
    type: 'object',
    description: 'Project of the placeholder',
    nullable: true,
    properties: {
      projectId: {
        type: 'number',
        description: 'Unique identifier of the project',
        nullable: true,
      },
      projectName: { type: 'string', description: 'Name of the project', nullable: true },
    },
  },
  role: {
    type: 'object',
    description: 'Role of the placeholder',
    nullable: true,
    properties: {
      roleId: { type: 'number', description: 'Unique identifier of the role', nullable: true },
      roleName: { type: 'string', description: 'Name of the role', nullable: true },
    },
  },
  placeholderType: {
    type: 'string',
    description: 'Type of the placeholder (NATIVE or EXTERNAL)',
    nullable: true,
  },
  createdAt: {
    type: 'number',
    description: 'Time when the placeholder was created (epoch millis)',
    nullable: true,
  },
  updatedAt: {
    type: 'number',
    description: 'Time when the placeholder was last updated (epoch millis)',
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** User assigned to a placeholder mapping (user summary plus role name). */
export interface RocketlanePlaceholderMappingUser {
  userId: number | null
  firstName: string | null
  lastName: string | null
  emailId: string | null
  role: string | null
}

/** Placeholder-to-user mapping returned by assign/unassign placeholder endpoints. */
export interface RocketlanePlaceholderMapping {
  placeholder: RocketlanePlaceholderRef | null
  placeholderStatus: string | null
  user: RocketlanePlaceholderMappingUser | null
  hourlyCostRate: number | null
  costRateCurrency: string | null
  hourlyBillRate: number | null
  billRateCurrency: string | null
}

/** Compact placeholder reference inside a placeholder mapping. */
export interface RocketlanePlaceholderRef {
  placeholderId: number | null
  placeholderName: string | null
}

export function mapPlaceholderMapping(value: unknown): RocketlanePlaceholderMapping {
  const raw = asObject(value) ?? {}
  const placeholder = asObject(raw.placeholder)
  const user = asObject(raw.user)
  return {
    placeholder: placeholder
      ? {
          placeholderId: asNumber(placeholder.placeholderId),
          placeholderName: asString(placeholder.placeholderName),
        }
      : null,
    placeholderStatus: asString(raw.placeholderStatus),
    user: user
      ? {
          userId: asNumber(user.userId),
          firstName: asString(user.firstName),
          lastName: asString(user.lastName),
          emailId: asString(user.emailId),
          role: asString(user.role),
        }
      : null,
    hourlyCostRate: asNumber(raw.hourlyCostRate),
    costRateCurrency: asString(raw.costRateCurrency),
    hourlyBillRate: asNumber(raw.hourlyBillRate),
    billRateCurrency: asString(raw.billRateCurrency),
  }
}

export const PLACEHOLDER_MAPPING_OUTPUT_PROPERTIES = {
  placeholder: {
    type: 'object',
    description: 'Placeholder being mapped',
    nullable: true,
    properties: {
      placeholderId: {
        type: 'number',
        description: 'Unique identifier of the placeholder',
        nullable: true,
      },
      placeholderName: { type: 'string', description: 'Name of the placeholder', nullable: true },
    },
  },
  placeholderStatus: {
    type: 'string',
    description: 'Status of the placeholder (ASSIGNED or UNASSIGNED)',
    nullable: true,
  },
  user: {
    type: 'object',
    description: 'User assigned to the placeholder',
    nullable: true,
    properties: {
      userId: { type: 'number', description: 'Unique identifier of the user', nullable: true },
      firstName: { type: 'string', description: 'First name of the user', nullable: true },
      lastName: { type: 'string', description: 'Last name of the user', nullable: true },
      emailId: { type: 'string', description: 'Email address of the user', nullable: true },
      role: { type: 'string', description: 'Role name of the assigned user', nullable: true },
    },
  },
  hourlyCostRate: {
    type: 'number',
    description: 'Latest hourly cost rate for the placeholder',
    nullable: true,
  },
  costRateCurrency: {
    type: 'string',
    description: 'Currency for the cost rate',
    nullable: true,
  },
  hourlyBillRate: {
    type: 'number',
    description: 'Latest hourly bill rate for the placeholder',
    nullable: true,
  },
  billRateCurrency: {
    type: 'string',
    description: 'Currency for the bill rate',
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Custom field assignment sent when creating or updating a project. */
export interface RocketlaneProjectFieldInput {
  fieldId: number
  fieldValue: string | number | number[]
}

/** Template source sent when creating a project. */
export interface RocketlaneProjectSourceInput {
  templateId: number
  startDate: string
  prefix?: string
}

/** Placeholder-to-user mapping sent when creating a project or assigning placeholders. */
export interface RocketlaneProjectPlaceholderInput {
  placeholderId: number
  user: {
    userId?: number
    emailId?: string
  }
}

export interface RocketlaneCreateProjectParams extends RocketlaneBaseParams {
  projectName: string
  customerCompanyName: string
  ownerUserId?: number
  ownerEmailId?: string
  startDate?: string
  dueDate?: string
  visibility?: string
  statusValue?: number
  memberUserIds?: number[]
  customerUserIds?: number[]
  customerChampionUserId?: number
  fields?: RocketlaneProjectFieldInput[]
  sources?: RocketlaneProjectSourceInput[]
  placeholders?: RocketlaneProjectPlaceholderInput[]
  assignProjectOwner?: boolean
  annualizedRecurringRevenue?: number
  projectFee?: number
  autoAllocation?: boolean
  autoCreateCompany?: boolean
  budgetedHours?: number
  contractType?: string
  fixedFee?: number
  projectBudget?: number
  rateCardId?: number
  subscriptionFrequency?: string
  subscriptionStartDate?: string
  periodMinutes?: number
  periodBudget?: number
  noOfPeriods?: number
  currency?: string
  externalReferenceId?: string
  includeFields?: string
  includeAllFields?: boolean
}

export interface RocketlaneGetProjectParams extends RocketlaneBaseParams {
  projectId: number
  includeFields?: string
  includeAllFields?: boolean
}

export interface RocketlaneUpdateProjectParams extends RocketlaneBaseParams {
  projectId: number
  projectName?: string
  startDate?: string
  dueDate?: string
  visibility?: string
  ownerUserId?: number
  ownerEmailId?: string
  statusValue?: number
  fields?: RocketlaneProjectFieldInput[]
  annualizedRecurringRevenue?: number
  projectFee?: number
  autoAllocation?: boolean
  budgetedHours?: number
  externalReferenceId?: string
  includeFields?: string
  includeAllFields?: boolean
}

export interface RocketlaneDeleteProjectParams extends RocketlaneBaseParams {
  projectId: number
}

export interface RocketlaneListProjectsParams extends RocketlaneBaseParams {
  pageSize?: number
  pageToken?: string
  includeFields?: string
  includeAllFields?: boolean
  sortBy?: string
  sortOrder?: string
  match?: string
  projectNameContains?: string
  projectNameEquals?: string
  statusEquals?: string
  statusOneOf?: string
  customerIdEquals?: string
  customerIdOneOf?: string
  teamMemberIdEquals?: string
  contractTypeEquals?: string
  includeArchived?: boolean
  externalReferenceIdEquals?: string
  startDateAfter?: string
  startDateBefore?: string
  dueDateAfter?: string
  dueDateBefore?: string
}

export interface RocketlaneArchiveProjectParams extends RocketlaneBaseParams {
  projectId: number
}

export interface RocketlaneAddProjectMembersParams extends RocketlaneBaseParams {
  projectId: number
  memberUserIds?: number[]
  memberEmailIds?: string[]
  customerUserIds?: number[]
  customerEmailIds?: string[]
}

export interface RocketlaneRemoveProjectMembersParams extends RocketlaneBaseParams {
  projectId: number
  memberUserIds?: number[]
  memberEmailIds?: string[]
}

export interface RocketlaneImportTemplateParams extends RocketlaneBaseParams {
  projectId: number
  templateId: number
  startDate: string
  prefix?: string
}

export interface RocketlaneAssignPlaceholdersParams extends RocketlaneBaseParams {
  projectId: number
  placeholderId: number
  userId?: number
  userEmailId?: string
}

export interface RocketlaneUnassignPlaceholdersParams extends RocketlaneBaseParams {
  projectId: number
  placeholderId: number
}

export interface RocketlaneListPlaceholdersParams extends RocketlaneBaseParams {
  projectId: number
}

export interface RocketlaneProjectResponse extends ToolResponse {
  output: {
    project: RocketlaneProject
  }
}

export interface RocketlaneProjectListResponse extends ToolResponse {
  output: {
    projects: RocketlaneProject[]
    pagination: RocketlanePagination
  }
}

export interface RocketlaneProjectDeleteResponse extends ToolResponse {
  output: {
    deleted: boolean
    projectId: number | null
  }
}

export interface RocketlaneProjectArchiveResponse extends ToolResponse {
  output: {
    archived: boolean
    projectId: number | null
  }
}

export interface RocketlaneProjectPlaceholdersResponse extends ToolResponse {
  output: {
    project: RocketlaneProject
    placeholders: RocketlanePlaceholderMapping[]
  }
}

export interface RocketlanePlaceholderListResponse extends ToolResponse {
  output: {
    placeholders: RocketlanePlaceholder[]
    pagination: RocketlanePagination
  }
}

// endregion

// region Fields

/** Choice option attached to a `SINGLE_CHOICE` or `MULTIPLE_CHOICE` field. */
export interface RocketlaneFieldOption {
  optionValue: number | null
  optionLabel: string | null
  optionColor: string | null
}

export function mapFieldOption(value: unknown): RocketlaneFieldOption {
  const raw = asObject(value) ?? {}
  return {
    optionValue: asNumber(raw.optionValue),
    optionLabel: asString(raw.optionLabel),
    optionColor: asString(raw.optionColor),
  }
}

export const FIELD_OPTION_OUTPUT_PROPERTIES = {
  optionValue: {
    type: 'number',
    description: 'Unique identifier of the option within the field',
    nullable: true,
  },
  optionLabel: { type: 'string', description: 'Display label of the option', nullable: true },
  optionColor: {
    type: 'string',
    description:
      'Color of the option (RED, YELLOW, GREEN, TEAL, CYAN, BLUE, PURPLE, MAGENTA, GRAY, COOL_GRAY)',
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

/** Custom field defined on a Rocketlane account. */
export interface RocketlaneField {
  fieldId: number | null
  fieldLabel: string | null
  fieldDescription: string | null
  fieldType: string | null
  objectType: string | null
  fieldOptions: RocketlaneFieldOption[]
  ratingScale: string | null
  createdBy: RocketlaneUserSummary | null
  updatedBy: RocketlaneUserSummary | null
  createdAt: number | null
  updatedAt: number | null
  enabled: boolean | null
  private: boolean | null
}

export function mapField(value: unknown): RocketlaneField {
  const raw = asObject(value) ?? {}
  return {
    fieldId: asNumber(raw.fieldId),
    fieldLabel: asString(raw.fieldLabel),
    fieldDescription: asString(raw.fieldDescription),
    fieldType: asString(raw.fieldType),
    objectType: asString(raw.objectType),
    fieldOptions: asArray(raw.fieldOptions).map(mapFieldOption),
    ratingScale: asString(raw.ratingScale),
    createdBy: mapUserSummary(raw.createdBy),
    updatedBy: mapUserSummary(raw.updatedBy),
    createdAt: asNumber(raw.createdAt),
    updatedAt: asNumber(raw.updatedAt),
    enabled: asBoolean(raw.enabled),
    private: asBoolean(raw.private),
  }
}

export const FIELD_OUTPUT_PROPERTIES = {
  fieldId: { type: 'number', description: 'Unique identifier of the field', nullable: true },
  fieldLabel: { type: 'string', description: 'Name of the field', nullable: true },
  fieldDescription: { type: 'string', description: 'Description of the field', nullable: true },
  fieldType: {
    type: 'string',
    description:
      'Type of the field (TEXT, MULTI_LINE_TEXT, YES_OR_NO, DATE, SINGLE_CHOICE, MULTIPLE_CHOICE, SINGLE_USER, MULTIPLE_USER, NUMBER, NOTE, RATING)',
    nullable: true,
  },
  objectType: {
    type: 'string',
    description: 'Object the field is associated with (PROJECT, TASK, or USER)',
    nullable: true,
  },
  fieldOptions: {
    type: 'array',
    description: 'Options available for SINGLE_CHOICE and MULTIPLE_CHOICE fields',
    items: { type: 'object', properties: FIELD_OPTION_OUTPUT_PROPERTIES },
  },
  ratingScale: {
    type: 'string',
    description: 'Rating scale for RATING fields (THREE, FIVE, SEVEN, TEN)',
    nullable: true,
  },
  createdBy: {
    type: 'object',
    description: 'Team member who created the field',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  updatedBy: {
    type: 'object',
    description: 'Team member who last updated the field',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  createdAt: {
    type: 'number',
    description: 'Time the field was created, in epoch milliseconds',
    nullable: true,
  },
  updatedAt: {
    type: 'number',
    description: 'Time the field was last updated, in epoch milliseconds',
    nullable: true,
  },
  enabled: { type: 'boolean', description: 'Whether the field is enabled', nullable: true },
  private: { type: 'boolean', description: 'Whether the field is private', nullable: true },
} satisfies Record<string, OutputProperty>

/** Option payload accepted when creating a field. */
export interface RocketlaneFieldOptionInput {
  optionLabel: string
  optionColor: string
}

export interface RocketlaneCreateFieldParams extends RocketlaneBaseParams {
  fieldLabel: string
  fieldType: string
  objectType: string
  fieldDescription?: string
  fieldOptions?: RocketlaneFieldOptionInput[]
  ratingScale?: string
  enabled?: boolean
  private?: boolean
  includeFields?: string
  includeAllFields?: boolean
}

export interface RocketlaneGetFieldParams extends RocketlaneBaseParams {
  fieldId: number
  includeFields?: string
  includeAllFields?: boolean
}

export interface RocketlaneUpdateFieldParams extends RocketlaneBaseParams {
  fieldId: number
  fieldLabel?: string
  fieldDescription?: string
  enabled?: boolean
  private?: boolean
  includeFields?: string
  includeAllFields?: boolean
}

export interface RocketlaneDeleteFieldParams extends RocketlaneBaseParams {
  fieldId: number
}

export interface RocketlaneListFieldsParams extends RocketlaneBaseParams {
  pageSize?: number
  pageToken?: string
  includeFields?: string
  includeAllFields?: boolean
  sortBy?: string
  sortOrder?: string
  match?: string
  objectType?: string
  fieldType?: string
  enabled?: boolean
  private?: boolean
}

export interface RocketlaneAddFieldOptionParams extends RocketlaneBaseParams {
  fieldId: number
  optionLabel: string
  optionColor: string
}

export interface RocketlaneUpdateFieldOptionParams extends RocketlaneBaseParams {
  fieldId: number
  optionValue: number
  optionLabel?: string
  optionColor?: string
}

export interface RocketlaneFieldResponse extends ToolResponse {
  output: {
    field: RocketlaneField
  }
}

export interface RocketlaneFieldListResponse extends ToolResponse {
  output: {
    fields: RocketlaneField[]
    pagination: RocketlanePagination
  }
}

export interface RocketlaneFieldDeleteResponse extends ToolResponse {
  output: {
    deleted: boolean
    fieldId: number | null
  }
}

export interface RocketlaneFieldOptionResponse extends ToolResponse {
  output: {
    option: RocketlaneFieldOption
  }
}

// endregion

// region Phases

/** Compact project reference returned inside a phase. */
export interface RocketlanePhaseProject {
  projectId: number | null
  projectName: string | null
}

/** Status of a phase, as a numeric value with a display label. */
export interface RocketlanePhaseStatus {
  value: number | null
  label: string | null
}

/** Phase of a Rocketlane project. */
export interface RocketlanePhase {
  phaseId: number | null
  phaseName: string | null
  project: RocketlanePhaseProject | null
  startDate: string | null
  dueDate: string | null
  startDateActual: string | null
  dueDateActual: string | null
  createdAt: number | null
  updatedAt: number | null
  createdBy: RocketlaneUserSummary | null
  updatedBy: RocketlaneUserSummary | null
  status: RocketlanePhaseStatus | null
  private: boolean | null
}

export function mapPhase(value: unknown): RocketlanePhase {
  const raw = asObject(value) ?? {}
  const project = asObject(raw.project)
  const status = asObject(raw.status)
  return {
    phaseId: asNumber(raw.phaseId),
    phaseName: asString(raw.phaseName),
    project: project
      ? { projectId: asNumber(project.projectId), projectName: asString(project.projectName) }
      : null,
    startDate: asString(raw.startDate),
    dueDate: asString(raw.dueDate),
    startDateActual: asString(raw.startDateActual),
    dueDateActual: asString(raw.dueDateActual),
    createdAt: asNumber(raw.createdAt),
    updatedAt: asNumber(raw.updatedAt),
    createdBy: mapUserSummary(raw.createdBy),
    updatedBy: mapUserSummary(raw.updatedBy),
    status: status ? { value: asNumber(status.value), label: asString(status.label) } : null,
    private: asBoolean(raw.private),
  }
}

export const PHASE_OUTPUT_PROPERTIES = {
  phaseId: { type: 'number', description: 'Unique identifier of the phase', nullable: true },
  phaseName: { type: 'string', description: 'Name of the phase', nullable: true },
  project: {
    type: 'object',
    description: 'Project the phase belongs to',
    nullable: true,
    properties: {
      projectId: {
        type: 'number',
        description: 'Unique identifier of the project',
        nullable: true,
      },
      projectName: { type: 'string', description: 'Name of the project', nullable: true },
    },
  },
  startDate: {
    type: 'string',
    description: 'Planned start date of the phase (YYYY-MM-DD)',
    nullable: true,
  },
  dueDate: {
    type: 'string',
    description: 'Planned due date of the phase (YYYY-MM-DD)',
    nullable: true,
  },
  startDateActual: {
    type: 'string',
    description: 'Actual start date of the phase (YYYY-MM-DD)',
    nullable: true,
  },
  dueDateActual: {
    type: 'string',
    description: 'Actual due date of the phase (YYYY-MM-DD)',
    nullable: true,
  },
  createdAt: {
    type: 'number',
    description: 'Time the phase was created, in epoch milliseconds',
    nullable: true,
  },
  updatedAt: {
    type: 'number',
    description: 'Time the phase was last updated, in epoch milliseconds',
    nullable: true,
  },
  createdBy: {
    type: 'object',
    description: 'Team member who created the phase',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  updatedBy: {
    type: 'object',
    description: 'Team member who last updated the phase',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  status: {
    type: 'object',
    description: 'Status of the phase',
    nullable: true,
    properties: {
      value: { type: 'number', description: 'Numeric status value', nullable: true },
      label: { type: 'string', description: 'Display label of the status', nullable: true },
    },
  },
  private: { type: 'boolean', description: 'Whether the phase is private', nullable: true },
} satisfies Record<string, OutputProperty>

export interface RocketlaneCreatePhaseParams extends RocketlaneBaseParams {
  phaseName: string
  projectId: number
  startDate: string
  dueDate: string
  statusValue?: number
  private?: boolean
  includeFields?: string
  includeAllFields?: boolean
}

export interface RocketlaneGetPhaseParams extends RocketlaneBaseParams {
  phaseId: number
  includeFields?: string
  includeAllFields?: boolean
}

export interface RocketlaneUpdatePhaseParams extends RocketlaneBaseParams {
  phaseId: number
  phaseName?: string
  startDate?: string
  dueDate?: string
  statusValue?: number
  private?: boolean
  includeFields?: string
  includeAllFields?: boolean
}

export interface RocketlaneDeletePhaseParams extends RocketlaneBaseParams {
  phaseId: number
}

export interface RocketlaneListPhasesParams extends RocketlaneBaseParams {
  projectId: number
  pageSize?: number
  pageToken?: string
  includeFields?: string
  includeAllFields?: boolean
  sortBy?: string
  sortOrder?: string
  match?: string
  phaseName?: string
}

export interface RocketlanePhaseResponse extends ToolResponse {
  output: {
    phase: RocketlanePhase
  }
}

export interface RocketlanePhaseListResponse extends ToolResponse {
  output: {
    phases: RocketlanePhase[]
    pagination: RocketlanePagination
  }
}

export interface RocketlanePhaseDeleteResponse extends ToolResponse {
  output: {
    deleted: boolean
    phaseId: number | null
  }
}

// endregion

// region Time Entries

/** Project reference embedded in a time entry. */
export interface RocketlaneTimeEntryProject {
  projectId: number | null
  projectName: string | null
}

/** Task reference embedded in a time entry. */
export interface RocketlaneTimeEntryTask {
  taskId: number | null
  taskName: string | null
}

/** Project phase reference embedded in a time entry. */
export interface RocketlaneTimeEntryPhase {
  phaseId: number | null
  phaseName: string | null
}

/** Category associated with a time entry. */
export interface RocketlaneTimeEntryCategory {
  categoryId: number | null
  categoryName: string | null
}

/** Hourly cost/bill rate attached to a time entry. */
export interface RocketlaneTimeEntryRate {
  rate: number | null
  currency: string | null
}

/** Custom field value attached to a time entry. */
export interface RocketlaneTimeEntryField {
  fieldId: number | null
  fieldLabel: string | null
  fieldValue: unknown
  fieldValueLabel: string | null
}

/** Normalized Rocketlane time entry returned by the Time Tracking endpoints. */
export interface RocketlaneTimeEntry {
  timeEntryId: number | null
  date: string | null
  minutes: number | null
  activityName: string | null
  project: RocketlaneTimeEntryProject | null
  task: RocketlaneTimeEntryTask | null
  projectPhase: RocketlaneTimeEntryPhase | null
  billable: boolean | null
  user: RocketlaneUserSummary | null
  notes: string | null
  category: RocketlaneTimeEntryCategory | null
  sourceType: string | null
  status: string | null
  createdAt: number | null
  updatedAt: number | null
  createdBy: RocketlaneUserSummary | null
  updatedBy: RocketlaneUserSummary | null
  submittedBy: RocketlaneUserSummary | null
  submittedAt: number | null
  approvedBy: RocketlaneUserSummary | null
  approvedAt: number | null
  rejectedBy: RocketlaneUserSummary | null
  rejectedAt: number | null
  deleted: boolean | null
  costRate: RocketlaneTimeEntryRate | null
  billRate: RocketlaneTimeEntryRate | null
  fields: RocketlaneTimeEntryField[]
}

function mapTimeEntryProject(value: unknown): RocketlaneTimeEntryProject | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    projectId: asNumber(raw.projectId),
    projectName: asString(raw.projectName),
  }
}

function mapTimeEntryTask(value: unknown): RocketlaneTimeEntryTask | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    taskId: asNumber(raw.taskId),
    taskName: asString(raw.taskName),
  }
}

function mapTimeEntryPhase(value: unknown): RocketlaneTimeEntryPhase | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    phaseId: asNumber(raw.phaseId),
    phaseName: asString(raw.phaseName),
  }
}

export function mapTimeEntryCategory(value: unknown): RocketlaneTimeEntryCategory | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    categoryId: asNumber(raw.categoryId),
    categoryName: asString(raw.categoryName),
  }
}

function mapTimeEntryRate(value: unknown): RocketlaneTimeEntryRate | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    rate: asNumber(raw.rate),
    currency: asString(raw.currency),
  }
}

function mapTimeEntryField(value: unknown): RocketlaneTimeEntryField {
  const raw = asObject(value) ?? {}
  return {
    fieldId: asNumber(raw.fieldId),
    fieldLabel: asString(raw.fieldLabel),
    fieldValue: raw.fieldValue ?? null,
    fieldValueLabel: asString(raw.fieldValueLabel),
  }
}

export function mapTimeEntry(value: unknown): RocketlaneTimeEntry {
  const raw = asObject(value) ?? {}
  return {
    timeEntryId: asNumber(raw.timeEntryId),
    date: asString(raw.date),
    minutes: asNumber(raw.minutes),
    activityName: asString(raw.activityName),
    project: mapTimeEntryProject(raw.project),
    task: mapTimeEntryTask(raw.task),
    projectPhase: mapTimeEntryPhase(raw.projectPhase),
    billable: asBoolean(raw.billable),
    user: mapUserSummary(raw.user),
    notes: asString(raw.notes),
    category: mapTimeEntryCategory(raw.category),
    sourceType: asString(raw.sourceType),
    status: asString(raw.status),
    createdAt: asNumber(raw.createdAt),
    updatedAt: asNumber(raw.updatedAt),
    createdBy: mapUserSummary(raw.createdBy),
    updatedBy: mapUserSummary(raw.updatedBy),
    submittedBy: mapUserSummary(raw.submittedBy),
    submittedAt: asNumber(raw.submittedAt),
    approvedBy: mapUserSummary(raw.approvedBy),
    approvedAt: asNumber(raw.approvedAt),
    rejectedBy: mapUserSummary(raw.rejectedBy),
    rejectedAt: asNumber(raw.rejectedAt),
    deleted: asBoolean(raw.deleted),
    costRate: mapTimeEntryRate(raw.costRate),
    billRate: mapTimeEntryRate(raw.billRate),
    fields: asArray(raw.fields).map(mapTimeEntryField),
  }
}

export const TIME_ENTRY_CATEGORY_OUTPUT_PROPERTIES = {
  categoryId: { type: 'number', description: 'Unique identifier of the category', nullable: true },
  categoryName: { type: 'string', description: 'Name of the category', nullable: true },
} satisfies Record<string, OutputProperty>

const TIME_ENTRY_RATE_OUTPUT_PROPERTIES = {
  rate: { type: 'number', description: 'Hourly monetary rate', nullable: true },
  currency: { type: 'string', description: 'Three-letter ISO currency code', nullable: true },
} satisfies Record<string, OutputProperty>

export const TIME_ENTRY_OUTPUT_PROPERTIES = {
  timeEntryId: {
    type: 'number',
    description: 'Unique identifier of the time entry',
    nullable: true,
  },
  date: {
    type: 'string',
    description: 'Date of the time entry (YYYY-MM-DD)',
    nullable: true,
  },
  minutes: {
    type: 'number',
    description: 'Duration of the time entry in minutes',
    nullable: true,
  },
  activityName: {
    type: 'string',
    description: 'Name of the adhoc activity, when the entry is tracked against an activity',
    nullable: true,
  },
  project: {
    type: 'object',
    description: 'Project associated with the time entry',
    nullable: true,
    properties: {
      projectId: {
        type: 'number',
        description: 'Unique identifier of the project',
        nullable: true,
      },
      projectName: { type: 'string', description: 'Name of the project', nullable: true },
    },
  },
  task: {
    type: 'object',
    description: 'Task associated with the time entry',
    nullable: true,
    properties: {
      taskId: { type: 'number', description: 'Unique identifier of the task', nullable: true },
      taskName: { type: 'string', description: 'Name of the task', nullable: true },
    },
  },
  projectPhase: {
    type: 'object',
    description: 'Project phase associated with the time entry',
    nullable: true,
    properties: {
      phaseId: { type: 'number', description: 'Unique identifier of the phase', nullable: true },
      phaseName: { type: 'string', description: 'Name of the phase', nullable: true },
    },
  },
  billable: {
    type: 'boolean',
    description: 'Whether the time entry is billable',
    nullable: true,
  },
  user: {
    type: 'object',
    description: 'User the time entry belongs to',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  notes: {
    type: 'string',
    description: 'Notes for the time entry',
    nullable: true,
  },
  category: {
    type: 'object',
    description: 'Category associated with the time entry',
    nullable: true,
    properties: TIME_ENTRY_CATEGORY_OUTPUT_PROPERTIES,
  },
  sourceType: {
    type: 'string',
    description:
      'Source of the time entry (GOOGLE_CALENDAR, OUTLOOK_CALENDAR, TASK, PROJECT, PHASE, ADHOC, MILESTONE)',
    nullable: true,
  },
  status: {
    type: 'string',
    description: 'Approval status of the time entry (NOT_SUBMITTED, SUBMITTED, APPROVED, REJECTED)',
    nullable: true,
  },
  createdAt: {
    type: 'number',
    description: 'Creation timestamp in epoch milliseconds',
    nullable: true,
  },
  updatedAt: {
    type: 'number',
    description: 'Last-updated timestamp in epoch milliseconds',
    nullable: true,
  },
  createdBy: {
    type: 'object',
    description: 'User who created the time entry',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  updatedBy: {
    type: 'object',
    description: 'User who last updated the time entry',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  submittedBy: {
    type: 'object',
    description:
      'User who submitted the time entry (may be null even for approved/rejected entries)',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  submittedAt: {
    type: 'number',
    description: 'Submission timestamp in epoch milliseconds',
    nullable: true,
  },
  approvedBy: {
    type: 'object',
    description: 'User who approved the time entry',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  approvedAt: {
    type: 'number',
    description: 'Approval timestamp in epoch milliseconds',
    nullable: true,
  },
  rejectedBy: {
    type: 'object',
    description: 'User who rejected the time entry',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  rejectedAt: {
    type: 'number',
    description: 'Rejection timestamp in epoch milliseconds',
    nullable: true,
  },
  deleted: {
    type: 'boolean',
    description: 'Whether the time entry is deleted',
    nullable: true,
  },
  costRate: {
    type: 'object',
    description: 'Hourly cost rate assigned to the user for this entry',
    nullable: true,
    properties: TIME_ENTRY_RATE_OUTPUT_PROPERTIES,
  },
  billRate: {
    type: 'object',
    description: 'Hourly rate billed to the customer for this entry',
    nullable: true,
    properties: TIME_ENTRY_RATE_OUTPUT_PROPERTIES,
  },
  fields: {
    type: 'array',
    description: 'Custom fields associated with the time entry',
    items: {
      type: 'object',
      properties: {
        fieldId: { type: 'number', description: 'Unique identifier of the field', nullable: true },
        fieldLabel: { type: 'string', description: 'Label of the field', nullable: true },
        fieldValue: { type: 'json', description: 'Value of the field', nullable: true },
        fieldValueLabel: {
          type: 'string',
          description: 'String representation of the field value',
          nullable: true,
        },
      },
    },
  },
} satisfies Record<string, OutputProperty>

/** Params for `rocketlane_create_time_entry`. */
export interface RocketlaneCreateTimeEntryParams extends RocketlaneBaseParams {
  date: string
  minutes: number
  activityName?: string
  taskId?: number
  projectPhaseId?: number
  projectId?: number
  billable?: boolean
  userId?: number
  userEmail?: string
  notes?: string
  categoryId?: number
  includeFields?: string
  includeAllFields?: boolean
}

/** Params for `rocketlane_get_time_entry`. */
export interface RocketlaneGetTimeEntryParams extends RocketlaneBaseParams {
  timeEntryId: number
  includeFields?: string
  includeAllFields?: boolean
}

/** Params for `rocketlane_update_time_entry`. */
export interface RocketlaneUpdateTimeEntryParams extends RocketlaneBaseParams {
  timeEntryId: number
  date: string
  minutes: number
  activityName?: string
  notes?: string
  billable?: boolean
  categoryId?: number
  includeFields?: string
  includeAllFields?: boolean
}

/** Params for `rocketlane_delete_time_entry`. */
export interface RocketlaneDeleteTimeEntryParams extends RocketlaneBaseParams {
  timeEntryId: number
}

/** Filter/sort/pagination params shared by the list and search time entry tools. */
export interface RocketlaneTimeEntryFilterParams extends RocketlaneBaseParams {
  sortBy?: string
  sortOrder?: string
  match?: string
  dateEq?: string
  dateGt?: string
  dateGe?: string
  dateLt?: string
  dateLe?: string
  projectPhaseIdEq?: number
  categoryIdEq?: number
  userIdEq?: number
  sourceTypeEq?: string
  activityNameEq?: string
  activityNameCn?: string
  approvalStatusEq?: string
  pageSize?: number
  pageToken?: string
}

/** Params for `rocketlane_list_time_entries`. */
export interface RocketlaneListTimeEntriesParams extends RocketlaneTimeEntryFilterParams {
  projectIdEq?: number
  taskIdEq?: number
  emailIdEq?: string
  emailIdCn?: string
  billableEq?: boolean
  includeDeletedEq?: boolean
  submittedByEq?: number
  approvedByEq?: number
  rejectedByEq?: number
  createdAtGt?: number
  createdAtLt?: number
  updatedAtGt?: number
  updatedAtLt?: number
  includeFields?: string
}

/** Params for `rocketlane_search_time_entries` (deprecated search endpoint). */
export interface RocketlaneSearchTimeEntriesParams extends RocketlaneTimeEntryFilterParams {
  projectEq?: number
  taskEq?: number
  includeFields?: string
  includeAllFields?: boolean
}

/** Params for `rocketlane_list_time_entry_categories`. */
export interface RocketlaneListTimeEntryCategoriesParams extends RocketlaneBaseParams {
  pageSize?: number
  pageToken?: string
}

/** Response carrying a single time entry. */
export interface RocketlaneTimeEntryResponse extends ToolResponse {
  output: {
    timeEntry: RocketlaneTimeEntry
  }
}

/** Response for the delete time entry tool. */
export interface RocketlaneDeleteTimeEntryResponse extends ToolResponse {
  output: {
    deleted: boolean
    timeEntryId: number | null
  }
}

/** Response carrying a paginated list of time entries. */
export interface RocketlaneTimeEntryListResponse extends ToolResponse {
  output: {
    timeEntries: RocketlaneTimeEntry[]
    pagination: RocketlanePagination
  }
}

/** Response carrying a paginated list of time entry categories. */
export interface RocketlaneTimeEntryCategoryListResponse extends ToolResponse {
  output: {
    categories: RocketlaneTimeEntryCategory[]
    pagination: RocketlanePagination
  }
}

// endregion

// region Spaces

/** The project a space belongs to. */
export interface RocketlaneSpaceProject {
  projectId: number | null
  projectName: string | null
}

/** A Rocketlane space. */
export interface RocketlaneSpace {
  spaceId: number | null
  spaceName: string | null
  project: RocketlaneSpaceProject | null
  createdAt: number | null
  createdBy: RocketlaneUserSummary | null
  updatedAt: number | null
  updatedBy: RocketlaneUserSummary | null
  private: boolean | null
}

export function mapSpace(value: unknown): RocketlaneSpace {
  const raw = asObject(value) ?? {}
  const project = asObject(raw.project)
  return {
    spaceId: asNumber(raw.spaceId),
    spaceName: asString(raw.spaceName),
    project: project
      ? {
          projectId: asNumber(project.projectId),
          projectName: asString(project.projectName),
        }
      : null,
    createdAt: asNumber(raw.createdAt),
    createdBy: mapUserSummary(raw.createdBy),
    updatedAt: asNumber(raw.updatedAt),
    updatedBy: mapUserSummary(raw.updatedBy),
    private: asBoolean(raw.private),
  }
}

export const SPACE_OUTPUT_PROPERTIES = {
  spaceId: { type: 'number', description: 'Unique identifier of the space', nullable: true },
  spaceName: { type: 'string', description: 'Name of the space', nullable: true },
  project: {
    type: 'object',
    description: 'Project the space belongs to',
    nullable: true,
    properties: {
      projectId: {
        type: 'number',
        description: 'Unique identifier of the project',
        nullable: true,
      },
      projectName: { type: 'string', description: 'Name of the project', nullable: true },
    },
  },
  createdAt: {
    type: 'number',
    description: 'Timestamp when the space was created (epoch millis)',
    nullable: true,
  },
  createdBy: {
    type: 'object',
    description: 'Team member who created the space',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  updatedAt: {
    type: 'number',
    description: 'Timestamp when the space was last updated (epoch millis)',
    nullable: true,
  },
  updatedBy: {
    type: 'object',
    description: 'Team member who last updated the space',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  private: {
    type: 'boolean',
    description: 'Whether the space is private or shared',
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export interface RocketlaneCreateSpaceParams extends RocketlaneBaseParams {
  projectId: number
  spaceName: string
  private?: boolean
}

export interface RocketlaneGetSpaceParams extends RocketlaneBaseParams {
  spaceId: number
}

export interface RocketlaneUpdateSpaceParams extends RocketlaneBaseParams {
  spaceId: number
  spaceName?: string
}

export interface RocketlaneDeleteSpaceParams extends RocketlaneBaseParams {
  spaceId: number
}

export interface RocketlaneListSpacesParams extends RocketlaneBaseParams {
  projectId: number
  pageSize?: number
  pageToken?: string
  sortBy?: string
  sortOrder?: string
  match?: string
  spaceNameEq?: string
  spaceNameCn?: string
  spaceNameNc?: string
  createdAtGt?: number
  createdAtEq?: number
  createdAtLt?: number
  createdAtGe?: number
  createdAtLe?: number
  updatedAtGt?: number
  updatedAtEq?: number
  updatedAtLt?: number
  updatedAtGe?: number
  updatedAtLe?: number
}

export interface RocketlaneSpaceResponse extends ToolResponse {
  output: {
    space: RocketlaneSpace
  }
}

export interface RocketlaneDeleteSpaceResponse extends ToolResponse {
  output: {
    deleted: boolean
    spaceId: number | null
  }
}

export interface RocketlaneListSpacesResponse extends ToolResponse {
  output: {
    spaces: RocketlaneSpace[]
    pagination: RocketlanePagination
  }
}

// endregion

// region Space Documents

/** The space a space document belongs to. */
export interface RocketlaneSpaceDocumentSpaceRef {
  spaceId: number | null
  spaceName: string | null
}

/** The document template a space document was created from. */
export interface RocketlaneSpaceDocumentSource {
  templateId: number | null
  templateName: string | null
}

/** A Rocketlane space document (space tab). */
export interface RocketlaneSpaceDocument {
  spaceDocumentId: number | null
  spaceDocumentName: string | null
  space: RocketlaneSpaceDocumentSpaceRef | null
  spaceDocumentType: string | null
  url: string | null
  source: RocketlaneSpaceDocumentSource | null
  createdAt: number | null
  createdBy: RocketlaneUserSummary | null
  updatedAt: number | null
  updatedBy: RocketlaneUserSummary | null
  private: boolean | null
}

export function mapSpaceDocument(value: unknown): RocketlaneSpaceDocument {
  const raw = asObject(value) ?? {}
  const space = asObject(raw.space)
  const source = asObject(raw.source)
  return {
    spaceDocumentId: asNumber(raw.spaceDocumentId),
    spaceDocumentName: asString(raw.spaceDocumentName),
    space: space
      ? {
          spaceId: asNumber(space.spaceId),
          spaceName: asString(space.spaceName),
        }
      : null,
    spaceDocumentType: asString(raw.spaceDocumentType),
    url: asString(raw.url),
    source: source
      ? {
          templateId: asNumber(source.templateId),
          templateName: asString(source.templateName),
        }
      : null,
    createdAt: asNumber(raw.createdAt),
    createdBy: mapUserSummary(raw.createdBy),
    updatedAt: asNumber(raw.updatedAt),
    updatedBy: mapUserSummary(raw.updatedBy),
    private: asBoolean(raw.private),
  }
}

export const SPACE_DOCUMENT_OUTPUT_PROPERTIES = {
  spaceDocumentId: {
    type: 'number',
    description: 'Unique identifier of the space document',
    nullable: true,
  },
  spaceDocumentName: {
    type: 'string',
    description: 'Name of the space document',
    nullable: true,
  },
  space: {
    type: 'object',
    description: 'Space the document belongs to',
    nullable: true,
    properties: {
      spaceId: { type: 'number', description: 'Unique identifier of the space', nullable: true },
      spaceName: { type: 'string', description: 'Name of the space', nullable: true },
    },
  },
  spaceDocumentType: {
    type: 'string',
    description: 'Type of the space document (ROCKETLANE_DOCUMENT or EMBEDDED_DOCUMENT)',
    nullable: true,
  },
  url: {
    type: 'string',
    description: 'URL embedded in the space document',
    nullable: true,
  },
  source: {
    type: 'object',
    description: 'Document template the space document was created from',
    nullable: true,
    properties: {
      templateId: {
        type: 'number',
        description: 'Unique identifier of the template',
        nullable: true,
      },
      templateName: { type: 'string', description: 'Name of the template', nullable: true },
    },
  },
  createdAt: {
    type: 'number',
    description: 'Timestamp when the space document was created (epoch millis)',
    nullable: true,
  },
  createdBy: {
    type: 'object',
    description: 'Team member who created the space document',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  updatedAt: {
    type: 'number',
    description: 'Timestamp when the space document was last updated (epoch millis)',
    nullable: true,
  },
  updatedBy: {
    type: 'object',
    description: 'Team member who last updated the space document',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  private: {
    type: 'boolean',
    description: 'Whether the space document is private or shared',
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export interface RocketlaneCreateSpaceDocumentParams extends RocketlaneBaseParams {
  spaceId: number
  spaceDocumentType: string
  spaceDocumentName?: string
  url?: string
  templateId?: number
}

export interface RocketlaneGetSpaceDocumentParams extends RocketlaneBaseParams {
  spaceDocumentId: number
}

export interface RocketlaneUpdateSpaceDocumentParams extends RocketlaneBaseParams {
  spaceDocumentId: number
  spaceDocumentName?: string
  url?: string
}

export interface RocketlaneDeleteSpaceDocumentParams extends RocketlaneBaseParams {
  spaceDocumentId: number
}

export interface RocketlaneListSpaceDocumentsParams extends RocketlaneBaseParams {
  projectId: number
  pageSize?: number
  pageToken?: string
  sortBy?: string
  sortOrder?: string
  match?: string
  spaceDocumentNameEq?: string
  spaceDocumentNameCn?: string
  spaceDocumentNameNc?: string
  spaceIdEq?: number
  createdAtGt?: number
  createdAtEq?: number
  createdAtLt?: number
  createdAtGe?: number
  createdAtLe?: number
  updatedAtGt?: number
  updatedAtEq?: number
  updatedAtLt?: number
  updatedAtGe?: number
  updatedAtLe?: number
}

export interface RocketlaneSpaceDocumentResponse extends ToolResponse {
  output: {
    spaceDocument: RocketlaneSpaceDocument
  }
}

export interface RocketlaneDeleteSpaceDocumentResponse extends ToolResponse {
  output: {
    deleted: boolean
    spaceDocumentId: number | null
  }
}

export interface RocketlaneListSpaceDocumentsResponse extends ToolResponse {
  output: {
    spaceDocuments: RocketlaneSpaceDocument[]
    pagination: RocketlanePagination
  }
}

// endregion

// region Users

/** The role assigned to a user. */
export interface RocketlaneUserRole {
  roleId: number | null
  roleName: string | null
}

/** The company a user belongs to. */
export interface RocketlaneUserCompany {
  companyId: number | null
  companyName: string | null
}

/** The permission level of a user. */
export interface RocketlaneUserPermission {
  permissionId: number | null
  permissionName: string | null
}

/** The holiday calendar assigned to a user. Field names use the API's `calender` spelling. */
export interface RocketlaneUserHolidayCalendar {
  calenderId: number | null
  calenderName: string | null
}

/** A custom user field value. */
export interface RocketlaneUserField {
  fieldId: number | null
  fieldLabel: string | null
  fieldValue: string | null
  fieldValueLabel: string | null
}

/** A full Rocketlane user (distinct from the compact RocketlaneUserSummary reference). */
export interface RocketlaneUser {
  userId: number | null
  email: string | null
  firstName: string | null
  lastName: string | null
  type: string | null
  status: string | null
  role: RocketlaneUserRole | null
  company: RocketlaneUserCompany | null
  permission: RocketlaneUserPermission | null
  fields: RocketlaneUserField[]
  capacityInMinutes: number | null
  holidayCalendar: RocketlaneUserHolidayCalendar | null
  profilePictureUrl: string | null
  createdAt: number | null
  createdBy: RocketlaneUserSummary | null
  updatedAt: number | null
  updatedBy: RocketlaneUserSummary | null
}

export function mapUser(value: unknown): RocketlaneUser {
  const raw = asObject(value) ?? {}
  const role = asObject(raw.role)
  const company = asObject(raw.company)
  const permission = asObject(raw.permission)
  const holidayCalendar = asObject(raw.holidayCalendar)
  return {
    userId: asNumber(raw.userId),
    email: asString(raw.email),
    firstName: asString(raw.firstName),
    lastName: asString(raw.lastName),
    type: asString(raw.type),
    status: asString(raw.status),
    role: role
      ? {
          roleId: asNumber(role.roleId),
          roleName: asString(role.roleName),
        }
      : null,
    company: company
      ? {
          companyId: asNumber(company.companyId),
          companyName: asString(company.companyName),
        }
      : null,
    permission: permission
      ? {
          permissionId: asNumber(permission.permissionId),
          permissionName: asString(permission.permissionName),
        }
      : null,
    fields: asArray(raw.fields).map((field) => {
      const fieldRaw = asObject(field) ?? {}
      return {
        fieldId: asNumber(fieldRaw.fieldId),
        fieldLabel: asString(fieldRaw.fieldLabel),
        fieldValue: asString(fieldRaw.fieldValue),
        fieldValueLabel: asString(fieldRaw.fieldValueLabel),
      }
    }),
    capacityInMinutes: asNumber(raw.capacityInMinutes),
    holidayCalendar: holidayCalendar
      ? {
          calenderId: asNumber(holidayCalendar.calenderId),
          calenderName: asString(holidayCalendar.calenderName),
        }
      : null,
    profilePictureUrl: asString(raw.profilePictureUrl),
    createdAt: asNumber(raw.createdAt),
    createdBy: mapUserSummary(raw.createdBy),
    updatedAt: asNumber(raw.updatedAt),
    updatedBy: mapUserSummary(raw.updatedBy),
  }
}

export const USER_OUTPUT_PROPERTIES = {
  userId: { type: 'number', description: 'Unique identifier of the user', nullable: true },
  email: { type: 'string', description: 'Email address of the user', nullable: true },
  firstName: { type: 'string', description: 'First name of the user', nullable: true },
  lastName: { type: 'string', description: 'Last name of the user', nullable: true },
  type: {
    type: 'string',
    description: 'Type of the user (TEAM_MEMBER, PARTNER, CUSTOMER, or EXTERNAL_PARTNER)',
    nullable: true,
  },
  status: {
    type: 'string',
    description: 'Status of the user (INACTIVE, INVITED, ACTIVE, or PASSIVE)',
    nullable: true,
  },
  role: {
    type: 'object',
    description: 'Role of the user',
    nullable: true,
    properties: {
      roleId: { type: 'number', description: 'Unique identifier of the role', nullable: true },
      roleName: { type: 'string', description: 'Name of the role', nullable: true },
    },
  },
  company: {
    type: 'object',
    description: 'Company of the user',
    nullable: true,
    properties: {
      companyId: {
        type: 'number',
        description: 'Unique identifier of the company',
        nullable: true,
      },
      companyName: { type: 'string', description: 'Name of the company', nullable: true },
    },
  },
  permission: {
    type: 'object',
    description: 'Permission of the user',
    nullable: true,
    properties: {
      permissionId: {
        type: 'number',
        description: 'Unique identifier of the permission',
        nullable: true,
      },
      permissionName: { type: 'string', description: 'Name of the permission', nullable: true },
    },
  },
  fields: {
    type: 'array',
    description: 'Custom user field values',
    items: {
      type: 'object',
      properties: {
        fieldId: { type: 'number', description: 'Unique identifier of the field', nullable: true },
        fieldLabel: {
          type: 'string',
          description: 'Name of the custom user field',
          nullable: true,
        },
        fieldValue: {
          type: 'string',
          description: 'Value of the custom user field',
          nullable: true,
        },
        fieldValueLabel: {
          type: 'string',
          description: 'String representation of the field value',
          nullable: true,
        },
      },
    },
  },
  capacityInMinutes: {
    type: 'number',
    description: 'Capacity of the user in minutes',
    nullable: true,
  },
  holidayCalendar: {
    type: 'object',
    description: 'Holiday calendar of the user',
    nullable: true,
    properties: {
      calenderId: {
        type: 'number',
        description: 'Unique identifier of the holiday calendar',
        nullable: true,
      },
      calenderName: {
        type: 'string',
        description: 'Name of the holiday calendar',
        nullable: true,
      },
    },
  },
  profilePictureUrl: {
    type: 'string',
    description: "URL of the user's profile picture",
    nullable: true,
  },
  createdAt: {
    type: 'number',
    description: 'Timestamp when the user was created (epoch millis)',
    nullable: true,
  },
  createdBy: {
    type: 'object',
    description: 'Team member who created the user',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  updatedAt: {
    type: 'number',
    description: 'Timestamp when the user was last updated (epoch millis)',
    nullable: true,
  },
  updatedBy: {
    type: 'object',
    description: 'Team member who last updated the user',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, OutputProperty>

export interface RocketlaneGetUserParams extends RocketlaneBaseParams {
  userId: number
  includeFields?: string
  includeAllFields?: boolean
}

export interface RocketlaneListUsersParams extends RocketlaneBaseParams {
  pageSize?: number
  pageToken?: string
  includeFields?: string
  includeAllFields?: boolean
  sortBy?: string
  sortOrder?: string
  match?: string
  firstNameEq?: string
  firstNameCn?: string
  firstNameNc?: string
  lastNameEq?: string
  lastNameCn?: string
  lastNameNc?: string
  emailEq?: string
  emailCn?: string
  emailNc?: string
  statusEq?: string
  statusOneOf?: string
  statusNoneOf?: string
  typeEq?: string
  typeOneOf?: string
  roleIdEq?: string
  roleIdOneOf?: string
  roleIdNoneOf?: string
  permissionIdEq?: string
  permissionIdOneOf?: string
  permissionIdNoneOf?: string
  capacityInMinutesEq?: number
  capacityInMinutesGt?: number
  capacityInMinutesGe?: number
  capacityInMinutesLt?: number
  capacityInMinutesLe?: number
  createdAtGt?: number
  createdAtEq?: number
  createdAtLt?: number
  createdAtGe?: number
  createdAtLe?: number
  updatedAtGt?: number
  updatedAtEq?: number
  updatedAtLt?: number
  updatedAtGe?: number
  updatedAtLe?: number
}

export interface RocketlaneUserResponse extends ToolResponse {
  output: {
    user: RocketlaneUser
  }
}

export interface RocketlaneListUsersResponse extends ToolResponse {
  output: {
    users: RocketlaneUser[]
    pagination: RocketlanePagination
  }
}

// endregion

// region Time-Offs

/** Params for creating a time-off. The API requires identifying the user by `userId` or `userEmail`. */
export interface RocketlaneTimeOffCreateParams extends RocketlaneBaseParams {
  userId?: number
  userEmail?: string
  startDate: string
  endDate: string
  type: string
  durationInMinutes?: number
  note?: string
  notifyProjectOwners?: boolean
  notifyUserIds?: number[]
  notifyUserEmails?: string[]
  includeFields?: string[]
  includeAllFields?: boolean
}

/** Params for fetching a single time-off by ID. */
export interface RocketlaneTimeOffGetParams extends RocketlaneBaseParams {
  timeOffId: number
  includeFields?: string[]
  includeAllFields?: boolean
}

/** Params for deleting a time-off by ID. */
export interface RocketlaneTimeOffDeleteParams extends RocketlaneBaseParams {
  timeOffId: number
}

/** Params for listing time-offs with filters, sorting, and pagination. */
export interface RocketlaneTimeOffListParams extends RocketlaneBaseParams {
  pageSize?: number
  pageToken?: string
  includeFields?: string[]
  includeAllFields?: boolean
  sortBy?: string
  sortOrder?: string
  match?: string
  startDateGt?: string
  startDateEq?: string
  startDateLt?: string
  startDateGe?: string
  startDateLe?: string
  endDateGt?: string
  endDateEq?: string
  endDateLt?: string
  endDateGe?: string
  endDateLe?: string
  typeEq?: string
  typeOneOf?: string
  typeNoneOf?: string
  userIdEq?: string
  userIdOneOf?: string
  userIdNoneOf?: string
  emailIdEq?: string
  emailIdOneOf?: string
  emailIdNoneOf?: string
}

/** The notify-users preferences attached to a time-off. */
export interface RocketlaneTimeOffNotifyUsers {
  projectOwners: boolean | null
  others: RocketlaneUserSummary[]
}

/** A Rocketlane time-off entry. */
export interface RocketlaneTimeOff {
  timeOffId: number | null
  user: RocketlaneUserSummary | null
  note: string | null
  startDate: string | null
  endDate: string | null
  durationInMinutes: number | null
  type: string | null
  notifyUsers: RocketlaneTimeOffNotifyUsers | null
  createdAt: number | null
  createdBy: RocketlaneUserSummary | null
}

function mapTimeOffNotifyUsers(value: unknown): RocketlaneTimeOffNotifyUsers | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    projectOwners: asBoolean(raw.projectOwners),
    others: asArray(raw.others)
      .map(mapUserSummary)
      .filter((user): user is RocketlaneUserSummary => user !== null),
  }
}

/**
 * Maps a raw time-off payload to the normalized {@link RocketlaneTimeOff} shape.
 */
export function mapTimeOff(value: unknown): RocketlaneTimeOff {
  const raw = asObject(value) ?? {}
  return {
    timeOffId: asNumber(raw.timeOffId),
    user: mapUserSummary(raw.user),
    note: asString(raw.note),
    startDate: asString(raw.startDate),
    endDate: asString(raw.endDate),
    durationInMinutes: asNumber(raw.durationInMinutes),
    type: asString(raw.type),
    notifyUsers: mapTimeOffNotifyUsers(raw.notifyUsers),
    createdAt: asNumber(raw.createdAt),
    createdBy: mapUserSummary(raw.createdBy),
  }
}

export const TIME_OFF_OUTPUT_PROPERTIES = {
  timeOffId: { type: 'number', description: 'Unique identifier of the time-off', nullable: true },
  user: {
    type: 'object',
    description: 'The team member the time-off belongs to',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  note: { type: 'string', description: 'Note or comment about the time-off', nullable: true },
  startDate: {
    type: 'string',
    description: 'Time-off start date (YYYY-MM-DD)',
    nullable: true,
  },
  endDate: { type: 'string', description: 'Time-off end date (YYYY-MM-DD)', nullable: true },
  durationInMinutes: {
    type: 'number',
    description: 'Duration in minutes per day for the time-off interval',
    nullable: true,
  },
  type: {
    type: 'string',
    description: 'Type of the time-off (FULL_DAY, HALF_DAY, or CUSTOM)',
    nullable: true,
  },
  notifyUsers: {
    type: 'object',
    description: 'Users notified about the time-off',
    nullable: true,
    properties: {
      projectOwners: {
        type: 'boolean',
        description: 'Whether project owners of projects the user is part of are notified',
        nullable: true,
      },
      others: {
        type: 'array',
        description: 'Other users notified about the time-off',
        items: { type: 'object', properties: USER_SUMMARY_OUTPUT_PROPERTIES },
      },
    },
  },
  createdAt: {
    type: 'number',
    description: 'Timestamp when the time-off was created (epoch milliseconds)',
    nullable: true,
  },
  createdBy: {
    type: 'object',
    description: 'The team member who created the time-off',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, OutputProperty>

/** Response containing a single time-off. */
export interface RocketlaneTimeOffResponse extends ToolResponse {
  output: {
    timeOff: RocketlaneTimeOff
  }
}

/** Response for a time-off deletion. */
export interface RocketlaneTimeOffDeleteResponse extends ToolResponse {
  output: {
    deleted: boolean
    timeOffId: number | null
  }
}

/** Response containing a page of time-offs. */
export interface RocketlaneTimeOffListResponse extends ToolResponse {
  output: {
    timeOffs: RocketlaneTimeOff[]
    pagination: RocketlanePagination
  }
}

// endregion

// region Resource Allocations

/** Params for listing resource allocations. `startDate` and `endDate` are required by the API. */
export interface RocketlaneResourceAllocationListParams extends RocketlaneBaseParams {
  startDate: string
  endDate: string
  pageSize?: number
  pageToken?: string
  includeFields?: string[]
  includeAllFields?: boolean
  sortBy?: string
  sortOrder?: string
  match?: string
  memberIdEq?: string
  memberIdOneOf?: string
  memberIdNoneOf?: string
  projectIdEq?: string
  projectIdOneOf?: string
  projectIdNoneOf?: string
  placeholderIdEq?: string
  placeholderIdOneOf?: string
  placeholderIdNoneOf?: string
}

/** A role attached to an allocation member or placeholder. */
export interface RocketlaneResourceAllocationRole {
  roleId: number | null
  roleName: string | null
}

/** The team member an allocation is made for, including their role. */
export interface RocketlaneResourceAllocationMember extends RocketlaneUserSummary {
  role: RocketlaneResourceAllocationRole | null
}

/** The placeholder an allocation is made for. */
export interface RocketlaneResourceAllocationPlaceholder {
  placeholderId: number | null
  placeholderName: string | null
  role: RocketlaneResourceAllocationRole | null
}

/** The project associated with an allocation. */
export interface RocketlaneResourceAllocationProject {
  projectId: number | null
  projectName: string | null
}

/** A task associated with an allocation. */
export interface RocketlaneResourceAllocationTask {
  taskId: number | null
  taskName: string | null
}

/** Total duration figures for an allocation between its start and end dates. */
export interface RocketlaneResourceAllocationDuration {
  daysConsider: number | null
  seconds: number | null
  minutes: number | null
  hours: number | null
}

/** A Rocketlane resource allocation. The API exposes no allocation identifier. */
export interface RocketlaneResourceAllocation {
  startDate: string | null
  endDate: string | null
  secondsPerDay: number | null
  minutesPerDay: number | null
  hoursPerDay: number | null
  duration: RocketlaneResourceAllocationDuration | null
  allocationType: string | null
  allocationFor: string | null
  project: RocketlaneResourceAllocationProject | null
  tasks: RocketlaneResourceAllocationTask[]
  member: RocketlaneResourceAllocationMember | null
  placeholder: RocketlaneResourceAllocationPlaceholder | null
  createdAt: number | null
  updatedAt: number | null
  createdBy: RocketlaneUserSummary | null
  updatedBy: RocketlaneUserSummary | null
}

function mapResourceAllocationRole(value: unknown): RocketlaneResourceAllocationRole | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    roleId: asNumber(raw.roleId),
    roleName: asString(raw.roleName),
  }
}

function mapResourceAllocationMember(value: unknown): RocketlaneResourceAllocationMember | null {
  const raw = asObject(value)
  if (!raw) return null
  const user = mapUserSummary(raw)
  if (!user) return null
  return {
    ...user,
    role: mapResourceAllocationRole(raw.role),
  }
}

function mapResourceAllocationPlaceholder(
  value: unknown
): RocketlaneResourceAllocationPlaceholder | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    placeholderId: asNumber(raw.placeholderId),
    placeholderName: asString(raw.placeholderName),
    role: mapResourceAllocationRole(raw.role),
  }
}

function mapResourceAllocationDuration(
  value: unknown
): RocketlaneResourceAllocationDuration | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    daysConsider: asNumber(raw.daysConsider),
    seconds: asNumber(raw.seconds),
    minutes: asNumber(raw.minutes),
    hours: asNumber(raw.hours),
  }
}

function mapResourceAllocationProject(value: unknown): RocketlaneResourceAllocationProject | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    projectId: asNumber(raw.projectId),
    projectName: asString(raw.projectName),
  }
}

function mapResourceAllocationTask(value: unknown): RocketlaneResourceAllocationTask {
  const raw = asObject(value) ?? {}
  return {
    taskId: asNumber(raw.taskId),
    taskName: asString(raw.taskName),
  }
}

/**
 * Maps a raw resource-allocation payload to the normalized
 * {@link RocketlaneResourceAllocation} shape.
 */
export function mapResourceAllocation(value: unknown): RocketlaneResourceAllocation {
  const raw = asObject(value) ?? {}
  return {
    startDate: asString(raw.startDate),
    endDate: asString(raw.endDate),
    secondsPerDay: asNumber(raw.secondsPerDay),
    minutesPerDay: asNumber(raw.minutesPerDay),
    hoursPerDay: asNumber(raw.hoursPerDay),
    duration: mapResourceAllocationDuration(raw.duration),
    allocationType: asString(raw.allocationType),
    allocationFor: asString(raw.allocationFor),
    project: mapResourceAllocationProject(raw.project),
    tasks: asArray(raw.tasks).map(mapResourceAllocationTask),
    member: mapResourceAllocationMember(raw.member),
    placeholder: mapResourceAllocationPlaceholder(raw.placeholder),
    createdAt: asNumber(raw.createdAt),
    updatedAt: asNumber(raw.updatedAt),
    createdBy: mapUserSummary(raw.createdBy),
    updatedBy: mapUserSummary(raw.updatedBy),
  }
}

const RESOURCE_ALLOCATION_ROLE_OUTPUT_PROPERTIES = {
  roleId: { type: 'number', description: 'Unique identifier of the role', nullable: true },
  roleName: { type: 'string', description: 'Name of the role', nullable: true },
} satisfies Record<string, OutputProperty>

export const RESOURCE_ALLOCATION_OUTPUT_PROPERTIES = {
  startDate: {
    type: 'string',
    description: 'Allocation start date (YYYY-MM-DD)',
    nullable: true,
  },
  endDate: { type: 'string', description: 'Allocation end date (YYYY-MM-DD)', nullable: true },
  secondsPerDay: { type: 'number', description: 'Allocated seconds per day', nullable: true },
  minutesPerDay: { type: 'number', description: 'Allocated minutes per day', nullable: true },
  hoursPerDay: { type: 'number', description: 'Allocated hours per day', nullable: true },
  duration: {
    type: 'object',
    description: 'Total allocation duration between the start and end dates',
    nullable: true,
    properties: {
      daysConsider: {
        type: 'number',
        description: 'Number of week days considered for the duration computation',
        nullable: true,
      },
      seconds: { type: 'number', description: 'Total allocation seconds', nullable: true },
      minutes: { type: 'number', description: 'Total allocation minutes', nullable: true },
      hours: { type: 'number', description: 'Total allocation hours', nullable: true },
    },
  },
  allocationType: {
    type: 'string',
    description: 'Type of allocation (SOFT or HARD)',
    nullable: true,
  },
  allocationFor: {
    type: 'string',
    description: 'Who the allocation is for (TEAM_MEMBER or PLACEHOLDER)',
    nullable: true,
  },
  project: {
    type: 'object',
    description: 'The project associated with the allocation',
    nullable: true,
    properties: {
      projectId: {
        type: 'number',
        description: 'Unique identifier of the project',
        nullable: true,
      },
      projectName: { type: 'string', description: 'Name of the project', nullable: true },
    },
  },
  tasks: {
    type: 'array',
    description: 'Tasks associated with the allocation',
    items: {
      type: 'object',
      properties: {
        taskId: { type: 'number', description: 'Unique identifier of the task', nullable: true },
        taskName: { type: 'string', description: 'Name of the task', nullable: true },
      },
    },
  },
  member: {
    type: 'object',
    description: 'The team member allocated when allocationFor is TEAM_MEMBER',
    nullable: true,
    properties: {
      ...USER_SUMMARY_OUTPUT_PROPERTIES,
      role: {
        type: 'object',
        description: 'Role of the member',
        nullable: true,
        properties: RESOURCE_ALLOCATION_ROLE_OUTPUT_PROPERTIES,
      },
    },
  },
  placeholder: {
    type: 'object',
    description: 'The placeholder allocated when allocationFor is PLACEHOLDER',
    nullable: true,
    properties: {
      placeholderId: {
        type: 'number',
        description: 'Unique identifier of the placeholder',
        nullable: true,
      },
      placeholderName: {
        type: 'string',
        description: 'Name of the placeholder',
        nullable: true,
      },
      role: {
        type: 'object',
        description: 'Role of the placeholder',
        nullable: true,
        properties: RESOURCE_ALLOCATION_ROLE_OUTPUT_PROPERTIES,
      },
    },
  },
  createdAt: {
    type: 'number',
    description: 'Timestamp when the allocation was created (epoch milliseconds)',
    nullable: true,
  },
  updatedAt: {
    type: 'number',
    description: 'Timestamp when the allocation was last updated (epoch milliseconds)',
    nullable: true,
  },
  createdBy: {
    type: 'object',
    description: 'The team member who created the allocation',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  updatedBy: {
    type: 'object',
    description: 'The team member who last updated the allocation',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
} satisfies Record<string, OutputProperty>

/** Response containing a page of resource allocations. */
export interface RocketlaneResourceAllocationListResponse extends ToolResponse {
  output: {
    allocations: RocketlaneResourceAllocation[]
    pagination: RocketlanePagination
  }
}

// endregion

// region Invoices

/** Params for fetching a single invoice by ID. */
export interface RocketlaneInvoiceGetParams extends RocketlaneBaseParams {
  invoiceId: number
  includeFields?: string[]
  includeAllFields?: boolean
}

/** Params for searching invoices with filters, sorting, and pagination. */
export interface RocketlaneInvoiceListParams extends RocketlaneBaseParams {
  pageSize?: number
  pageToken?: string
  includeFields?: string[]
  includeAllFields?: boolean
  sortBy?: string
  sortOrder?: string
  match?: string
  dateOfIssueEq?: string
  dateOfIssueGt?: string
  dateOfIssueGe?: string
  dateOfIssueLt?: string
  dateOfIssueLe?: string
  dueDateEq?: string
  dueDateGt?: string
  dueDateGe?: string
  dueDateLt?: string
  dueDateLe?: string
  amountEq?: number
  amountGt?: number
  amountGe?: number
  amountLt?: number
  amountLe?: number
  amountOutstandingEq?: number
  amountOutstandingGt?: number
  amountOutstandingGe?: number
  amountOutstandingLt?: number
  amountOutstandingLe?: number
  amountPaidEq?: number
  amountPaidGt?: number
  amountPaidGe?: number
  amountPaidLt?: number
  amountPaidLe?: number
  amountWrittenOffEq?: number
  amountWrittenOffGt?: number
  amountWrittenOffGe?: number
  amountWrittenOffLt?: number
  amountWrittenOffLe?: number
  createdAtEq?: number
  createdAtGt?: number
  createdAtGe?: number
  createdAtLt?: number
  createdAtLe?: number
  companyIdEq?: string
  companyIdOneOf?: string
  companyIdNoneOf?: string
  invoiceNumberEq?: string
  invoiceNumberCn?: string
  invoiceNumberNc?: string
  statusEq?: string
  statusOneOf?: string
  statusNoneOf?: string
}

/** Params for listing payments recorded against an invoice. */
export interface RocketlaneInvoicePaymentsParams extends RocketlaneBaseParams {
  invoiceId: number
  pageSize?: number
  pageToken?: string
}

/** Params for listing line items of an invoice. */
export interface RocketlaneInvoiceLineItemsParams extends RocketlaneBaseParams {
  invoiceId: number
  pageSize?: number
  pageToken?: string
}

/** Customer company details on an invoice. */
export interface RocketlaneInvoiceCompany {
  companyId: number | null
  companyName: string | null
  companyUrl: string | null
}

/** A project mapped to an invoice. */
export interface RocketlaneInvoiceProject {
  projectId: number | null
  projectName: string | null
}

/** A custom field value attached to an invoice. */
export interface RocketlaneInvoiceField {
  fieldId: number | null
  fieldLabel: string | null
  fieldValue: unknown
  fieldValueLabel: string | null
}

/** An attachment associated with an invoice. */
export interface RocketlaneInvoiceAttachment {
  attachmentId: number | null
  attachmentName: string | null
  createdAt: number | null
  location: string | null
  thumbLocation: string | null
  visibility: boolean | null
}

/** A Rocketlane invoice. */
export interface RocketlaneInvoice {
  invoiceId: number | null
  invoiceNumber: string | null
  dateOfIssue: string | null
  dueDate: string | null
  currency: string | null
  status: string | null
  amount: number | null
  tax: number | null
  subTotal: number | null
  amountOutstanding: number | null
  amountPaid: number | null
  amountWrittenOff: number | null
  notes: string | null
  createdAt: number | null
  updatedAt: number | null
  createdBy: RocketlaneUserSummary | null
  updatedBy: RocketlaneUserSummary | null
  company: RocketlaneInvoiceCompany | null
  projects: RocketlaneInvoiceProject[]
  fields: RocketlaneInvoiceField[]
  attachments: RocketlaneInvoiceAttachment[]
}

/** A payment recorded against an invoice. */
export interface RocketlaneInvoicePayment {
  paymentId: number | null
  paymentRecordType: string | null
  currency: string | null
  paymentDate: string | null
  amount: number | null
  notes: string | null
}

/** Tax code information for an invoice line item. */
export interface RocketlaneInvoiceLineItemTaxCode {
  taxCodeId: number | null
  taxCodeName: string | null
  taxCodeRate: number | null
  taxCodeAmount: number | null
}

/** A tax component that makes up a line item's tax code. */
export interface RocketlaneInvoiceLineItemTaxComponent {
  taxComponentId: number | null
  taxComponentName: string | null
  taxComponentRate: number | null
  taxComponentAmount: number | null
  taxComponentType: string | null
}

/** A line item on an invoice. */
export interface RocketlaneInvoiceLineItem {
  invoiceLineItemId: number | null
  description: string | null
  quantity: number | null
  unitPrice: number | null
  amount: number | null
  sourceId: number | null
  sourceType: string | null
  taxCode: RocketlaneInvoiceLineItemTaxCode | null
  taxComponents: RocketlaneInvoiceLineItemTaxComponent[]
}

function mapInvoiceCompany(value: unknown): RocketlaneInvoiceCompany | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    companyId: asNumber(raw.companyId),
    companyName: asString(raw.companyName),
    companyUrl: asString(raw.companyUrl),
  }
}

function mapInvoiceProject(value: unknown): RocketlaneInvoiceProject {
  const raw = asObject(value) ?? {}
  return {
    projectId: asNumber(raw.projectId),
    projectName: asString(raw.projectName),
  }
}

function mapInvoiceField(value: unknown): RocketlaneInvoiceField {
  const raw = asObject(value) ?? {}
  return {
    fieldId: asNumber(raw.fieldId),
    fieldLabel: asString(raw.fieldLabel),
    fieldValue: raw.fieldValue ?? null,
    fieldValueLabel: asString(raw.fieldValueLabel),
  }
}

function mapInvoiceAttachment(value: unknown): RocketlaneInvoiceAttachment {
  const raw = asObject(value) ?? {}
  return {
    attachmentId: asNumber(raw.attachmentId),
    attachmentName: asString(raw.attachmentName),
    createdAt: asNumber(raw.createdAt),
    location: asString(raw.location),
    thumbLocation: asString(raw.thumbLocation),
    visibility: asBoolean(raw.visibility),
  }
}

/**
 * Maps a raw invoice payload to the normalized {@link RocketlaneInvoice} shape.
 */
export function mapInvoice(value: unknown): RocketlaneInvoice {
  const raw = asObject(value) ?? {}
  return {
    invoiceId: asNumber(raw.invoiceId),
    invoiceNumber: asString(raw.invoiceNumber),
    dateOfIssue: asString(raw.dateOfIssue),
    dueDate: asString(raw.dueDate),
    currency: asString(raw.currency),
    status: asString(raw.status),
    amount: asNumber(raw.amount),
    tax: asNumber(raw.tax),
    subTotal: asNumber(raw.subTotal),
    amountOutstanding: asNumber(raw.amountOutstanding),
    amountPaid: asNumber(raw.amountPaid),
    amountWrittenOff: asNumber(raw.amountWrittenOff),
    notes: asString(raw.notes),
    createdAt: asNumber(raw.createdAt),
    updatedAt: asNumber(raw.updatedAt),
    createdBy: mapUserSummary(raw.createdBy),
    updatedBy: mapUserSummary(raw.updatedBy),
    company: mapInvoiceCompany(raw.company),
    projects: asArray(raw.projects).map(mapInvoiceProject),
    fields: asArray(raw.fields).map(mapInvoiceField),
    attachments: asArray(raw.attachments).map(mapInvoiceAttachment),
  }
}

/**
 * Maps a raw payment-record payload to the normalized {@link RocketlaneInvoicePayment} shape.
 */
export function mapInvoicePayment(value: unknown): RocketlaneInvoicePayment {
  const raw = asObject(value) ?? {}
  return {
    paymentId: asNumber(raw.paymentId),
    paymentRecordType: asString(raw.paymentRecordType),
    currency: asString(raw.currency),
    paymentDate: asString(raw.paymentDate),
    amount: asNumber(raw.amount),
    notes: asString(raw.notes),
  }
}

function mapInvoiceLineItemTaxCode(value: unknown): RocketlaneInvoiceLineItemTaxCode | null {
  const raw = asObject(value)
  if (!raw) return null
  return {
    taxCodeId: asNumber(raw.taxCodeId),
    taxCodeName: asString(raw.taxCodeName),
    taxCodeRate: asNumber(raw.taxCodeRate),
    taxCodeAmount: asNumber(raw.taxCodeAmount),
  }
}

function mapInvoiceLineItemTaxComponent(value: unknown): RocketlaneInvoiceLineItemTaxComponent {
  const raw = asObject(value) ?? {}
  return {
    taxComponentId: asNumber(raw.taxComponentId),
    taxComponentName: asString(raw.taxComponentName),
    taxComponentRate: asNumber(raw.taxComponentRate),
    taxComponentAmount: asNumber(raw.taxComponentAmount),
    taxComponentType: asString(raw.taxComponentType),
  }
}

/**
 * Maps a raw invoice line-item payload to the normalized {@link RocketlaneInvoiceLineItem} shape.
 */
export function mapInvoiceLineItem(value: unknown): RocketlaneInvoiceLineItem {
  const raw = asObject(value) ?? {}
  return {
    invoiceLineItemId: asNumber(raw.invoiceLineItemId),
    description: asString(raw.description),
    quantity: asNumber(raw.quantity),
    unitPrice: asNumber(raw.unitPrice),
    amount: asNumber(raw.amount),
    sourceId: asNumber(raw.sourceId),
    sourceType: asString(raw.sourceType),
    taxCode: mapInvoiceLineItemTaxCode(raw.taxCode),
    taxComponents: asArray(raw.taxComponents).map(mapInvoiceLineItemTaxComponent),
  }
}

export const INVOICE_OUTPUT_PROPERTIES = {
  invoiceId: { type: 'number', description: 'Unique identifier of the invoice', nullable: true },
  invoiceNumber: {
    type: 'string',
    description: 'Invoice number assigned to this invoice',
    nullable: true,
  },
  dateOfIssue: {
    type: 'string',
    description: 'Date when the invoice was issued (YYYY-MM-DD)',
    nullable: true,
  },
  dueDate: {
    type: 'string',
    description: 'Due date for the invoice payment (YYYY-MM-DD)',
    nullable: true,
  },
  currency: {
    type: 'string',
    description: 'Currency of the invoice amount (e.g. USD)',
    nullable: true,
  },
  status: { type: 'string', description: 'Current status of the invoice', nullable: true },
  amount: {
    type: 'number',
    description: 'Total amount of the invoice including tax',
    nullable: true,
  },
  tax: { type: 'number', description: 'Tax amount applied to the invoice', nullable: true },
  subTotal: {
    type: 'number',
    description: 'Total amount of the invoice excluding tax',
    nullable: true,
  },
  amountOutstanding: {
    type: 'number',
    description: 'Balance amount remaining to be paid',
    nullable: true,
  },
  amountPaid: {
    type: 'number',
    description: 'Total amount paid for this invoice',
    nullable: true,
  },
  amountWrittenOff: {
    type: 'number',
    description: 'Total amount written off for this invoice',
    nullable: true,
  },
  notes: {
    type: 'string',
    description: 'Notes or additional information about the invoice',
    nullable: true,
  },
  createdAt: {
    type: 'number',
    description: 'Timestamp when the invoice was created (epoch milliseconds)',
    nullable: true,
  },
  updatedAt: {
    type: 'number',
    description: 'Timestamp when the invoice was last updated (epoch milliseconds)',
    nullable: true,
  },
  createdBy: {
    type: 'object',
    description: 'The team member who created the invoice',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  updatedBy: {
    type: 'object',
    description: 'The team member who last updated the invoice',
    nullable: true,
    properties: USER_SUMMARY_OUTPUT_PROPERTIES,
  },
  company: {
    type: 'object',
    description: 'Customer company details for the invoice',
    nullable: true,
    properties: {
      companyId: {
        type: 'number',
        description: 'Unique identifier of the customer company',
        nullable: true,
      },
      companyName: {
        type: 'string',
        description: 'Name of the customer company',
        nullable: true,
      },
      companyUrl: {
        type: 'string',
        description: 'URL of the customer company website',
        nullable: true,
      },
    },
  },
  projects: {
    type: 'array',
    description: 'Projects mapped to this invoice',
    items: {
      type: 'object',
      properties: {
        projectId: {
          type: 'number',
          description: 'Unique identifier of the project',
          nullable: true,
        },
        projectName: { type: 'string', description: 'Name of the project', nullable: true },
      },
    },
  },
  fields: {
    type: 'array',
    description: 'Custom invoice fields with their values',
    items: {
      type: 'object',
      properties: {
        fieldId: {
          type: 'number',
          description: 'Unique identifier of the field',
          nullable: true,
        },
        fieldLabel: { type: 'string', description: 'Label of the field', nullable: true },
        fieldValue: {
          type: 'json',
          description: 'Value of the field (string, number, or array depending on field type)',
          nullable: true,
        },
        fieldValueLabel: {
          type: 'string',
          description: 'String representation of the field value',
          nullable: true,
        },
      },
    },
  },
  attachments: {
    type: 'array',
    description: 'Attachments associated with the invoice',
    items: {
      type: 'object',
      properties: {
        attachmentId: {
          type: 'number',
          description: 'Unique identifier of the attachment',
          nullable: true,
        },
        attachmentName: {
          type: 'string',
          description: 'Name of the attachment',
          nullable: true,
        },
        createdAt: {
          type: 'number',
          description: 'Timestamp when the attachment was created (epoch milliseconds)',
          nullable: true,
        },
        location: { type: 'string', description: 'URL of the attachment', nullable: true },
        thumbLocation: {
          type: 'string',
          description: 'Thumbnail URL of the attachment',
          nullable: true,
        },
        visibility: {
          type: 'boolean',
          description: 'Visibility of the attachment',
          nullable: true,
        },
      },
    },
  },
} satisfies Record<string, OutputProperty>

export const INVOICE_PAYMENT_OUTPUT_PROPERTIES = {
  paymentId: {
    type: 'number',
    description: 'Unique identifier of the payment record',
    nullable: true,
  },
  paymentRecordType: {
    type: 'string',
    description: 'Type of the payment record (PAID or WRITE_OFF)',
    nullable: true,
  },
  currency: {
    type: 'string',
    description: 'Currency of the payment amount (e.g. USD)',
    nullable: true,
  },
  paymentDate: {
    type: 'string',
    description: 'Date when the payment was made (YYYY-MM-DD)',
    nullable: true,
  },
  amount: { type: 'number', description: 'Amount of the payment', nullable: true },
  notes: {
    type: 'string',
    description: 'Additional notes or comments regarding the payment',
    nullable: true,
  },
} satisfies Record<string, OutputProperty>

export const INVOICE_LINE_ITEM_OUTPUT_PROPERTIES = {
  invoiceLineItemId: {
    type: 'number',
    description: 'Unique identifier of the invoice line item',
    nullable: true,
  },
  description: {
    type: 'string',
    description: 'Description of the line item or service provided',
    nullable: true,
  },
  quantity: { type: 'number', description: 'Quantity of the item or service', nullable: true },
  unitPrice: {
    type: 'number',
    description: 'Unit price for the item or service',
    nullable: true,
  },
  amount: {
    type: 'number',
    description: 'Total amount for this line item (quantity times unit price)',
    nullable: true,
  },
  sourceId: {
    type: 'number',
    description: 'Unique identifier of the source entity (e.g. project ID)',
    nullable: true,
  },
  sourceType: {
    type: 'string',
    description: 'Type of source entity this line item is associated with (e.g. PROJECT)',
    nullable: true,
  },
  taxCode: {
    type: 'object',
    description: 'Tax code information for this line item',
    nullable: true,
    properties: {
      taxCodeId: {
        type: 'number',
        description: 'Unique identifier of the tax code',
        nullable: true,
      },
      taxCodeName: { type: 'string', description: 'Name of the tax code', nullable: true },
      taxCodeRate: {
        type: 'number',
        description: 'Tax rate percentage for the tax code',
        nullable: true,
      },
      taxCodeAmount: {
        type: 'number',
        description: 'Tax amount calculated for this tax code',
        nullable: true,
      },
    },
  },
  taxComponents: {
    type: 'array',
    description: 'Tax components that make up the tax code',
    items: {
      type: 'object',
      properties: {
        taxComponentId: {
          type: 'number',
          description: 'Unique identifier of the tax component',
          nullable: true,
        },
        taxComponentName: {
          type: 'string',
          description: 'Name of the tax component',
          nullable: true,
        },
        taxComponentRate: {
          type: 'number',
          description: 'Tax rate percentage for the tax component',
          nullable: true,
        },
        taxComponentAmount: {
          type: 'number',
          description: 'Tax amount calculated for this tax component',
          nullable: true,
        },
        taxComponentType: {
          type: 'string',
          description: 'Type of the tax component (e.g. GST, VAT)',
          nullable: true,
        },
      },
    },
  },
} satisfies Record<string, OutputProperty>

/** Response containing a single invoice. */
export interface RocketlaneInvoiceResponse extends ToolResponse {
  output: {
    invoice: RocketlaneInvoice
  }
}

/** Response containing a page of invoices. */
export interface RocketlaneInvoiceListResponse extends ToolResponse {
  output: {
    invoices: RocketlaneInvoice[]
    pagination: RocketlanePagination
  }
}

/** Response containing a page of invoice payments. */
export interface RocketlaneInvoicePaymentListResponse extends ToolResponse {
  output: {
    payments: RocketlaneInvoicePayment[]
    pagination: RocketlanePagination
  }
}

/** Response containing a page of invoice line items. */
export interface RocketlaneInvoiceLineItemListResponse extends ToolResponse {
  output: {
    lineItems: RocketlaneInvoiceLineItem[]
    pagination: RocketlanePagination
  }
}

// endregion
