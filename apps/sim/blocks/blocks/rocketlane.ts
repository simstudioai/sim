import { RocketlaneIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'

const PROJECT_ID_REQUIRED_OPS = [
  'get_project',
  'update_project',
  'archive_project',
  'delete_project',
  'add_project_members',
  'remove_project_members',
  'import_template',
  'list_placeholders',
  'assign_placeholders',
  'unassign_placeholders',
  'create_task',
  'create_phase',
  'create_space',
  'list_phases',
  'list_spaces',
  'list_space_documents',
]
const PROJECT_ID_OPS = [...PROJECT_ID_REQUIRED_OPS, 'list_tasks']

const TASK_ID_OPS = [
  'get_task',
  'update_task',
  'delete_task',
  'move_task_to_phase',
  'add_task_assignees',
  'remove_task_assignees',
  'add_task_followers',
  'remove_task_followers',
  'add_task_dependencies',
  'remove_task_dependencies',
]

const PHASE_ID_REQUIRED_OPS = ['get_phase', 'update_phase', 'delete_phase', 'move_task_to_phase']
const PHASE_ID_OPS = [...PHASE_ID_REQUIRED_OPS, 'create_task', 'list_tasks']

const FIELD_ID_OPS = [
  'get_field',
  'update_field',
  'delete_field',
  'add_field_option',
  'update_field_option',
]

const SPACE_ID_OPS = ['get_space', 'update_space', 'delete_space', 'create_space_document']
const SPACE_DOCUMENT_ID_OPS = [
  'get_space_document',
  'update_space_document',
  'delete_space_document',
]
const TIME_ENTRY_ID_OPS = ['get_time_entry', 'update_time_entry', 'delete_time_entry']
const TIME_OFF_ID_OPS = ['get_time_off', 'delete_time_off']
const INVOICE_ID_OPS = ['get_invoice', 'get_invoice_line_items', 'get_invoice_payments']

const MEMBER_OPS = [
  'add_project_members',
  'remove_project_members',
  'add_task_assignees',
  'remove_task_assignees',
  'add_task_followers',
  'remove_task_followers',
]

const START_DATE_OPS = [
  'create_project',
  'update_project',
  'create_phase',
  'update_phase',
  'create_task',
  'update_task',
  'import_template',
  'create_time_off',
  'list_resource_allocations',
]
const START_DATE_REQUIRED_OPS = [
  'create_phase',
  'import_template',
  'create_time_off',
  'list_resource_allocations',
]

const DUE_DATE_OPS = [
  'create_project',
  'update_project',
  'create_phase',
  'update_phase',
  'create_task',
  'update_task',
]

const STATUS_VALUE_OPS = [
  'create_project',
  'update_project',
  'create_phase',
  'update_phase',
  'create_task',
  'update_task',
]

const PRIVATE_OPS = [
  'create_field',
  'update_field',
  'list_fields',
  'create_phase',
  'update_phase',
  'create_task',
  'update_task',
  'create_space',
]

const EXTERNAL_REFERENCE_OPS = [
  'create_project',
  'update_project',
  'create_task',
  'update_task',
  'list_tasks',
]

const PAGINATED_OPS = [
  'list_projects',
  'list_tasks',
  'list_phases',
  'list_fields',
  'list_invoices',
  'list_spaces',
  'list_space_documents',
  'list_time_entries',
  'search_time_entries',
  'list_time_entry_categories',
  'list_time_offs',
  'list_users',
  'list_resource_allocations',
  'get_invoice_line_items',
  'get_invoice_payments',
]

const SORT_MATCH_OPS = [
  'list_projects',
  'list_tasks',
  'list_phases',
  'list_fields',
  'list_invoices',
  'list_spaces',
  'list_space_documents',
  'list_time_entries',
  'search_time_entries',
  'list_time_offs',
  'list_users',
  'list_resource_allocations',
]

const INCLUDE_FIELDS_OPS = [
  'create_project',
  'get_project',
  'list_projects',
  'update_project',
  'create_task',
  'get_task',
  'list_tasks',
  'update_task',
  'create_phase',
  'get_phase',
  'list_phases',
  'update_phase',
  'create_field',
  'get_field',
  'list_fields',
  'update_field',
  'create_time_entry',
  'get_time_entry',
  'list_time_entries',
  'search_time_entries',
  'update_time_entry',
  'create_time_off',
  'get_time_off',
  'list_time_offs',
  'get_user',
  'list_users',
  'get_invoice',
  'list_invoices',
  'list_resource_allocations',
]
// list_time_entries supports includeFields but has no includeAllFields param.
const INCLUDE_ALL_FIELDS_OPS = INCLUDE_FIELDS_OPS.filter((op) => op !== 'list_time_entries')

const TIME_ENTRY_FILTER_OPS = ['list_time_entries', 'search_time_entries']
const CREATED_UPDATED_AT_OPS = ['list_time_entries', 'list_spaces', 'list_space_documents']

/** Coerces a short-input value to a number; empty and non-numeric values become undefined. */
function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Returns the trimmed string, or undefined for empty/non-string values. */
function toStr(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Normalizes switch values (booleans or 'true'/'false' strings) to booleans. */
function toBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

/** Splits a comma-separated string (or passes an array through) into trimmed strings. */
function toStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const parts = value.map((item) => String(item).trim()).filter((item) => item.length > 0)
    return parts.length > 0 ? parts : undefined
  }
  if (typeof value !== 'string') return undefined
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  return parts.length > 0 ? parts : undefined
}

/** Splits a comma-separated string (or array) into finite numbers. */
function toNumberList(value: unknown): number[] | undefined {
  const parts = toStringList(value)
  if (!parts) return undefined
  const numbers = parts.map((part) => Number(part)).filter((num) => Number.isFinite(num))
  return numbers.length > 0 ? numbers : undefined
}

