import type { ToolResponse } from '@/tools/types'

export type ArenaCreateTaskParams = {
  operation: string
  'task-name': string
  'task-description': string
  'planned-start-date': Date
  'planned-end-date': Date
  'task-type': string
  'task-client': {
    clientId: string
    name: string
  }
  'task-project': string
  'task-group'?: {
    id: string
    name: string
  }
  'task-task'?: string
  'task-assignee': string
  _context: {
    workflowId: string
  }
}

export interface ArenaCreateTaskResponse extends ToolResponse {}

export interface SearchTaskResponse extends ToolResponse {}

export interface SearchTaskApiResponse {
  errors: string | null
  errorMessage: string | null
  pagination: {
    totalRecords: number
    totalPages: number
    recordsPerPage: number
    pageNumber: number
    pageSize: number
    startRange: number
    endRange: number
  }
  tasks: Task[]
}
export interface SearchTaskQueryParams {
  operation: string
  'search-task-name': string
  'search-task-client': {
    clientId: string
    name: string
  }
  'search-task-project': string
  'search-task-state': string[]
  'search-task-visibility': string
  'search-task-assignee': string
  'search-task-due-date': string
  'search-task-max-results': number
  _context: {
    workflowId: string
  }
}

export interface Task {
  errors: string | null
  errorMessage: string | null
  name: string
  id: string
  type: string
  description: string | null
  deliverable: string | null
  remarks: string | null
  status: string
  groupName: string | null
  projectName: string | null
  clientName: string | null
  clientId: string | null
  additionalAssignee: string | null
  assignedToId: string | null
  assignedBy: string | null
  additionalAssignees: string[]
  assignedTo: string | null
  state: string | null
  department: string | null
  sysId: string
  deliverableTasks: string | null
  module: string | null
  moduleId: string | null
  customerId: string | null
  businessService: string | null
  projectId: string | null
  actionType: string | null
  showArena: boolean
  relatedItemType: string | null
  workFlowSysId: string | null
  fromClientRequest: {
    requestId: string | null
    requestSysId: string | null
    requestName: string | null
  }[]
  priority: string | null
  arenaState: string
  details: string | null
  estimatedStart: string | null
  estimatedEnd: string | null
  plannedStart: string | null
  plannedEnd: string | null
  plannedDuration: string | null
  plannedEffort: string | null
  allocatedEffort: string | null
  actualEffort: string | null
  changeInProgress: string | null
  taskType: string | null
  outOfScope: string | null
  ownerId: string | null
  watchList: string | null
  taskList: string | null
  key: string | null
  messageUpdatedTs: string | null
  favorite: string | null
  incidentId: string | null
  closedBy: string | null
  closedAt: string | null
  taskHtmlDescription: string | null
  taskrequest: string | null
  messageCommentUpdatedTs: string | null
  messageAttachmentUpdatedTs: string | null
  documentLink: string | null
  qcLink: string | null
  workFlowStage: string | null
  project: string | null
  epicId: string | null
  epicName: string | null
  ownerName: string | null
  createdBy: string | null
  plannedStartDate: string | null
  plannedEndDate: string | null
  arenaStatus: string | null
  completionDate: string | null
  recurring: boolean
  recurringData: string | null
  document: string | null
  extraData: Record<string, unknown>
  deliverableId: string | null
  checkListItems: string | null
  checkList: string | null
  catalogId: string | null
  catalogName: string | null
  stateManagementId: string | null
  stateManagementName: string | null
  versionType: string | null
  catalogStateId: string | null
  catalogStateName: string | null
  taskNumber: string | null
  archived: string | null
  typeDeliverable: boolean
}