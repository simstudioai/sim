import type { ToolResponse } from '@/tools/types'

export interface RipplingListEmployeesParams {
  apiKey: string
  limit?: number
  offset?: number
}

export interface RipplingGetEmployeeParams {
  apiKey: string
  employeeId: string
}

export interface RipplingListDepartmentsParams {
  apiKey: string
  limit?: number
  offset?: number
}

export interface RipplingGetCurrentUserParams {
  apiKey: string
}

export interface RipplingEmployee {
  id: string
  firstName: string | null
  lastName: string | null
  workEmail: string | null
  personalEmail: string | null
  roleState: string | null
  department: string | null
  title: string | null
  startDate: string | null
  endDate: string | null
  manager: string | null
  phone: string | null
}

export interface RipplingDepartment {
  id: string
  name: string | null
  parent: string | null
}

export interface RipplingListEmployeesResponse extends ToolResponse {
  output: {
    employees: RipplingEmployee[]
    totalCount: number
  }
}

export interface RipplingGetEmployeeResponse extends ToolResponse {
  output: RipplingEmployee
}

export interface RipplingListDepartmentsResponse extends ToolResponse {
  output: {
    departments: RipplingDepartment[]
    totalCount: number
  }
}

export interface RipplingGetCurrentUserResponse extends ToolResponse {
  output: {
    id: string
    workEmail: string | null
    company: string | null
  }
}

export interface RipplingGetCompanyParams {
  apiKey: string
}

export interface RipplingCompanyAddress {
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
}

export interface RipplingGetCompanyResponse extends ToolResponse {
  output: {
    id: string
    name: string | null
    address: RipplingCompanyAddress
    email: string | null
    phone: string | null
    workLocations: string[]
  }
}

export interface RipplingListCustomFieldsParams {
  apiKey: string
  limit?: number
  offset?: number
}

export interface RipplingCustomField {
  id: string
  type: string | null
  title: string | null
  mandatory: boolean
}

export interface RipplingListCustomFieldsResponse extends ToolResponse {
  output: {
    customFields: RipplingCustomField[]
    totalCount: number
  }
}

export interface RipplingListLevelsParams {
  apiKey: string
  limit?: number
  offset?: number
}

export interface RipplingLevel {
  id: string
  name: string | null
  parent: string | null
}

export interface RipplingListLevelsResponse extends ToolResponse {
  output: {
    levels: RipplingLevel[]
    totalCount: number
  }
}

export interface RipplingListTeamsParams {
  apiKey: string
  limit?: number
  offset?: number
}

export interface RipplingTeam {
  id: string
  name: string | null
  parent: string | null
}

export interface RipplingListTeamsResponse extends ToolResponse {
  output: {
    teams: RipplingTeam[]
    totalCount: number
  }
}

export interface RipplingListWorkLocationsParams {
  apiKey: string
  limit?: number
  offset?: number
}

export interface RipplingWorkLocation {
  id: string
  nickname: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
}

export interface RipplingListWorkLocationsResponse extends ToolResponse {
  output: {
    workLocations: RipplingWorkLocation[]
    totalCount: number
  }
}

export interface RipplingGetCompanyActivityParams {
  apiKey: string
  startDate?: string
  endDate?: string
  limit?: number
  next?: string
}

export interface RipplingActivityActor {
  id: string | null
  name: string | null
}

export interface RipplingActivityEvent {
  id: string
  type: string | null
  description: string | null
  createdAt: string | null
  actor: RipplingActivityActor
}

export interface RipplingGetCompanyActivityResponse extends ToolResponse {
  output: {
    events: RipplingActivityEvent[]
    totalCount: number
    nextCursor: string | null
  }
}

export interface RipplingListEmployeesWithTerminatedParams {
  apiKey: string
  limit?: number
  offset?: number
}

export interface RipplingListEmployeesWithTerminatedResponse extends ToolResponse {
  output: {
    employees: RipplingEmployee[]
    totalCount: number
  }
}

export interface RipplingCreateGroupParams {
  apiKey: string
  name: string
  spokeId: string
  users?: string[]
}

export interface RipplingGroup {
  id: string
  name: string | null
  spokeId: string | null
  users: string[]
  version: number | null
}

export interface RipplingCreateGroupResponse extends ToolResponse {
  output: RipplingGroup
}

export interface RipplingUpdateGroupParams {
  apiKey: string
  groupId: string
  name?: string
  spokeId?: string
  users?: string[]
  version?: number
}

export interface RipplingUpdateGroupResponse extends ToolResponse {
  output: RipplingGroup
}

export interface RipplingPushCandidateParams {
  apiKey: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  jobTitle?: string
  department?: string
  startDate?: string
}

export interface RipplingPushCandidateResponse extends ToolResponse {
  output: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string | null
    status: string | null
  }
}

export interface RipplingListLeaveRequestsParams {
  apiKey: string
  startDate?: string
  endDate?: string
  status?: string
}

export interface RipplingLeaveRequest {
  id: string
  requestedBy: string
  status: string
  startDate: string
  endDate: string
  reason: string | null
  leaveType: string | null
  createdAt: string | null
}

export interface RipplingListLeaveRequestsResponse extends ToolResponse {
  output: {
    leaveRequests: RipplingLeaveRequest[]
    totalCount: number
  }
}

export interface RipplingProcessLeaveRequestParams {
  apiKey: string
  leaveRequestId: string
  action: string
}

export interface RipplingProcessLeaveRequestResponse extends ToolResponse {
  output: {
    id: string
    status: string
    requestedBy: string
    startDate: string
    endDate: string
  }
}

export interface RipplingListLeaveBalancesParams {
  apiKey: string
  limit?: number
  offset?: number
}

export interface RipplingLeaveBalanceEntry {
  leaveType: string
  minutesRemaining: number
}

export interface RipplingLeaveBalance {
  employeeId: string
  balances: RipplingLeaveBalanceEntry[]
}

export interface RipplingListLeaveBalancesResponse extends ToolResponse {
  output: {
    leaveBalances: RipplingLeaveBalance[]
    totalCount: number
  }
}

export interface RipplingGetLeaveBalanceParams {
  apiKey: string
  roleId: string
}

export interface RipplingGetLeaveBalanceResponse extends ToolResponse {
  output: {
    employeeId: string
    balances: RipplingLeaveBalanceEntry[]
  }
}

export interface RipplingListLeaveTypesParams {
  apiKey: string
  managedBy?: string
}

export interface RipplingLeaveType {
  id: string
  name: string
  managedBy: string | null
}

export interface RipplingListLeaveTypesResponse extends ToolResponse {
  output: {
    leaveTypes: RipplingLeaveType[]
    totalCount: number
  }
}