/** Safely parses a JSON code input; objects/arrays pass through, invalid JSON becomes undefined. */
function toJson(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

type BlockParams = Record<string, any>

/** Shared pagination params for list operations. */
function pageParams(params: BlockParams) {
  return {
    pageSize: toNumber(params.pageSize),
    pageToken: toStr(params.pageToken),
  }
}

/** Shared sort/match params for filterable list operations. */
function sortParams(params: BlockParams) {
  return {
    sortBy: toStr(params.sortBy),
    sortOrder: toStr(params.sortOrder),
    match: toStr(params.match),
  }
}

/** includeFields/includeAllFields for tools that take includeFields as a CSV string. */
function includeCsv(params: BlockParams) {
  return {
    includeFields: toStr(params.includeFields),
    includeAllFields: toBool(params.includeAllFields),
  }
}

/** includeFields/includeAllFields for tools that take includeFields as a string array. */
function includeList(params: BlockParams) {
  return {
    includeFields: toStringList(params.includeFields),
    includeAllFields: toBool(params.includeAllFields),
  }
}

/** Builds the exact param set declared by the selected operation's tool. */
function buildOperationParams(params: BlockParams): Record<string, unknown> {
  switch (params.operation) {
    // Projects
    case 'create_project':
      return {
        projectName: toStr(params.projectName),
        customerCompanyName: toStr(params.customerCompanyName),
        ownerUserId: toNumber(params.ownerUserId),
        ownerEmailId: toStr(params.ownerEmailId),
        startDate: toStr(params.startDate),
        dueDate: toStr(params.dueDate),
        visibility: toStr(params.visibility),
        statusValue: toNumber(params.statusValue),
        memberUserIds: toNumberList(params.memberUserIds),
        customerUserIds: toNumberList(params.customerUserIds),
        customerChampionUserId: toNumber(params.customerChampionUserId),
        fields: toJson(params.fields),
        sources: toJson(params.sources),
        placeholders: toJson(params.placeholders),
        assignProjectOwner: toBool(params.assignProjectOwner),
        annualizedRecurringRevenue: toNumber(params.annualizedRecurringRevenue),
        projectFee: toNumber(params.projectFee),
        autoAllocation: toBool(params.autoAllocation),
        autoCreateCompany: toBool(params.autoCreateCompany),
        budgetedHours: toNumber(params.budgetedHours),
        contractType: toStr(params.contractType),
        fixedFee: toNumber(params.fixedFee),
        projectBudget: toNumber(params.projectBudget),
        rateCardId: toNumber(params.rateCardId),
        subscriptionFrequency: toStr(params.subscriptionFrequency),
        subscriptionStartDate: toStr(params.subscriptionStartDate),
        periodMinutes: toNumber(params.periodMinutes),
        periodBudget: toNumber(params.periodBudget),
        noOfPeriods: toNumber(params.noOfPeriods),
        currency: toStr(params.currency),
        externalReferenceId: toStr(params.externalReferenceId),
        ...includeCsv(params),
      }
    case 'get_project':
      return { projectId: toNumber(params.projectId), ...includeCsv(params) }
    case 'list_projects':
      return {
        ...pageParams(params),
        ...sortParams(params),
        ...includeCsv(params),
        projectNameContains: toStr(params.projectNameContains),
        projectNameEquals: toStr(params.projectNameEquals),
        statusEquals: toStr(params.statusEquals),
        statusOneOf: toStr(params.statusOneOf),
        customerIdEquals: toStr(params.customerIdEquals),
        customerIdOneOf: toStr(params.customerIdOneOf),
        teamMemberIdEquals: toStr(params.teamMemberIdEquals),
        contractTypeEquals: toStr(params.contractTypeEquals),
        includeArchived: toBool(params.includeArchived),
        externalReferenceIdEquals: toStr(params.externalReferenceIdEquals),
        startDateAfter: toStr(params.startDateAfter),
        startDateBefore: toStr(params.startDateBefore),
        dueDateAfter: toStr(params.dueDateAfter),
        dueDateBefore: toStr(params.dueDateBefore),
      }
    case 'update_project':
      return {
        projectId: toNumber(params.projectId),
        projectName: toStr(params.projectName),
        startDate: toStr(params.startDate),
        dueDate: toStr(params.dueDate),
        visibility: toStr(params.visibility),
        ownerUserId: toNumber(params.ownerUserId),
        ownerEmailId: toStr(params.ownerEmailId),
        statusValue: toNumber(params.statusValue),
        fields: toJson(params.fields),
        annualizedRecurringRevenue: toNumber(params.annualizedRecurringRevenue),
        projectFee: toNumber(params.projectFee),
        autoAllocation: toBool(params.autoAllocation),
        budgetedHours: toNumber(params.budgetedHours),
        externalReferenceId: toStr(params.externalReferenceId),
        ...includeCsv(params),
      }
    case 'archive_project':
    case 'delete_project':
      return { projectId: toNumber(params.projectId) }
    case 'add_project_members':
      return {
        projectId: toNumber(params.projectId),
        memberUserIds: toNumberList(params.memberUserIds),
        memberEmailIds: toStringList(params.memberEmailIds),
        customerUserIds: toNumberList(params.customerUserIds),
        customerEmailIds: toStringList(params.customerEmailIds),
      }
    case 'remove_project_members':
      return {
        projectId: toNumber(params.projectId),
        memberUserIds: toNumberList(params.memberUserIds),
        memberEmailIds: toStringList(params.memberEmailIds),
      }
    case 'import_template':
      return {
        projectId: toNumber(params.projectId),
        templateId: toNumber(params.templateId),
        startDate: toStr(params.startDate),
        prefix: toStr(params.prefix),
      }
    case 'list_placeholders':
      return { projectId: toNumber(params.projectId) }
    case 'assign_placeholders':
      return {
        projectId: toNumber(params.projectId),
        placeholderId: toNumber(params.placeholderId),
        userId: toNumber(params.userId),
        userEmailId: toStr(params.userEmail),
      }
    case 'unassign_placeholders':
      return {
        projectId: toNumber(params.projectId),
        placeholderId: toNumber(params.placeholderId),
      }

    // Tasks
    case 'create_task':
      return {
        taskName: toStr(params.taskName),
        projectId: toNumber(params.projectId),
        taskDescription: toStr(params.taskDescription),
        taskPrivateNote: toStr(params.taskPrivateNote),
        startDate: toStr(params.startDate),
        dueDate: toStr(params.dueDate),
        effortInMinutes: toNumber(params.effortInMinutes),
        progress: toNumber(params.progress),
        atRisk: toBool(params.atRisk),
        type: toStr(params.taskType),
        phaseId: toNumber(params.phaseId),
        statusValue: toNumber(params.statusValue),
        assigneeUserIds: toNumberList(params.assigneeUserIds),
        assigneeEmailIds: toStringList(params.assigneeEmailIds),
        followerUserIds: toNumberList(params.followerUserIds),
        followerEmailIds: toStringList(params.followerEmailIds),
        parentTaskId: toNumber(params.parentTaskId),
        externalReferenceId: toStr(params.externalReferenceId),
        private: toBool(params.private),
        ...includeList(params),
      }
    case 'get_task':
      return { taskId: toNumber(params.taskId), ...includeList(params) }
    case 'list_tasks':
      return {
        ...pageParams(params),
        ...sortParams(params),
        ...includeList(params),
        projectId: toNumber(params.projectId),
        phaseId: toNumber(params.phaseId),
        taskName: toStr(params.taskName),
        taskNameContains: toStr(params.taskNameContains),
        taskStatus: toStr(params.taskStatus),
        startDateFrom: toStr(params.startDateFrom),
        startDateTo: toStr(params.startDateTo),
        dueDateFrom: toStr(params.dueDateFrom),
        dueDateTo: toStr(params.dueDateTo),
        includeArchive: toBool(params.includeArchive),
        externalReferenceId: toStr(params.externalReferenceId),
      }
    case 'update_task':
      return {
        taskId: toNumber(params.taskId),
        taskName: toStr(params.taskName),
        taskDescription: toStr(params.taskDescription),
        taskPrivateNote: toStr(params.taskPrivateNote),
        startDate: toStr(params.startDate),
        dueDate: toStr(params.dueDate),
        effortInMinutes: toNumber(params.effortInMinutes),
        progress: toNumber(params.progress),
        atRisk: toBool(params.atRisk),
        type: toStr(params.taskType),
        statusValue: toNumber(params.statusValue),
        externalReferenceId: toStr(params.externalReferenceId),
        private: toBool(params.private),
        ...includeList(params),
      }
    case 'delete_task':
      return { taskId: toNumber(params.taskId) }
    case 'move_task_to_phase':
      return { taskId: toNumber(params.taskId), phaseId: toNumber(params.phaseId) }
    case 'add_task_assignees':
    case 'remove_task_assignees':
    case 'add_task_followers':
    case 'remove_task_followers':
      return {
        taskId: toNumber(params.taskId),
        memberUserIds: toNumberList(params.memberUserIds),
        memberEmailIds: toStringList(params.memberEmailIds),
      }
    case 'add_task_dependencies':
    case 'remove_task_dependencies':
      return {
        taskId: toNumber(params.taskId),
        dependencyTaskIds: toNumberList(params.dependencyTaskIds),
      }

    // Phases
    case 'create_phase':
      return {
        phaseName: toStr(params.phaseName),
        projectId: toNumber(params.projectId),
        startDate: toStr(params.startDate),
        dueDate: toStr(params.dueDate),
        statusValue: toNumber(params.statusValue),
        private: toBool(params.private),
        ...includeCsv(params),
      }
    case 'get_phase':
      return { phaseId: toNumber(params.phaseId), ...includeCsv(params) }
    case 'list_phases':
      return {
        projectId: toNumber(params.projectId),
        ...pageParams(params),
        ...sortParams(params),
        ...includeCsv(params),
        phaseName: toStr(params.phaseName),
      }
    case 'update_phase':
      return {
        phaseId: toNumber(params.phaseId),
        phaseName: toStr(params.phaseName),
        startDate: toStr(params.startDate),
        dueDate: toStr(params.dueDate),
        statusValue: toNumber(params.statusValue),
        private: toBool(params.private),
        ...includeCsv(params),
      }
    case 'delete_phase':
      return { phaseId: toNumber(params.phaseId) }

    // Fields
    case 'create_field':
      return {
        fieldLabel: toStr(params.fieldLabel),
        fieldType: toStr(params.fieldType),
        objectType: toStr(params.objectType),
        fieldDescription: toStr(params.fieldDescription),
        fieldOptions: toJson(params.fieldOptions),
        ratingScale: toStr(params.ratingScale),
        enabled: toBool(params.enabled),
        private: toBool(params.private),
        ...includeCsv(params),
      }
    case 'get_field':
      return { fieldId: toNumber(params.fieldId), ...includeCsv(params) }
    case 'list_fields':
      return {
        ...pageParams(params),
        ...sortParams(params),
        ...includeCsv(params),
        objectType: toStr(params.objectType),
        fieldType: toStr(params.fieldType),
        enabled: toBool(params.enabled),
        private: toBool(params.private),
      }
    case 'update_field':
      return {
        fieldId: toNumber(params.fieldId),
        fieldLabel: toStr(params.fieldLabel),
        fieldDescription: toStr(params.fieldDescription),
        enabled: toBool(params.enabled),
        private: toBool(params.private),
        ...includeCsv(params),
      }
    case 'delete_field':
      return { fieldId: toNumber(params.fieldId) }
    case 'add_field_option':
      return {
        fieldId: toNumber(params.fieldId),
        optionLabel: toStr(params.optionLabel),
        optionColor: toStr(params.optionColor),
      }
    case 'update_field_option':
      return {
        fieldId: toNumber(params.fieldId),
        optionValue: toNumber(params.optionValue),
        optionLabel: toStr(params.optionLabel),
        optionColor: toStr(params.optionColor),
      }

    // Time entries
    case 'create_time_entry': {
      const source = params.timeEntrySource ?? 'task'
      return {
        date: toStr(params.date),
        minutes: toNumber(params.minutes),
        // Exactly one time source may be sent — pass only the selected one.
        activityName: source === 'activity' ? toStr(params.timeEntryActivityName) : undefined,
        taskId: source === 'task' ? toNumber(params.timeEntryTaskId) : undefined,
        projectPhaseId: source === 'phase' ? toNumber(params.timeEntryPhaseId) : undefined,
        projectId: source === 'project' ? toNumber(params.timeEntryProjectId) : undefined,
        billable: toBool(params.billable),
        userId: toNumber(params.userId),
        userEmail: toStr(params.userEmail),
        notes: toStr(params.notes),
        categoryId: toNumber(params.categoryId),
        ...includeCsv(params),
      }
    }
    case 'get_time_entry':
      return { timeEntryId: toNumber(params.timeEntryId), ...includeCsv(params) }
    case 'list_time_entries':
      return {
        ...pageParams(params),
        ...sortParams(params),
        includeFields: toStr(params.includeFields),
        dateEq: toStr(params.dateEq),
        dateGe: toStr(params.dateGe),
        dateLe: toStr(params.dateLe),
        projectIdEq: toNumber(params.projectIdEq),
        taskIdEq: toNumber(params.taskIdEq),
        projectPhaseIdEq: toNumber(params.projectPhaseIdEq),
        categoryIdEq: toNumber(params.categoryIdEq),
        userIdEq: toNumber(params.userIdEq),
        emailIdEq: toStr(params.emailIdEq),
        emailIdCn: toStr(params.emailIdCn),
        sourceTypeEq: toStr(params.sourceTypeEq),
        activityNameEq: toStr(params.activityNameEq),
        activityNameCn: toStr(params.activityNameCn),
        approvalStatusEq: toStr(params.approvalStatusEq),
        billableEq: toBool(params.billableEq),
        includeDeletedEq: toBool(params.includeDeletedEq),
        createdAtGt: toNumber(params.createdAtGt),
        createdAtLt: toNumber(params.createdAtLt),
        updatedAtGt: toNumber(params.updatedAtGt),
        updatedAtLt: toNumber(params.updatedAtLt),
      }
    case 'search_time_entries':
      return {
        ...pageParams(params),
        ...sortParams(params),
        ...includeCsv(params),
        dateEq: toStr(params.dateEq),
        dateGe: toStr(params.dateGe),
        dateLe: toStr(params.dateLe),
        projectEq: toNumber(params.projectIdEq),
        taskEq: toNumber(params.taskIdEq),
        projectPhaseIdEq: toNumber(params.projectPhaseIdEq),
        categoryIdEq: toNumber(params.categoryIdEq),
        userIdEq: toNumber(params.userIdEq),
        sourceTypeEq: toStr(params.sourceTypeEq),
        activityNameEq: toStr(params.activityNameEq),
        activityNameCn: toStr(params.activityNameCn),
        approvalStatusEq: toStr(params.approvalStatusEq),
      }
    case 'update_time_entry':
      return {
        timeEntryId: toNumber(params.timeEntryId),
        date: toStr(params.date),
        minutes: toNumber(params.minutes),
        activityName: toStr(params.activityName),
        notes: toStr(params.notes),
        billable: toBool(params.billable),
        categoryId: toNumber(params.categoryId),
        ...includeCsv(params),
      }
    case 'delete_time_entry':
      return { timeEntryId: toNumber(params.timeEntryId) }
    case 'list_time_entry_categories':
      return pageParams(params)

    // Time-offs
    case 'create_time_off':
      return {
        userId: toNumber(params.userId),
        userEmail: toStr(params.userEmail),
        startDate: toStr(params.startDate),
        endDate: toStr(params.endDate),
        type: toStr(params.timeOffType),
        durationInMinutes: toNumber(params.durationInMinutes),
        note: toStr(params.note),
        notifyProjectOwners: toBool(params.notifyProjectOwners),
        notifyUserIds: toNumberList(params.notifyUserIds),
        notifyUserEmails: toStringList(params.notifyUserEmails),
        ...includeList(params),
      }
    case 'get_time_off':
      return { timeOffId: toNumber(params.timeOffId), ...includeList(params) }
    case 'list_time_offs':
      return {
        ...pageParams(params),
        ...sortParams(params),
        ...includeList(params),
        startDateGe: toStr(params.startDateGe),
        startDateLe: toStr(params.startDateLe),
        endDateGe: toStr(params.endDateGe),
        endDateLe: toStr(params.endDateLe),
        typeEq: toStr(params.timeOffTypeEq),
        userIdEq: toStr(params.userIdEq),
        emailIdEq: toStr(params.emailIdEq),
      }
    case 'delete_time_off':
      return { timeOffId: toNumber(params.timeOffId) }

    // Users
    case 'get_user':
      return { userId: toNumber(params.userId), ...includeCsv(params) }
    case 'list_users':
      return {
        ...pageParams(params),
        ...sortParams(params),
        ...includeCsv(params),
        firstNameCn: toStr(params.firstNameCn),
        lastNameCn: toStr(params.lastNameCn),
        emailEq: toStr(params.emailEq),
        emailCn: toStr(params.emailCn),
        statusEq: toStr(params.userStatusEq),
        typeEq: toStr(params.userTypeEq),
      }

    // Spaces
    case 'create_space':
      return {
        projectId: toNumber(params.projectId),
        spaceName: toStr(params.spaceName),
        private: toBool(params.private),
      }
    case 'get_space':
      return { spaceId: toNumber(params.spaceId) }
    case 'list_spaces':
      return {
        projectId: toNumber(params.projectId),
        ...pageParams(params),
        ...sortParams(params),
        spaceNameEq: toStr(params.spaceNameEq),
        spaceNameCn: toStr(params.spaceNameCn),
        createdAtGt: toNumber(params.createdAtGt),
        createdAtLt: toNumber(params.createdAtLt),
        updatedAtGt: toNumber(params.updatedAtGt),
        updatedAtLt: toNumber(params.updatedAtLt),
      }
    case 'update_space':
      return { spaceId: toNumber(params.spaceId), spaceName: toStr(params.spaceName) }
    case 'delete_space':
      return { spaceId: toNumber(params.spaceId) }

    // Space documents
    case 'create_space_document':
      return {
        spaceId: toNumber(params.spaceId),
        spaceDocumentType: toStr(params.spaceDocumentType),
        spaceDocumentName: toStr(params.spaceDocumentName),
        url: toStr(params.url),
        templateId: toNumber(params.documentTemplateId),
      }
    case 'get_space_document':
      return { spaceDocumentId: toNumber(params.spaceDocumentId) }
    case 'list_space_documents':
      return {
        projectId: toNumber(params.projectId),
        ...pageParams(params),
        ...sortParams(params),
        spaceDocumentNameEq: toStr(params.spaceDocumentNameEq),
        spaceDocumentNameCn: toStr(params.spaceDocumentNameCn),
        spaceIdEq: toNumber(params.spaceIdEq),
        createdAtGt: toNumber(params.createdAtGt),
        createdAtLt: toNumber(params.createdAtLt),
        updatedAtGt: toNumber(params.updatedAtGt),
        updatedAtLt: toNumber(params.updatedAtLt),
      }
    case 'update_space_document':
      return {
        spaceDocumentId: toNumber(params.spaceDocumentId),
        spaceDocumentName: toStr(params.spaceDocumentName),
        url: toStr(params.url),
      }
    case 'delete_space_document':
      return { spaceDocumentId: toNumber(params.spaceDocumentId) }

    // Resource allocations
    case 'list_resource_allocations':
      return {
        startDate: toStr(params.startDate),
        endDate: toStr(params.endDate),
        ...pageParams(params),
        ...sortParams(params),
        ...includeList(params),
        memberIdEq: toStr(params.memberIdEq),
        projectIdEq: toStr(params.projectIdEq),
        placeholderIdEq: toStr(params.placeholderIdEq),
      }

    // Invoices
    case 'get_invoice':
      return { invoiceId: toNumber(params.invoiceId), ...includeList(params) }
    case 'list_invoices':
      return {
        ...pageParams(params),
        ...sortParams(params),
        ...includeList(params),
        dateOfIssueGe: toStr(params.dateOfIssueGe),
        dateOfIssueLe: toStr(params.dateOfIssueLe),
        dueDateGe: toStr(params.dueDateGe),
        dueDateLe: toStr(params.dueDateLe),
        amountGe: toNumber(params.amountGe),
        amountLe: toNumber(params.amountLe),
        amountOutstandingGt: toNumber(params.amountOutstandingGt),
        invoiceNumberEq: toStr(params.invoiceNumberEq),
        invoiceNumberCn: toStr(params.invoiceNumberCn),
        statusEq: toStr(params.invoiceStatusEq),
        statusOneOf: toStr(params.invoiceStatusOneOf),
        companyIdEq: toStr(params.companyIdEq),
        companyIdOneOf: toStr(params.companyIdOneOf),
      }
    case 'get_invoice_line_items':
    case 'get_invoice_payments':
      return { invoiceId: toNumber(params.invoiceId), ...pageParams(params) }

    default:
      return {}
  }
}

export const RocketlaneBlock: BlockConfig = {
  type: 'rocketlane',
  name: 'Rocketlane',
  description: 'Manage client onboarding projects, tasks, time tracking, and invoices',
  longDescription:
    'Integrate Rocketlane into your workflow. Rocketlane is a professional-services automation platform for client onboarding and project delivery. Create and manage projects, tasks, phases, custom fields, time entries, time-offs, spaces, documents, resource allocations, and invoices.',
  docsLink: 'https://docs.sim.ai/integrations/rocketlane',
  category: 'tools',
  integrationType: IntegrationType.Productivity,
  bgColor: '#000000',
  icon: RocketlaneIcon,
  authMode: AuthMode.ApiKey,

  subBlocks: [
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        // Projects
        { label: 'Create Project', id: 'create_project' },
        { label: 'Get Project', id: 'get_project' },
        { label: 'List Projects', id: 'list_projects' },
        { label: 'Update Project', id: 'update_project' },
        { label: 'Archive Project', id: 'archive_project' },
        { label: 'Delete Project', id: 'delete_project' },
        { label: 'Add Project Members', id: 'add_project_members' },
        { label: 'Remove Project Members', id: 'remove_project_members' },
        { label: 'Import Template', id: 'import_template' },
        { label: 'List Placeholders', id: 'list_placeholders' },
        { label: 'Assign Placeholder', id: 'assign_placeholders' },
        { label: 'Unassign Placeholder', id: 'unassign_placeholders' },
        // Tasks
        { label: 'Create Task', id: 'create_task' },
        { label: 'Get Task', id: 'get_task' },
        { label: 'List Tasks', id: 'list_tasks' },
        { label: 'Update Task', id: 'update_task' },
        { label: 'Delete Task', id: 'delete_task' },
        { label: 'Move Task to Phase', id: 'move_task_to_phase' },
        { label: 'Add Task Assignees', id: 'add_task_assignees' },
        { label: 'Remove Task Assignees', id: 'remove_task_assignees' },
        { label: 'Add Task Followers', id: 'add_task_followers' },
        { label: 'Remove Task Followers', id: 'remove_task_followers' },
        { label: 'Add Task Dependencies', id: 'add_task_dependencies' },
        { label: 'Remove Task Dependencies', id: 'remove_task_dependencies' },
        // Phases
        { label: 'Create Phase', id: 'create_phase' },
        { label: 'Get Phase', id: 'get_phase' },
        { label: 'List Phases', id: 'list_phases' },
        { label: 'Update Phase', id: 'update_phase' },
        { label: 'Delete Phase', id: 'delete_phase' },
        // Fields
        { label: 'Create Field', id: 'create_field' },
        { label: 'Get Field', id: 'get_field' },
        { label: 'List Fields', id: 'list_fields' },
        { label: 'Update Field', id: 'update_field' },
        { label: 'Delete Field', id: 'delete_field' },
        { label: 'Add Field Option', id: 'add_field_option' },
        { label: 'Update Field Option', id: 'update_field_option' },
        // Time entries
        { label: 'Create Time Entry', id: 'create_time_entry' },
        { label: 'Get Time Entry', id: 'get_time_entry' },
        { label: 'List Time Entries', id: 'list_time_entries' },
        { label: 'Search Time Entries', id: 'search_time_entries' },
        { label: 'Update Time Entry', id: 'update_time_entry' },
        { label: 'Delete Time Entry', id: 'delete_time_entry' },
        { label: 'List Time Entry Categories', id: 'list_time_entry_categories' },
        // Time-offs
        { label: 'Create Time-Off', id: 'create_time_off' },
        { label: 'Get Time-Off', id: 'get_time_off' },
        { label: 'List Time-Offs', id: 'list_time_offs' },
        { label: 'Delete Time-Off', id: 'delete_time_off' },
        // Users
        { label: 'Get User', id: 'get_user' },
        { label: 'List Users', id: 'list_users' },
        // Spaces
        { label: 'Create Space', id: 'create_space' },
        { label: 'Get Space', id: 'get_space' },
        { label: 'List Spaces', id: 'list_spaces' },
        { label: 'Update Space', id: 'update_space' },
        { label: 'Delete Space', id: 'delete_space' },
        // Space documents
        { label: 'Create Space Document', id: 'create_space_document' },
        { label: 'Get Space Document', id: 'get_space_document' },
        { label: 'List Space Documents', id: 'list_space_documents' },
        { label: 'Update Space Document', id: 'update_space_document' },
        { label: 'Delete Space Document', id: 'delete_space_document' },
        // Resource allocations
        { label: 'List Resource Allocations', id: 'list_resource_allocations' },
        // Invoices
        { label: 'Get Invoice', id: 'get_invoice' },
        { label: 'List Invoices', id: 'list_invoices' },
        { label: 'Get Invoice Line Items', id: 'get_invoice_line_items' },
        { label: 'Get Invoice Payments', id: 'get_invoice_payments' },
      ],
      value: () => 'list_projects',
    },

    // Shared identifiers
    {
      id: 'projectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'e.g. 101',
      condition: { field: 'operation', value: PROJECT_ID_OPS },
      required: { field: 'operation', value: PROJECT_ID_REQUIRED_OPS },
    },
    {
      id: 'taskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'e.g. 5001',
      condition: { field: 'operation', value: TASK_ID_OPS },
      required: { field: 'operation', value: TASK_ID_OPS },
    },
    {
      id: 'phaseId',
      title: 'Phase ID',
      type: 'short-input',
      placeholder: 'e.g. 301',
      condition: { field: 'operation', value: PHASE_ID_OPS },
      required: { field: 'operation', value: PHASE_ID_REQUIRED_OPS },
    },
    {
      id: 'fieldId',
      title: 'Field ID',
      type: 'short-input',
      placeholder: 'e.g. 41',
      condition: { field: 'operation', value: FIELD_ID_OPS },
      required: { field: 'operation', value: FIELD_ID_OPS },
    },
    {
      id: 'spaceId',
      title: 'Space ID',
      type: 'short-input',
      placeholder: 'e.g. 21',
      condition: { field: 'operation', value: SPACE_ID_OPS },
      required: { field: 'operation', value: SPACE_ID_OPS },
    },
    {
      id: 'spaceDocumentId',
      title: 'Space Document ID',
      type: 'short-input',
      placeholder: 'e.g. 11',
      condition: { field: 'operation', value: SPACE_DOCUMENT_ID_OPS },
      required: { field: 'operation', value: SPACE_DOCUMENT_ID_OPS },
    },
    {
      id: 'timeEntryId',
      title: 'Time Entry ID',
      type: 'short-input',
      placeholder: 'e.g. 9001',
      condition: { field: 'operation', value: TIME_ENTRY_ID_OPS },
      required: { field: 'operation', value: TIME_ENTRY_ID_OPS },
    },
    {
      id: 'timeOffId',
      title: 'Time-Off ID',
      type: 'short-input',
      placeholder: 'e.g. 71',
      condition: { field: 'operation', value: TIME_OFF_ID_OPS },
      required: { field: 'operation', value: TIME_OFF_ID_OPS },
    },
    {
      id: 'invoiceId',
      title: 'Invoice ID',
      type: 'short-input',
      placeholder: 'e.g. 61',
      condition: { field: 'operation', value: INVOICE_ID_OPS },
      required: { field: 'operation', value: INVOICE_ID_OPS },
    },
    {
      id: 'placeholderId',
      title: 'Placeholder ID',
      type: 'short-input',
      placeholder: 'e.g. 12',
      condition: { field: 'operation', value: ['assign_placeholders', 'unassign_placeholders'] },
      required: { field: 'operation', value: ['assign_placeholders', 'unassign_placeholders'] },
    },
    {
      id: 'userId',
      title: 'User ID',
      type: 'short-input',
      placeholder: 'e.g. 1001',
      condition: {
        field: 'operation',
        value: ['get_user', 'assign_placeholders', 'create_time_entry', 'create_time_off'],
      },
      required: { field: 'operation', value: 'get_user' },
    },
    {
      id: 'userEmail',
      title: 'User Email',
      type: 'short-input',
      placeholder: 'user@company.com',
      condition: {
        field: 'operation',
        value: ['assign_placeholders', 'create_time_entry', 'create_time_off'],
      },
    },

    // Project fields
    {
      id: 'projectName',
      title: 'Project Name',
      type: 'short-input',
      placeholder: 'e.g. Acme Onboarding',
      condition: { field: 'operation', value: ['create_project', 'update_project'] },
      required: { field: 'operation', value: 'create_project' },
    },
    {
      id: 'customerCompanyName',
      title: 'Customer Company Name',
      type: 'short-input',
      placeholder: 'Exact company name (case-sensitive)',
      condition: { field: 'operation', value: 'create_project' },
      required: { field: 'operation', value: 'create_project' },
    },
    {
      id: 'ownerUserId',
      title: 'Owner User ID',
      type: 'short-input',
      placeholder: 'e.g. 1001',
      condition: { field: 'operation', value: ['create_project', 'update_project'] },
    },
    {
      id: 'ownerEmailId',
      title: 'Owner Email',
      type: 'short-input',
      placeholder: 'owner@company.com',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_project', 'update_project'] },
    },
    {
      id: 'visibility',
      title: 'Visibility',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Everyone', id: 'EVERYONE' },
        { label: 'Members only', id: 'MEMBERS' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_project', 'update_project'] },
    },
    {
      id: 'customerChampionUserId',
      title: 'Customer Champion User ID',
      type: 'short-input',
      placeholder: 'e.g. 2001',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_project' },
    },
    {
      id: 'customerUserIds',
      title: 'Customer User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_project', 'add_project_members'] },
    },
    {
      id: 'customerEmailIds',
      title: 'Customer Emails',
      type: 'short-input',
      placeholder: 'Comma-separated emails',
      mode: 'advanced',
      condition: { field: 'operation', value: 'add_project_members' },
    },
    {
      id: 'fields',
      title: 'Custom Fields',
      type: 'code',
      language: 'json',
      placeholder: '[{"fieldId": 41, "fieldValue": "High"}]',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_project', 'update_project'] },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Rocketlane custom field assignments, each object with a numeric "fieldId" and a "fieldValue" (string or number matching the field type). Return ONLY the JSON array.',
        generationType: 'json-object',
      },
    },
    {
      id: 'sources',
      title: 'Template Sources',
      type: 'code',
      language: 'json',
      placeholder: '[{"templateId": 7, "startDate": "2026-08-01", "prefix": "KO"}]',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_project' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Rocketlane project template sources, each object with a numeric "templateId", a "startDate" (YYYY-MM-DD), and an optional "prefix" string. Return ONLY the JSON array.',
        generationType: 'json-object',
      },
    },
    {
      id: 'placeholders',
      title: 'Placeholder Assignments',
      type: 'code',
      language: 'json',
      placeholder: '[{"placeholderId": 12, "user": {"userId": 1001}}]',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_project' },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Rocketlane placeholder mappings, each object with a numeric "placeholderId" and a "user" object containing either "userId" (number) or "emailId" (string). Return ONLY the JSON array.',
        generationType: 'json-object',
      },
    },
    {
      id: 'assignProjectOwner',
      title: 'Assign Unassigned Tasks to Owner',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_project' },
    },
    {
      id: 'autoCreateCompany',
      title: 'Auto-create Customer Company',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_project' },
    },
    {
      id: 'autoAllocation',
      title: 'Auto Allocation',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_project', 'update_project'] },
    },
    {
      id: 'annualizedRecurringRevenue',
      title: 'Annualized Recurring Revenue',
      type: 'short-input',
      placeholder: 'e.g. 50000',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_project', 'update_project'] },
    },
    {
      id: 'projectFee',
      title: 'Project Fee',
      type: 'short-input',
      placeholder: 'e.g. 25000',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_project', 'update_project'] },
    },
    {
      id: 'budgetedHours',
      title: 'Budgeted Hours',
      type: 'short-input',
      placeholder: 'e.g. 120.5',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_project', 'update_project'] },
    },
    {
      id: 'contractType',
      title: 'Contract Type',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Fixed fee', id: 'FIXED_FEE' },
        { label: 'Time and material', id: 'TIME_AND_MATERIAL' },
        { label: 'Non-billable', id: 'NON_BILLABLE' },
        { label: 'Subscription', id: 'SUBSCRIPTION' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_project' },
    },
    {
      id: 'fixedFee',
      title: 'Fixed Fee',
      type: 'short-input',
      placeholder: 'e.g. 25000',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'create_project',
        and: { field: 'contractType', value: 'FIXED_FEE' },
      },
    },
    {
      id: 'projectBudget',
      title: 'Project Budget',
      type: 'short-input',
      placeholder: 'e.g. 40000',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'create_project',
        and: { field: 'contractType', value: 'TIME_AND_MATERIAL' },
      },
    },
    {
      id: 'rateCardId',
      title: 'Rate Card ID',
      type: 'short-input',
      placeholder: 'e.g. 3',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'create_project',
        and: { field: 'contractType', value: 'TIME_AND_MATERIAL' },
      },
    },
    {
      id: 'subscriptionFrequency',
      title: 'Subscription Frequency',
      type: 'dropdown',
      options: [
        { label: 'None', id: '' },
        { label: 'Monthly', id: 'MONTHLY' },
        { label: 'Quarterly', id: 'QUARTERLY' },
        { label: 'Half-yearly', id: 'HALF_YEARLY' },
        { label: 'Yearly', id: 'YEARLY' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'create_project',
        and: { field: 'contractType', value: 'SUBSCRIPTION' },
      },
    },
    {
      id: 'subscriptionStartDate',
      title: 'Subscription Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'create_project',
        and: { field: 'contractType', value: 'SUBSCRIPTION' },
      },
    },
    {
      id: 'periodMinutes',
      title: 'Budgeted Minutes per Period',
      type: 'short-input',
      placeholder: 'e.g. 2400',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'create_project',
        and: { field: 'contractType', value: 'SUBSCRIPTION' },
      },
    },
    {
      id: 'periodBudget',
      title: 'Budget per Period',
      type: 'short-input',
      placeholder: 'e.g. 5000',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'create_project',
        and: { field: 'contractType', value: 'SUBSCRIPTION' },
      },
    },
    {
      id: 'noOfPeriods',
      title: 'Number of Periods',
      type: 'short-input',
      placeholder: 'e.g. 12',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'create_project',
        and: { field: 'contractType', value: 'SUBSCRIPTION' },
      },
    },
    {
      id: 'currency',
      title: 'Currency',
      type: 'short-input',
      placeholder: 'ISO code, e.g. USD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_project' },
    },

    // Members / assignees / followers / dependencies
    {
      id: 'memberUserIds',
      title: 'Member User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs',
      condition: { field: 'operation', value: [...MEMBER_OPS, 'create_project'] },
    },
    {
      id: 'memberEmailIds',
      title: 'Member Emails',
      type: 'short-input',
      placeholder: 'Comma-separated emails',
      mode: 'advanced',
      condition: { field: 'operation', value: MEMBER_OPS },
    },
    {
      id: 'dependencyTaskIds',
      title: 'Dependency Task IDs',
      type: 'short-input',
      placeholder: 'Comma-separated task IDs',
      condition: {
        field: 'operation',
        value: ['add_task_dependencies', 'remove_task_dependencies'],
      },
      required: {
        field: 'operation',
        value: ['add_task_dependencies', 'remove_task_dependencies'],
      },
    },

    // Task fields
    {
      id: 'taskName',
      title: 'Task Name',
      type: 'short-input',
      placeholder: 'e.g. Kickoff call',
      condition: { field: 'operation', value: ['create_task', 'update_task', 'list_tasks'] },
      required: { field: 'operation', value: 'create_task' },
    },
    {
      id: 'taskDescription',
      title: 'Description',
      type: 'long-input',
      placeholder: 'Task description (HTML supported)',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
    },
    {
      id: 'taskPrivateNote',
      title: 'Private Note',
      type: 'long-input',
      placeholder: 'Visible only to team members (HTML supported)',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
    },
    {
      id: 'taskType',
      title: 'Task Type',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Task', id: 'TASK' },
        { label: 'Milestone', id: 'MILESTONE' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
    },
    {
      id: 'effortInMinutes',
      title: 'Effort (minutes)',
      type: 'short-input',
      placeholder: 'e.g. 480',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
    },
    {
      id: 'progress',
      title: 'Progress (%)',
      type: 'short-input',
      placeholder: '0-100',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
    },
    {
      id: 'atRisk',
      title: 'At Risk',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_task', 'update_task'] },
    },
    {
      id: 'assigneeUserIds',
      title: 'Assignee User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs',
      condition: { field: 'operation', value: 'create_task' },
    },
    {
      id: 'assigneeEmailIds',
      title: 'Assignee Emails',
      type: 'short-input',
      placeholder: 'Comma-separated emails',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_task' },
    },
    {
      id: 'followerUserIds',
      title: 'Follower User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_task' },
    },
    {
      id: 'followerEmailIds',
      title: 'Follower Emails',
      type: 'short-input',
      placeholder: 'Comma-separated emails',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_task' },
    },
    {
      id: 'parentTaskId',
      title: 'Parent Task ID',
      type: 'short-input',
      placeholder: 'e.g. 4001',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_task' },
    },
    {
      id: 'externalReferenceId',
      title: 'External Reference ID',
      type: 'short-input',
      placeholder: 'ID in an external system',
      mode: 'advanced',
      condition: { field: 'operation', value: EXTERNAL_REFERENCE_OPS },
    },

    // Phase fields
    {
      id: 'phaseName',
      title: 'Phase Name',
      type: 'short-input',
      placeholder: 'e.g. Implementation',
      condition: { field: 'operation', value: ['create_phase', 'update_phase', 'list_phases'] },
      required: { field: 'operation', value: 'create_phase' },
    },

    // Field (custom field) configuration
    {
      id: 'fieldLabel',
      title: 'Field Label',
      type: 'short-input',
      placeholder: 'e.g. Priority',
      condition: { field: 'operation', value: ['create_field', 'update_field'] },
      required: { field: 'operation', value: 'create_field' },
    },
    {
      id: 'fieldType',
      title: 'Field Type',
      type: 'dropdown',
      options: [
        { label: 'Select type', id: '' },
        { label: 'Text', id: 'TEXT' },
        { label: 'Multi-line text', id: 'MULTI_LINE_TEXT' },
        { label: 'Yes or no', id: 'YES_OR_NO' },
        { label: 'Date', id: 'DATE' },
        { label: 'Single choice', id: 'SINGLE_CHOICE' },
        { label: 'Multiple choice', id: 'MULTIPLE_CHOICE' },
        { label: 'Single user', id: 'SINGLE_USER' },
        { label: 'Multiple user', id: 'MULTIPLE_USER' },
        { label: 'Number', id: 'NUMBER' },
        { label: 'Note', id: 'NOTE' },
        { label: 'Rating', id: 'RATING' },
      ],
      value: () => '',
      condition: { field: 'operation', value: ['create_field', 'list_fields'] },
      required: { field: 'operation', value: 'create_field' },
    },
    {
      id: 'objectType',
      title: 'Object Type',
      type: 'dropdown',
      options: [
        { label: 'Select object', id: '' },
        { label: 'Project', id: 'PROJECT' },
        { label: 'Task', id: 'TASK' },
        { label: 'User', id: 'USER' },
      ],
      value: () => '',
      condition: { field: 'operation', value: ['create_field', 'list_fields'] },
      required: { field: 'operation', value: 'create_field' },
    },
    {
      id: 'fieldDescription',
      title: 'Field Description',
      type: 'short-input',
      placeholder: 'What this field captures',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_field', 'update_field'] },
    },
    {
      id: 'fieldOptions',
      title: 'Field Options',
      type: 'code',
      language: 'json',
      placeholder: '[{"optionLabel": "High", "optionColor": "RED"}]',
      condition: {
        field: 'operation',
        value: 'create_field',
        and: { field: 'fieldType', value: ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'] },
      },
      wandConfig: {
        enabled: true,
        prompt:
          'Generate a JSON array of Rocketlane field options for a SINGLE_CHOICE or MULTIPLE_CHOICE field. Each object has "optionLabel" (string) and "optionColor" (one of RED, YELLOW, GREEN, TEAL, CYAN, BLUE, PURPLE, MAGENTA, GRAY, COOL_GRAY). Return ONLY the JSON array.',
        generationType: 'json-object',
      },
    },
    {
      id: 'ratingScale',
      title: 'Rating Scale',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: '3 stars', id: 'THREE' },
        { label: '5 stars', id: 'FIVE' },
        { label: '7 stars', id: 'SEVEN' },
        { label: '10 stars', id: 'TEN' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'create_field',
        and: { field: 'fieldType', value: 'RATING' },
      },
    },
    {
      id: 'enabled',
      title: 'Enabled',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_field', 'update_field', 'list_fields'] },
    },
    {
      id: 'private',
      title: 'Private',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: PRIVATE_OPS },
    },
    {
      id: 'optionLabel',
      title: 'Option Label',
      type: 'short-input',
      placeholder: 'e.g. High',
      condition: { field: 'operation', value: ['add_field_option', 'update_field_option'] },
      required: { field: 'operation', value: 'add_field_option' },
    },
    {
      id: 'optionColor',
      title: 'Option Color',
      type: 'dropdown',
      options: [
        { label: 'Select color', id: '' },
        { label: 'Red', id: 'RED' },
        { label: 'Yellow', id: 'YELLOW' },
        { label: 'Green', id: 'GREEN' },
        { label: 'Teal', id: 'TEAL' },
        { label: 'Cyan', id: 'CYAN' },
        { label: 'Blue', id: 'BLUE' },
        { label: 'Purple', id: 'PURPLE' },
        { label: 'Magenta', id: 'MAGENTA' },
        { label: 'Gray', id: 'GRAY' },
        { label: 'Cool gray', id: 'COOL_GRAY' },
      ],
      value: () => '',
      condition: { field: 'operation', value: ['add_field_option', 'update_field_option'] },
      required: { field: 'operation', value: 'add_field_option' },
    },
    {
      id: 'optionValue',
      title: 'Option Value',
      type: 'short-input',
      placeholder: 'Identifier of the option to update',
      condition: { field: 'operation', value: 'update_field_option' },
      required: { field: 'operation', value: 'update_field_option' },
    },

    // Template import
    {
      id: 'templateId',
      title: 'Template ID',
      type: 'short-input',
      placeholder: 'e.g. 7',
      condition: { field: 'operation', value: 'import_template' },
      required: { field: 'operation', value: 'import_template' },
    },
    {
      id: 'prefix',
      title: 'Prefix',
      type: 'short-input',
      placeholder: 'Distinguishes this template import',
      mode: 'advanced',
      condition: { field: 'operation', value: 'import_template' },
    },

    // Dates
    {
      id: 'startDate',
      title: 'Start Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: START_DATE_OPS },
      required: { field: 'operation', value: START_DATE_REQUIRED_OPS },
    },
    {
      id: 'dueDate',
      title: 'Due Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: DUE_DATE_OPS },
      required: { field: 'operation', value: 'create_phase' },
    },
    {
      id: 'endDate',
      title: 'End Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: ['create_time_off', 'list_resource_allocations'] },
      required: { field: 'operation', value: ['create_time_off', 'list_resource_allocations'] },
    },
    {
      id: 'statusValue',
      title: 'Status Value',
      type: 'short-input',
      placeholder: 'Numeric status identifier',
      mode: 'advanced',
      condition: { field: 'operation', value: STATUS_VALUE_OPS },
    },

    // Time entry fields
    {
      id: 'date',
      title: 'Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      condition: { field: 'operation', value: ['create_time_entry', 'update_time_entry'] },
      required: { field: 'operation', value: ['create_time_entry', 'update_time_entry'] },
    },
    {
      id: 'minutes',
      title: 'Minutes',
      type: 'short-input',
      placeholder: '1-1440',
      condition: { field: 'operation', value: ['create_time_entry', 'update_time_entry'] },
      required: { field: 'operation', value: ['create_time_entry', 'update_time_entry'] },
    },
    {
      id: 'timeEntrySource',
      title: 'Track Time Against',
      type: 'dropdown',
      options: [
        { label: 'Task', id: 'task' },
        { label: 'Project', id: 'project' },
        { label: 'Project phase', id: 'phase' },
        { label: 'Ad-hoc activity', id: 'activity' },
      ],
      condition: { field: 'operation', value: 'create_time_entry' },
      value: () => 'task',
    },
    {
      id: 'timeEntryTaskId',
      title: 'Task ID',
      type: 'short-input',
      placeholder: 'e.g. 5001',
      condition: {
        field: 'operation',
        value: 'create_time_entry',
        and: { field: 'timeEntrySource', value: 'task' },
      },
      required: {
        field: 'operation',
        value: 'create_time_entry',
        and: { field: 'timeEntrySource', value: 'task' },
      },
    },
    {
      id: 'timeEntryProjectId',
      title: 'Project ID',
      type: 'short-input',
      placeholder: 'e.g. 101',
      condition: {
        field: 'operation',
        value: 'create_time_entry',
        and: { field: 'timeEntrySource', value: 'project' },
      },
      required: {
        field: 'operation',
        value: 'create_time_entry',
        and: { field: 'timeEntrySource', value: 'project' },
      },
    },
    {
      id: 'timeEntryPhaseId',
      title: 'Project Phase ID',
      type: 'short-input',
      placeholder: 'e.g. 301',
      condition: {
        field: 'operation',
        value: 'create_time_entry',
        and: { field: 'timeEntrySource', value: 'phase' },
      },
      required: {
        field: 'operation',
        value: 'create_time_entry',
        and: { field: 'timeEntrySource', value: 'phase' },
      },
    },
    {
      id: 'timeEntryActivityName',
      title: 'Activity Name',
      type: 'short-input',
      placeholder: 'e.g. Internal sync',
      condition: {
        field: 'operation',
        value: 'create_time_entry',
        and: { field: 'timeEntrySource', value: 'activity' },
      },
      required: {
        field: 'operation',
        value: 'create_time_entry',
        and: { field: 'timeEntrySource', value: 'activity' },
      },
    },
    {
      id: 'activityName',
      title: 'Activity Name',
      type: 'short-input',
      placeholder: 'New name for the ad-hoc activity',
      mode: 'advanced',
      condition: { field: 'operation', value: 'update_time_entry' },
    },
    {
      id: 'notes',
      title: 'Notes',
      type: 'long-input',
      placeholder: 'Notes for the time entry',
      condition: { field: 'operation', value: ['create_time_entry', 'update_time_entry'] },
    },
    {
      id: 'billable',
      title: 'Billable',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_time_entry', 'update_time_entry'] },
    },
    {
      id: 'categoryId',
      title: 'Category ID',
      type: 'short-input',
      placeholder: 'Time entry category ID',
      mode: 'advanced',
      condition: { field: 'operation', value: ['create_time_entry', 'update_time_entry'] },
    },

    // Time-off fields
    {
      id: 'timeOffType',
      title: 'Time-Off Type',
      type: 'dropdown',
      options: [
        { label: 'Full day', id: 'FULL_DAY' },
        { label: 'Half day', id: 'HALF_DAY' },
        { label: 'Custom', id: 'CUSTOM' },
      ],
      value: () => 'FULL_DAY',
      condition: { field: 'operation', value: 'create_time_off' },
      required: { field: 'operation', value: 'create_time_off' },
    },
    {
      id: 'durationInMinutes',
      title: 'Duration per Day (minutes)',
      type: 'short-input',
      placeholder: 'e.g. 240',
      condition: {
        field: 'operation',
        value: 'create_time_off',
        and: { field: 'timeOffType', value: 'CUSTOM' },
      },
      required: {
        field: 'operation',
        value: 'create_time_off',
        and: { field: 'timeOffType', value: 'CUSTOM' },
      },
    },
    {
      id: 'note',
      title: 'Note',
      type: 'long-input',
      placeholder: 'Note about the time-off',
      condition: { field: 'operation', value: 'create_time_off' },
    },
    {
      id: 'notifyProjectOwners',
      title: 'Notify Project Owners',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_time_off' },
    },
    {
      id: 'notifyUserIds',
      title: 'Notify User IDs',
      type: 'short-input',
      placeholder: 'Comma-separated user IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_time_off' },
    },
    {
      id: 'notifyUserEmails',
      title: 'Notify User Emails',
      type: 'short-input',
      placeholder: 'Comma-separated emails',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_time_off' },
    },

    // Space fields
    {
      id: 'spaceName',
      title: 'Space Name',
      type: 'short-input',
      placeholder: 'e.g. Shared Docs',
      condition: { field: 'operation', value: ['create_space', 'update_space'] },
      required: { field: 'operation', value: 'create_space' },
    },

    // Space document fields
    {
      id: 'spaceDocumentType',
      title: 'Document Type',
      type: 'dropdown',
      options: [
        { label: 'Rocketlane document', id: 'ROCKETLANE_DOCUMENT' },
        { label: 'Embedded document', id: 'EMBEDDED_DOCUMENT' },
      ],
      value: () => 'ROCKETLANE_DOCUMENT',
      condition: { field: 'operation', value: 'create_space_document' },
      required: { field: 'operation', value: 'create_space_document' },
    },
    {
      id: 'spaceDocumentName',
      title: 'Document Name',
      type: 'short-input',
      placeholder: 'e.g. Kickoff Notes',
      condition: { field: 'operation', value: ['create_space_document', 'update_space_document'] },
    },
    {
      id: 'url',
      title: 'Embed URL',
      type: 'short-input',
      placeholder: 'https://... (embedded documents)',
      condition: { field: 'operation', value: ['create_space_document', 'update_space_document'] },
    },
    {
      id: 'documentTemplateId',
      title: 'Document Template ID',
      type: 'short-input',
      placeholder: 'e.g. 5',
      mode: 'advanced',
      condition: { field: 'operation', value: 'create_space_document' },
    },

    // List filters — projects
    {
      id: 'projectNameContains',
      title: 'Project Name Contains',
      type: 'short-input',
      placeholder: 'e.g. Onboarding',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_projects' },
    },
    {
      id: 'projectNameEquals',
      title: 'Project Name Equals',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_projects' },
    },
    {
      id: 'statusEquals',
      title: 'Status Equals',
      type: 'short-input',
      placeholder: 'Project status value',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_projects' },
    },
    {
      id: 'statusOneOf',
      title: 'Status One Of',
      type: 'short-input',
      placeholder: 'Comma-separated status values',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_projects' },
    },
    {
      id: 'customerIdEquals',
      title: 'Customer Company ID',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_projects' },
    },
    {
      id: 'customerIdOneOf',
      title: 'Customer Company ID One Of',
      type: 'short-input',
      placeholder: 'Comma-separated company IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_projects' },
    },
    {
      id: 'teamMemberIdEquals',
      title: 'Team Member ID',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_projects' },
    },
    {
      id: 'contractTypeEquals',
      title: 'Contract Type',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Fixed fee', id: 'FIXED_FEE' },
        { label: 'Time and material', id: 'TIME_AND_MATERIAL' },
        { label: 'Subscription', id: 'SUBSCRIPTION' },
        { label: 'Non-billable', id: 'NON_BILLABLE' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_projects' },
    },
    {
      id: 'includeArchived',
      title: 'Include Archived',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_projects' },
    },
    {
      id: 'externalReferenceIdEquals',
      title: 'External Reference ID Equals',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_projects' },
    },
    {
      id: 'startDateAfter',
      title: 'Start Date After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_projects' },
    },
    {
      id: 'startDateBefore',
      title: 'Start Date Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_projects' },
    },
    {
      id: 'dueDateAfter',
      title: 'Due Date After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_projects' },
    },
    {
      id: 'dueDateBefore',
      title: 'Due Date Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_projects' },
    },

    // List filters — tasks
    {
      id: 'taskNameContains',
      title: 'Task Name Contains',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_tasks' },
    },
    {
      id: 'taskStatus',
      title: 'Task Status',
      type: 'short-input',
      placeholder: 'Task status value',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_tasks' },
    },
    {
      id: 'startDateFrom',
      title: 'Start Date From',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_tasks' },
    },
    {
      id: 'startDateTo',
      title: 'Start Date To',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_tasks' },
    },
    {
      id: 'dueDateFrom',
      title: 'Due Date From',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_tasks' },
    },
    {
      id: 'dueDateTo',
      title: 'Due Date To',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_tasks' },
    },
    {
      id: 'includeArchive',
      title: 'Include Archived Tasks',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_tasks' },
    },

    // List filters — time entries (shared with search)
    {
      id: 'dateEq',
      title: 'Date Equals',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: TIME_ENTRY_FILTER_OPS },
    },
    {
      id: 'dateGe',
      title: 'Date On or After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: TIME_ENTRY_FILTER_OPS },
    },
    {
      id: 'dateLe',
      title: 'Date On or Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: TIME_ENTRY_FILTER_OPS },
    },
    {
      id: 'projectIdEq',
      title: 'Project ID Filter',
      type: 'short-input',
      placeholder: 'e.g. 101',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [...TIME_ENTRY_FILTER_OPS, 'list_resource_allocations'],
      },
    },
    {
      id: 'taskIdEq',
      title: 'Task ID Filter',
      type: 'short-input',
      placeholder: 'e.g. 5001',
      mode: 'advanced',
      condition: { field: 'operation', value: TIME_ENTRY_FILTER_OPS },
    },
    {
      id: 'projectPhaseIdEq',
      title: 'Phase ID Filter',
      type: 'short-input',
      placeholder: 'e.g. 301',
      mode: 'advanced',
      condition: { field: 'operation', value: TIME_ENTRY_FILTER_OPS },
    },
    {
      id: 'categoryIdEq',
      title: 'Category ID Filter',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: TIME_ENTRY_FILTER_OPS },
    },
    {
      id: 'userIdEq',
      title: 'User ID Filter',
      type: 'short-input',
      placeholder: 'e.g. 1001',
      mode: 'advanced',
      condition: { field: 'operation', value: [...TIME_ENTRY_FILTER_OPS, 'list_time_offs'] },
    },
    {
      id: 'emailIdEq',
      title: 'User Email Filter',
      type: 'short-input',
      placeholder: 'user@company.com',
      mode: 'advanced',
      condition: { field: 'operation', value: ['list_time_entries', 'list_time_offs'] },
    },
    {
      id: 'emailIdCn',
      title: 'User Email Contains',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_time_entries' },
    },
    {
      id: 'sourceTypeEq',
      title: 'Source Type',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Task', id: 'TASK' },
        { label: 'Project', id: 'PROJECT' },
        { label: 'Phase', id: 'PHASE' },
        { label: 'Ad-hoc', id: 'ADHOC' },
        { label: 'Milestone', id: 'MILESTONE' },
        { label: 'Google Calendar', id: 'GOOGLE_CALENDAR' },
        { label: 'Outlook Calendar', id: 'OUTLOOK_CALENDAR' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: TIME_ENTRY_FILTER_OPS },
    },
    {
      id: 'activityNameEq',
      title: 'Activity Name Equals',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: TIME_ENTRY_FILTER_OPS },
    },
    {
      id: 'activityNameCn',
      title: 'Activity Name Contains',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: TIME_ENTRY_FILTER_OPS },
    },
    {
      id: 'approvalStatusEq',
      title: 'Approval Status',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Not submitted', id: 'NOT_SUBMITTED' },
        { label: 'Submitted', id: 'SUBMITTED' },
        { label: 'Approved', id: 'APPROVED' },
        { label: 'Rejected', id: 'REJECTED' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: TIME_ENTRY_FILTER_OPS },
    },
    {
      id: 'billableEq',
      title: 'Billable Only',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_time_entries' },
    },
    {
      id: 'includeDeletedEq',
      title: 'Include Deleted',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_time_entries' },
    },
    {
      id: 'createdAtGt',
      title: 'Created After (epoch ms)',
      type: 'short-input',
      placeholder: 'e.g. 1750000000000',
      mode: 'advanced',
      condition: { field: 'operation', value: CREATED_UPDATED_AT_OPS },
    },
    {
      id: 'createdAtLt',
      title: 'Created Before (epoch ms)',
      type: 'short-input',
      placeholder: 'e.g. 1750000000000',
      mode: 'advanced',
      condition: { field: 'operation', value: CREATED_UPDATED_AT_OPS },
    },
    {
      id: 'updatedAtGt',
      title: 'Updated After (epoch ms)',
      type: 'short-input',
      placeholder: 'e.g. 1750000000000',
      mode: 'advanced',
      condition: { field: 'operation', value: CREATED_UPDATED_AT_OPS },
    },
    {
      id: 'updatedAtLt',
      title: 'Updated Before (epoch ms)',
      type: 'short-input',
      placeholder: 'e.g. 1750000000000',
      mode: 'advanced',
      condition: { field: 'operation', value: CREATED_UPDATED_AT_OPS },
    },

    // List filters — time-offs
    {
      id: 'startDateGe',
      title: 'Start Date On or After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_time_offs' },
    },
    {
      id: 'startDateLe',
      title: 'Start Date On or Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_time_offs' },
    },
    {
      id: 'endDateGe',
      title: 'End Date On or After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_time_offs' },
    },
    {
      id: 'endDateLe',
      title: 'End Date On or Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_time_offs' },
    },
    {
      id: 'timeOffTypeEq',
      title: 'Time-Off Type Filter',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Full day', id: 'FULL_DAY' },
        { label: 'Half day', id: 'HALF_DAY' },
        { label: 'Custom', id: 'CUSTOM' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_time_offs' },
    },

    // List filters — users
    {
      id: 'firstNameCn',
      title: 'First Name Contains',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_users' },
    },
    {
      id: 'lastNameCn',
      title: 'Last Name Contains',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_users' },
    },
    {
      id: 'emailEq',
      title: 'Email Equals',
      type: 'short-input',
      placeholder: 'user@company.com',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_users' },
    },
    {
      id: 'emailCn',
      title: 'Email Contains',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_users' },
    },
    {
      id: 'userStatusEq',
      title: 'User Status',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Active', id: 'ACTIVE' },
        { label: 'Invited', id: 'INVITED' },
        { label: 'Inactive', id: 'INACTIVE' },
        { label: 'Passive', id: 'PASSIVE' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_users' },
    },
    {
      id: 'userTypeEq',
      title: 'User Type',
      type: 'dropdown',
      options: [
        { label: 'Any', id: '' },
        { label: 'Team member', id: 'TEAM_MEMBER' },
        { label: 'Partner', id: 'PARTNER' },
        { label: 'Customer', id: 'CUSTOMER' },
        { label: 'External partner', id: 'EXTERNAL_PARTNER' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_users' },
    },

    // List filters — spaces / space documents
    {
      id: 'spaceNameEq',
      title: 'Space Name Equals',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_spaces' },
    },
    {
      id: 'spaceNameCn',
      title: 'Space Name Contains',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_spaces' },
    },
    {
      id: 'spaceDocumentNameEq',
      title: 'Document Name Equals',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_space_documents' },
    },
    {
      id: 'spaceDocumentNameCn',
      title: 'Document Name Contains',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_space_documents' },
    },
    {
      id: 'spaceIdEq',
      title: 'Space ID Filter',
      type: 'short-input',
      placeholder: 'e.g. 21',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_space_documents' },
    },

    // List filters — resource allocations
    {
      id: 'memberIdEq',
      title: 'Member ID Filter',
      type: 'short-input',
      placeholder: 'e.g. 1001',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_resource_allocations' },
    },
    {
      id: 'placeholderIdEq',
      title: 'Placeholder ID Filter',
      type: 'short-input',
      placeholder: 'e.g. 12',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_resource_allocations' },
    },

    // List filters — invoices
    {
      id: 'invoiceStatusEq',
      title: 'Invoice Status',
      type: 'short-input',
      placeholder: 'e.g. DRAFT',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_invoices' },
    },
    {
      id: 'invoiceStatusOneOf',
      title: 'Invoice Status One Of',
      type: 'short-input',
      placeholder: 'e.g. DRAFT,PAID',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_invoices' },
    },
    {
      id: 'invoiceNumberEq',
      title: 'Invoice Number Equals',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_invoices' },
    },
    {
      id: 'invoiceNumberCn',
      title: 'Invoice Number Contains',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_invoices' },
    },
    {
      id: 'companyIdEq',
      title: 'Company ID Filter',
      type: 'short-input',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_invoices' },
    },
    {
      id: 'companyIdOneOf',
      title: 'Company ID One Of',
      type: 'short-input',
      placeholder: 'Comma-separated company IDs',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_invoices' },
    },
    {
      id: 'dateOfIssueGe',
      title: 'Issued On or After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_invoices' },
    },
    {
      id: 'dateOfIssueLe',
      title: 'Issued On or Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_invoices' },
    },
    {
      id: 'dueDateGe',
      title: 'Due On or After',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_invoices' },
    },
    {
      id: 'dueDateLe',
      title: 'Due On or Before',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_invoices' },
    },
    {
      id: 'amountGe',
      title: 'Amount At Least',
      type: 'short-input',
      placeholder: 'e.g. 1000',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_invoices' },
    },
    {
      id: 'amountLe',
      title: 'Amount At Most',
      type: 'short-input',
      placeholder: 'e.g. 10000',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_invoices' },
    },
    {
      id: 'amountOutstandingGt',
      title: 'Amount Outstanding Greater Than',
      type: 'short-input',
      placeholder: 'e.g. 0',
      mode: 'advanced',
      condition: { field: 'operation', value: 'list_invoices' },
    },

    // Shared list controls
    {
      id: 'sortBy',
      title: 'Sort By',
      type: 'short-input',
      placeholder: 'Field to sort by (varies per operation)',
      mode: 'advanced',
      condition: { field: 'operation', value: SORT_MATCH_OPS },
    },
    {
      id: 'sortOrder',
      title: 'Sort Order',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Ascending', id: 'ASC' },
        { label: 'Descending', id: 'DESC' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: SORT_MATCH_OPS },
    },
    {
      id: 'match',
      title: 'Filter Match',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'All filters (AND)', id: 'all' },
        { label: 'Any filter (OR)', id: 'any' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: { field: 'operation', value: SORT_MATCH_OPS },
    },
    {
      id: 'includeFields',
      title: 'Include Fields',
      type: 'short-input',
      placeholder: 'Comma-separated extra response fields',
      mode: 'advanced',
      condition: { field: 'operation', value: INCLUDE_FIELDS_OPS },
    },
    {
      id: 'includeAllFields',
      title: 'Include All Fields',
      type: 'switch',
      mode: 'advanced',
      condition: { field: 'operation', value: INCLUDE_ALL_FIELDS_OPS },
    },
    {
      id: 'pageSize',
      title: 'Page Size',
      type: 'short-input',
      placeholder: 'Results per page (default 100)',
      mode: 'advanced',
      condition: { field: 'operation', value: PAGINATED_OPS },
    },
    {
      id: 'pageToken',
      title: 'Page Token',
      type: 'short-input',
      placeholder: 'Token from a previous response',
      mode: 'advanced',
      condition: { field: 'operation', value: PAGINATED_OPS },
    },

    // Credential
    {
      id: 'apiKey',
      title: 'API Key',
      type: 'short-input',
      placeholder: 'Enter your Rocketlane API key',
      password: true,
      required: true,
    },
  ],

  tools: {
    access: [
      'rocketlane_create_project',
      'rocketlane_get_project',
      'rocketlane_list_projects',
      'rocketlane_update_project',
      'rocketlane_archive_project',
      'rocketlane_delete_project',
      'rocketlane_add_project_members',
      'rocketlane_remove_project_members',
      'rocketlane_import_template',
      'rocketlane_list_placeholders',
      'rocketlane_assign_placeholders',
      'rocketlane_unassign_placeholders',
      'rocketlane_create_task',
      'rocketlane_get_task',
      'rocketlane_list_tasks',
      'rocketlane_update_task',
      'rocketlane_delete_task',
      'rocketlane_move_task_to_phase',
      'rocketlane_add_task_assignees',
      'rocketlane_remove_task_assignees',
      'rocketlane_add_task_followers',
      'rocketlane_remove_task_followers',
      'rocketlane_add_task_dependencies',
      'rocketlane_remove_task_dependencies',
      'rocketlane_create_phase',
      'rocketlane_get_phase',
      'rocketlane_list_phases',
      'rocketlane_update_phase',
      'rocketlane_delete_phase',
      'rocketlane_create_field',
      'rocketlane_get_field',
      'rocketlane_list_fields',
      'rocketlane_update_field',
      'rocketlane_delete_field',
      'rocketlane_add_field_option',
      'rocketlane_update_field_option',
      'rocketlane_create_time_entry',
      'rocketlane_get_time_entry',
      'rocketlane_list_time_entries',
      'rocketlane_search_time_entries',
      'rocketlane_update_time_entry',
      'rocketlane_delete_time_entry',
      'rocketlane_list_time_entry_categories',
      'rocketlane_create_time_off',
      'rocketlane_get_time_off',
      'rocketlane_list_time_offs',
      'rocketlane_delete_time_off',
      'rocketlane_get_user',
      'rocketlane_list_users',
      'rocketlane_create_space',
      'rocketlane_get_space',
      'rocketlane_list_spaces',
      'rocketlane_update_space',
      'rocketlane_delete_space',
      'rocketlane_create_space_document',
      'rocketlane_get_space_document',
      'rocketlane_list_space_documents',
      'rocketlane_update_space_document',
      'rocketlane_delete_space_document',
      'rocketlane_list_resource_allocations',
      'rocketlane_get_invoice',
      'rocketlane_list_invoices',
      'rocketlane_get_invoice_line_items',
      'rocketlane_get_invoice_payments',
    ],
    config: {
      tool: (params) => `rocketlane_${params.operation}`,
      params: (params) => ({
        ...buildOperationParams(params),
        apiKey: params.apiKey,
      }),
    },
  },

  inputs: {
    operation: { type: 'string', description: 'Operation to perform' },
    apiKey: { type: 'string', description: 'Rocketlane API key' },
    projectId: { type: 'number', description: 'Project ID' },
    taskId: { type: 'number', description: 'Task ID' },
    phaseId: { type: 'number', description: 'Phase ID' },
    fieldId: { type: 'number', description: 'Custom field ID' },
    spaceId: { type: 'number', description: 'Space ID' },
    spaceDocumentId: { type: 'number', description: 'Space document ID' },
    timeEntryId: { type: 'number', description: 'Time entry ID' },
    timeOffId: { type: 'number', description: 'Time-off ID' },
    invoiceId: { type: 'number', description: 'Invoice ID' },
    placeholderId: { type: 'number', description: 'Placeholder ID' },
    userId: { type: 'number', description: 'User ID' },
    userEmail: { type: 'string', description: 'User email' },
    projectName: { type: 'string', description: 'Project name' },
    customerCompanyName: { type: 'string', description: 'Customer company name (exact match)' },
    ownerUserId: { type: 'number', description: 'Project owner user ID' },
    ownerEmailId: { type: 'string', description: 'Project owner email' },
    visibility: { type: 'string', description: 'Project visibility (EVERYONE or MEMBERS)' },
    customerChampionUserId: { type: 'number', description: 'Customer champion user ID' },
    customerUserIds: { type: 'string', description: 'Comma-separated customer user IDs' },
    customerEmailIds: { type: 'string', description: 'Comma-separated customer emails' },
    fields: { type: 'json', description: 'Custom field assignments (fieldId/fieldValue array)' },
    sources: { type: 'json', description: 'Project template sources (templateId/startDate array)' },
    placeholders: { type: 'json', description: 'Placeholder-to-user mappings' },
    assignProjectOwner: {
      type: 'boolean',
      description: 'Assign unassigned tasks to the project owner',
    },
    autoCreateCompany: {
      type: 'boolean',
      description: 'Create the customer company if it does not exist',
    },
    autoAllocation: { type: 'boolean', description: 'Enable auto allocation for the project' },
    annualizedRecurringRevenue: { type: 'number', description: 'Annualized recurring revenue' },
    projectFee: { type: 'number', description: 'Total project fee' },
    budgetedHours: { type: 'number', description: 'Total budgeted hours' },
    contractType: {
      type: 'string',
      description: 'Contract type (FIXED_FEE, TIME_AND_MATERIAL, NON_BILLABLE, SUBSCRIPTION)',
    },
    fixedFee: { type: 'number', description: 'Fee for fixed-fee contracts' },
    projectBudget: { type: 'number', description: 'Budget for time-and-material contracts' },
    rateCardId: { type: 'number', description: 'Rate card ID for time-and-material contracts' },
    subscriptionFrequency: {
      type: 'string',
      description: 'Subscription interval (MONTHLY, QUARTERLY, HALF_YEARLY, YEARLY)',
    },
    subscriptionStartDate: { type: 'string', description: 'Subscription start date (YYYY-MM-DD)' },
    periodMinutes: { type: 'number', description: 'Budgeted minutes per subscription period' },
    periodBudget: { type: 'number', description: 'Budget per subscription period' },
    noOfPeriods: { type: 'number', description: 'Number of subscription periods' },
    currency: { type: 'string', description: 'Currency ISO code (e.g. USD)' },
    memberUserIds: { type: 'string', description: 'Comma-separated member user IDs' },
    memberEmailIds: { type: 'string', description: 'Comma-separated member emails' },
    dependencyTaskIds: { type: 'string', description: 'Comma-separated dependency task IDs' },
    taskName: { type: 'string', description: 'Task name (also an exact-match list filter)' },
    taskDescription: { type: 'string', description: 'Task description (HTML)' },
    taskPrivateNote: { type: 'string', description: 'Private note for team members (HTML)' },
    taskType: { type: 'string', description: 'Task type (TASK or MILESTONE)' },
    effortInMinutes: { type: 'number', description: 'Expected effort in minutes' },
    progress: { type: 'number', description: 'Task progress (0-100)' },
    atRisk: { type: 'boolean', description: 'Whether the task is at risk' },
    assigneeUserIds: { type: 'string', description: 'Comma-separated assignee user IDs' },
    assigneeEmailIds: { type: 'string', description: 'Comma-separated assignee emails' },
    followerUserIds: { type: 'string', description: 'Comma-separated follower user IDs' },
    followerEmailIds: { type: 'string', description: 'Comma-separated follower emails' },
    parentTaskId: { type: 'number', description: 'Parent task ID' },
    externalReferenceId: { type: 'string', description: 'External system reference ID' },
    phaseName: { type: 'string', description: 'Phase name (also an exact-match list filter)' },
    fieldLabel: { type: 'string', description: 'Custom field label' },
    fieldType: { type: 'string', description: 'Custom field type (also a list filter)' },
    objectType: {
      type: 'string',
      description: 'Object the field applies to (PROJECT, TASK, USER)',
    },
    fieldDescription: { type: 'string', description: 'Custom field description' },
    fieldOptions: { type: 'json', description: 'Options for choice fields (label/color array)' },
    ratingScale: { type: 'string', description: 'Rating scale (THREE, FIVE, SEVEN, TEN)' },
    enabled: { type: 'boolean', description: 'Whether the field is enabled (also a list filter)' },
    private: { type: 'boolean', description: 'Whether the resource is private' },
    optionLabel: { type: 'string', description: 'Field option label' },
    optionColor: { type: 'string', description: 'Field option color' },
    optionValue: { type: 'number', description: 'Identifier of the option to update' },
    templateId: { type: 'number', description: 'Project template ID' },
    prefix: { type: 'string', description: 'Prefix distinguishing a template import' },
    startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
    dueDate: { type: 'string', description: 'Due date (YYYY-MM-DD)' },
    endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
    statusValue: { type: 'number', description: 'Numeric status value' },
    date: { type: 'string', description: 'Time entry date (YYYY-MM-DD)' },
    minutes: { type: 'number', description: 'Time entry duration in minutes (1-1440)' },
    timeEntrySource: {
      type: 'string',
      description: 'What the time entry tracks against (task, project, phase, activity)',
    },
    timeEntryTaskId: { type: 'number', description: 'Task ID to track time against' },
    timeEntryProjectId: { type: 'number', description: 'Project ID to track time against' },
    timeEntryPhaseId: { type: 'number', description: 'Project phase ID to track time against' },
    timeEntryActivityName: { type: 'string', description: 'Ad-hoc activity to track time against' },
    activityName: { type: 'string', description: 'New name for an ad-hoc activity' },
    notes: { type: 'string', description: 'Time entry notes' },
    billable: { type: 'boolean', description: 'Whether the time entry is billable' },
    categoryId: { type: 'number', description: 'Time entry category ID' },
    timeOffType: { type: 'string', description: 'Time-off type (FULL_DAY, HALF_DAY, CUSTOM)' },
    durationInMinutes: { type: 'number', description: 'Time-off minutes per day (CUSTOM type)' },
    note: { type: 'string', description: 'Time-off note' },
    notifyProjectOwners: { type: 'boolean', description: 'Notify project owners of the time-off' },
    notifyUserIds: { type: 'string', description: 'Comma-separated user IDs to notify' },
    notifyUserEmails: { type: 'string', description: 'Comma-separated emails to notify' },
    spaceName: { type: 'string', description: 'Space name' },
    spaceDocumentType: {
      type: 'string',
      description: 'Space document type (ROCKETLANE_DOCUMENT or EMBEDDED_DOCUMENT)',
    },
    spaceDocumentName: { type: 'string', description: 'Space document name' },
    url: { type: 'string', description: 'URL to embed in the space document' },
    documentTemplateId: { type: 'number', description: 'Document template ID' },
    projectNameContains: { type: 'string', description: 'Filter: project name contains' },
    projectNameEquals: { type: 'string', description: 'Filter: project name equals' },
    statusEquals: { type: 'string', description: 'Filter: project status equals' },
    statusOneOf: { type: 'string', description: 'Filter: project status one of (comma-separated)' },
    customerIdEquals: { type: 'string', description: 'Filter: customer company ID equals' },
    customerIdOneOf: {
      type: 'string',
      description: 'Filter: customer company ID one of (comma-separated)',
    },
    teamMemberIdEquals: { type: 'string', description: 'Filter: project includes team member ID' },
    contractTypeEquals: { type: 'string', description: 'Filter: project contract type' },
    includeArchived: { type: 'boolean', description: 'Include archived projects' },
    externalReferenceIdEquals: {
      type: 'string',
      description: 'Filter: external reference ID equals',
    },
    startDateAfter: { type: 'string', description: 'Filter: start date after (YYYY-MM-DD)' },
    startDateBefore: { type: 'string', description: 'Filter: start date before (YYYY-MM-DD)' },
    dueDateAfter: { type: 'string', description: 'Filter: due date after (YYYY-MM-DD)' },
    dueDateBefore: { type: 'string', description: 'Filter: due date before (YYYY-MM-DD)' },
    taskNameContains: { type: 'string', description: 'Filter: task name contains' },
    taskStatus: { type: 'string', description: 'Filter: task status value' },
    startDateFrom: { type: 'string', description: 'Filter: start date on or after (YYYY-MM-DD)' },
    startDateTo: { type: 'string', description: 'Filter: start date on or before (YYYY-MM-DD)' },
    dueDateFrom: { type: 'string', description: 'Filter: due date on or after (YYYY-MM-DD)' },
    dueDateTo: { type: 'string', description: 'Filter: due date on or before (YYYY-MM-DD)' },
    includeArchive: { type: 'boolean', description: 'Include archived tasks' },
    dateEq: { type: 'string', description: 'Filter: time entry date equals (YYYY-MM-DD)' },
    dateGe: { type: 'string', description: 'Filter: time entry date on or after (YYYY-MM-DD)' },
    dateLe: { type: 'string', description: 'Filter: time entry date on or before (YYYY-MM-DD)' },
    projectIdEq: { type: 'string', description: 'Filter: project ID equals' },
    taskIdEq: { type: 'number', description: 'Filter: task ID equals' },
    projectPhaseIdEq: { type: 'number', description: 'Filter: project phase ID equals' },
    categoryIdEq: { type: 'number', description: 'Filter: time entry category ID equals' },
    userIdEq: { type: 'string', description: 'Filter: user ID equals' },
    emailIdEq: { type: 'string', description: 'Filter: user email equals' },
    emailIdCn: { type: 'string', description: 'Filter: user email contains' },
    sourceTypeEq: { type: 'string', description: 'Filter: time entry source type' },
    activityNameEq: { type: 'string', description: 'Filter: activity name equals' },
    activityNameCn: { type: 'string', description: 'Filter: activity name contains' },
    approvalStatusEq: { type: 'string', description: 'Filter: time entry approval status' },
    billableEq: { type: 'boolean', description: 'Filter: billable time entries only' },
    includeDeletedEq: { type: 'boolean', description: 'Include deleted time entries' },
    createdAtGt: { type: 'number', description: 'Filter: created after (epoch ms)' },
    createdAtLt: { type: 'number', description: 'Filter: created before (epoch ms)' },
    updatedAtGt: { type: 'number', description: 'Filter: updated after (epoch ms)' },
    updatedAtLt: { type: 'number', description: 'Filter: updated before (epoch ms)' },
    startDateGe: { type: 'string', description: 'Filter: start date on or after (YYYY-MM-DD)' },
    startDateLe: { type: 'string', description: 'Filter: start date on or before (YYYY-MM-DD)' },
    endDateGe: { type: 'string', description: 'Filter: end date on or after (YYYY-MM-DD)' },
    endDateLe: { type: 'string', description: 'Filter: end date on or before (YYYY-MM-DD)' },
    timeOffTypeEq: { type: 'string', description: 'Filter: time-off type' },
    firstNameCn: { type: 'string', description: 'Filter: first name contains' },
    lastNameCn: { type: 'string', description: 'Filter: last name contains' },
    emailEq: { type: 'string', description: 'Filter: email equals' },
    emailCn: { type: 'string', description: 'Filter: email contains' },
    userStatusEq: { type: 'string', description: 'Filter: user status' },
    userTypeEq: { type: 'string', description: 'Filter: user type' },
    spaceNameEq: { type: 'string', description: 'Filter: space name equals' },
    spaceNameCn: { type: 'string', description: 'Filter: space name contains' },
    spaceDocumentNameEq: { type: 'string', description: 'Filter: space document name equals' },
    spaceDocumentNameCn: { type: 'string', description: 'Filter: space document name contains' },
    spaceIdEq: { type: 'number', description: 'Filter: space ID equals' },
    memberIdEq: { type: 'string', description: 'Filter: allocation member ID equals' },
    placeholderIdEq: { type: 'string', description: 'Filter: allocation placeholder ID equals' },
    invoiceStatusEq: { type: 'string', description: 'Filter: invoice status equals' },
    invoiceStatusOneOf: {
      type: 'string',
      description: 'Filter: invoice status one of (comma-separated)',
    },
    invoiceNumberEq: { type: 'string', description: 'Filter: invoice number equals' },
    invoiceNumberCn: { type: 'string', description: 'Filter: invoice number contains' },
    companyIdEq: { type: 'string', description: 'Filter: customer company ID equals' },
    companyIdOneOf: {
      type: 'string',
      description: 'Filter: customer company ID one of (comma-separated)',
    },
    dateOfIssueGe: { type: 'string', description: 'Filter: issued on or after (YYYY-MM-DD)' },
    dateOfIssueLe: { type: 'string', description: 'Filter: issued on or before (YYYY-MM-DD)' },
    dueDateGe: { type: 'string', description: 'Filter: invoice due on or after (YYYY-MM-DD)' },
    dueDateLe: { type: 'string', description: 'Filter: invoice due on or before (YYYY-MM-DD)' },
    amountGe: { type: 'number', description: 'Filter: invoice amount at least' },
    amountLe: { type: 'number', description: 'Filter: invoice amount at most' },
    amountOutstandingGt: { type: 'number', description: 'Filter: amount outstanding greater than' },
    sortBy: { type: 'string', description: 'Field to sort results by' },
    sortOrder: { type: 'string', description: 'Sort order (ASC or DESC)' },
    match: { type: 'string', description: 'Combine filters with all (AND) or any (OR)' },
    includeFields: { type: 'string', description: 'Comma-separated extra response fields' },
    includeAllFields: { type: 'boolean', description: 'Return all fields in the response' },
    pageSize: { type: 'number', description: 'Results per page' },
    pageToken: { type: 'string', description: 'Page token from a previous response' },
  },

  outputs: {
    project: { type: 'json', description: 'A single project' },
    projects: { type: 'json', description: 'List of projects' },
    task: { type: 'json', description: 'A single task' },
    tasks: { type: 'json', description: 'List of tasks' },
    phase: { type: 'json', description: 'A single phase' },
    phases: { type: 'json', description: 'List of phases' },
    field: { type: 'json', description: 'A single custom field' },
    fields: { type: 'json', description: 'List of custom fields' },
    option: { type: 'json', description: 'A field option' },
    placeholders: { type: 'json', description: 'Project placeholders or placeholder mappings' },
    timeEntry: { type: 'json', description: 'A single time entry' },
    timeEntries: { type: 'json', description: 'List of time entries' },
    categories: { type: 'json', description: 'List of time entry categories' },
    timeOff: { type: 'json', description: 'A single time-off' },
    timeOffs: { type: 'json', description: 'List of time-offs' },
    user: { type: 'json', description: 'A single user' },
    users: { type: 'json', description: 'List of users' },
    space: { type: 'json', description: 'A single space' },
    spaces: { type: 'json', description: 'List of spaces' },
    spaceDocument: { type: 'json', description: 'A single space document' },
    spaceDocuments: { type: 'json', description: 'List of space documents' },
    allocations: { type: 'json', description: 'List of resource allocations' },
    invoice: { type: 'json', description: 'A single invoice' },
    invoices: { type: 'json', description: 'List of invoices' },
    lineItems: { type: 'json', description: 'Invoice line items' },
    payments: { type: 'json', description: 'Invoice payments' },
    pagination: { type: 'json', description: 'Pagination details for list results' },
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
    archived: { type: 'boolean', description: 'Whether the project was archived' },
    projectId: { type: 'number', description: 'ID of the archived or deleted project' },
    taskId: { type: 'number', description: 'ID of the deleted task' },
    phaseId: { type: 'number', description: 'ID of the deleted phase' },
    fieldId: { type: 'number', description: 'ID of the deleted field' },
    spaceId: { type: 'number', description: 'ID of the deleted space' },
    spaceDocumentId: { type: 'number', description: 'ID of the deleted space document' },
    timeEntryId: { type: 'number', description: 'ID of the deleted time entry' },
    timeOffId: { type: 'number', description: 'ID of the deleted time-off' },
  },
}

export const RocketlaneBlockMeta = {
  tags: ['project-management', 'automation'],
  url: 'https://www.rocketlane.com',
  templates: [
    {
      icon: RocketlaneIcon,
      title: 'Client onboarding kickoff',
      prompt:
        'Build a workflow that creates a Rocketlane project from an onboarding template for a new customer, assigns the implementation manager placeholder, adds the account team as members, and posts a kickoff summary with the project details to Slack.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['project-management', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RocketlaneIcon,
      title: 'Weekly project status digest',
      prompt:
        'Create a scheduled weekly workflow that lists active Rocketlane projects with their status and due dates, summarizes progress and anything overdue per customer, and emails the digest to the delivery team every Monday morning.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['project-management', 'reporting'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: RocketlaneIcon,
      title: 'Overdue task escalation',
      prompt:
        'Build a scheduled daily workflow that lists Rocketlane tasks with a due date before today that are not complete, marks them at risk, and posts an escalation to Slack tagging each task name, project, and assignees.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['project-management', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RocketlaneIcon,
      title: 'Time tracking rollup',
      prompt:
        'Create a scheduled weekly workflow that searches Rocketlane time entries for the past week, totals billable and non-billable minutes per project, and posts a formatted utilization rollup to Slack.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'operations',
      tags: ['time-tracking', 'reporting'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RocketlaneIcon,
      title: 'Invoice payment monitor',
      prompt:
        'Build a scheduled workflow that lists Rocketlane invoices with an outstanding amount greater than zero and a due date in the past, pulls their payments, and emails the finance team a list of overdue invoices with amounts outstanding.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'sales',
      tags: ['invoicing', 'automation'],
      alsoIntegrations: ['gmail'],
    },
    {
      icon: RocketlaneIcon,
      title: 'Resource allocation report',
      prompt:
        'Create a workflow that lists Rocketlane resource allocations for the next two weeks, writes each member, project, and allocation range into a table, and flags team members who appear in overlapping allocations.',
      modules: ['tables', 'agent', 'workflows'],
      category: 'operations',
      tags: ['resource-management', 'reporting'],
    },
    {
      icon: RocketlaneIcon,
      title: 'Timesheet reminder',
      prompt:
        'Build a scheduled Friday workflow that lists active Rocketlane team members, searches this week’s time entries per user, and sends a Slack reminder to anyone who has logged less than their expected hours.',
      modules: ['scheduled', 'agent', 'workflows'],
      category: 'productivity',
      tags: ['time-tracking', 'automation'],
      alsoIntegrations: ['slack'],
    },
    {
      icon: RocketlaneIcon,
      title: 'New project scaffolding',
      prompt:
        'Create a workflow that scaffolds a delivery project in Rocketlane: create the project, add Discovery, Implementation, and Go-live phases with dates, create kickoff tasks in each phase with assignees, and set up a shared space with a kickoff document.',
      modules: ['agent', 'workflows'],
      category: 'operations',
      tags: ['project-management', 'automation'],
    },
  ],
  skills: [
    {
      name: 'kickoff-onboarding-project',
      description:
        'Spin up a Rocketlane onboarding project from a template when a deal closes — create the project, apply the template, assign placeholders, and add the account team. Use for CRM-triggered kickoffs.',
      content:
        '# Kickoff Onboarding Project\n\nLaunch a client onboarding project in Rocketlane from a closed-won deal or intake request.\n\n## Steps\n1. Extract the customer company name, project name, owner, start date, and any template to apply from the request.\n2. Create the project with `create_project`, passing the customer company (enable auto-create if the company may not exist yet) and template sources so phases and tasks are scaffolded automatically. For an existing project, apply a plan with `import_template` instead.\n3. List the project placeholders with `list_placeholders` and map each one to a real person using `assign_placeholders` (by user ID or email).\n4. Add the delivery and account team with `add_project_members`, resolving people via `list_users` when only names are given.\n\n## Output\nReport the created project ID and name, which template was applied, placeholder assignments made, and the members added.',
    },
    {
      name: 'project-status-report',
      description:
        'Compile a delivery status report across Rocketlane projects — phases, task progress, overdue work, and at-risk items. Use for weekly digests and exec updates.',
      content:
        '# Project Status Report\n\nSummarize the health of one or more Rocketlane projects.\n\n## Steps\n1. Resolve the scope: a single project via `get_project`, or all active projects via `list_projects` (filter by status, customer, or due-date window; page with the returned page token until done or a sensible cap).\n2. For each project, pull `list_phases` for stage-level progress and `list_tasks` for task status, using due-date filters to isolate overdue or due-soon work.\n3. Group findings per project: current phase, tasks completed vs open, overdue tasks with assignees, and anything flagged at risk.\n\n## Output\nA per-project status summary — phase, progress counts, overdue items called out by name and owner — with an overall headline of projects on track vs slipping.',
    },
    {
      name: 'escalate-overdue-tasks',
      description:
        'Find overdue or slipping Rocketlane tasks, mark them at risk, and loop in the right people. Use for daily delivery hygiene automations.',
      content:
        '# Escalate Overdue Tasks\n\nCatch slipping work before it derails a project.\n\n## Steps\n1. Query `list_tasks` with a due-date-to filter of today (optionally scoped to a project or phase) to find tasks past their due date that are not complete.\n2. For each overdue task, set the at-risk flag with `update_task` so it is visible on the project plan.\n3. Add the project owner or delivery lead as a follower with `add_task_followers` so they get notified of further changes.\n4. Reassign stalled tasks when instructed, using `add_task_assignees` / `remove_task_assignees`.\n\n## Output\nList each escalated task with its project, assignees, days overdue, and the action taken (flagged, follower added, reassigned).',
    },
    {
      name: 'log-time-entry',
      description:
        'Record time in Rocketlane against a task, phase, project, or ad-hoc activity with the right category and billable flag. Use to log work from chat or other systems.',
      content:
        '# Log Time Entry\n\nCreate an accurate Rocketlane time entry from a natural-language description of work done.\n\n## Steps\n1. Extract the date, duration in minutes, what the time was spent on, and whether it is billable.\n2. Resolve the target: find the task with `list_tasks` (or the project/phase with `list_projects`/`list_phases`); for non-project work use an ad-hoc activity name instead.\n3. Match a category with `list_time_entry_categories` when the team uses categories.\n4. Create the entry with `create_time_entry` against exactly one source (task, project, phase, or activity), including notes and the billable flag. Fix mistakes with `update_time_entry`.\n\n## Output\nConfirm the logged entry: date, minutes, target, category, and billable state.',
    },
    {
      name: 'utilization-rollup',
      description:
        'Roll up Rocketlane time entries, allocations, and time-offs into a utilization picture per person or project. Use for capacity planning and weekly utilization reviews.',
      content:
        '# Utilization Rollup\n\nBuild a utilization and capacity snapshot for a date range.\n\n## Steps\n1. Pull logged time for the period with `search_time_entries` (filter by date range; page through results with the page token, keeping a sensible page cap).\n2. Total billable vs non-billable minutes per user and per project.\n3. Fetch planned capacity with `list_resource_allocations` for the same window and subtract `list_time_offs` to get true availability.\n4. Compare logged time against allocation to flag under-logged members and over-allocated ones.\n\n## Output\nA table-style rollup per person: allocated minutes, logged billable/non-billable minutes, time off, and a utilization percentage, plus any members flagged for follow-up.',
    },
    {
      name: 'overdue-invoice-followup',
      description:
        'Track Rocketlane invoices with outstanding balances past their due date and assemble follow-up details. Use for finance and collections automations.',
      content:
        '# Overdue Invoice Follow-up\n\nFind unpaid invoices and prepare a collections summary.\n\n## Steps\n1. Query `list_invoices` filtered to invoices with an outstanding amount greater than zero and a due date in the past.\n2. For each hit, fetch `get_invoice_payments` to confirm what has already been paid and `get_invoice_line_items` when the follow-up needs a breakdown.\n3. Sort by amount outstanding and days overdue so the largest, oldest balances lead.\n\n## Output\nA prioritized list of overdue invoices: invoice number, customer company, amount outstanding, days overdue, and payments received to date.',
    },
  ],
} as const satisfies BlockMeta
