import type { OutputProperty, ToolResponse } from '@/tools/types'

export interface MicrosoftAdBaseParams {
  accessToken: string
}

export interface MicrosoftAdListUsersParams extends MicrosoftAdBaseParams {
  top?: number
  filter?: string
  search?: string
}

export interface MicrosoftAdGetUserParams extends MicrosoftAdBaseParams {
  userId: string
}

export interface MicrosoftAdCreateUserParams extends MicrosoftAdBaseParams {
  displayName: string
  mailNickname: string
  userPrincipalName: string
  password: string
  accountEnabled: boolean
  givenName?: string
  surname?: string
  jobTitle?: string
  department?: string
  officeLocation?: string
  mobilePhone?: string
}

export interface MicrosoftAdUpdateUserParams extends MicrosoftAdBaseParams {
  userId: string
  displayName?: string
  givenName?: string
  surname?: string
  jobTitle?: string
  department?: string
  officeLocation?: string
  mobilePhone?: string
  accountEnabled?: boolean
}

export interface MicrosoftAdDeleteUserParams extends MicrosoftAdBaseParams {
  userId: string
}

export interface MicrosoftAdListGroupsParams extends MicrosoftAdBaseParams {
  top?: number
  filter?: string
  search?: string
}

export interface MicrosoftAdGetGroupParams extends MicrosoftAdBaseParams {
  groupId: string
}

export interface MicrosoftAdCreateGroupParams extends MicrosoftAdBaseParams {
  displayName: string
  mailNickname: string
  description?: string
  mailEnabled: boolean
  securityEnabled: boolean
  groupTypes?: string
  visibility?: string
}

export interface MicrosoftAdUpdateGroupParams extends MicrosoftAdBaseParams {
  groupId: string
  displayName?: string
  description?: string
  mailNickname?: string
  visibility?: string
}

export interface MicrosoftAdDeleteGroupParams extends MicrosoftAdBaseParams {
  groupId: string
}

export interface MicrosoftAdListGroupMembersParams extends MicrosoftAdBaseParams {
  groupId: string
  top?: number
}

export interface MicrosoftAdAddGroupMemberParams extends MicrosoftAdBaseParams {
  groupId: string
  memberId: string
}

export interface MicrosoftAdRemoveGroupMemberParams extends MicrosoftAdBaseParams {
  groupId: string
  memberId: string
}

export const USER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'User ID' },
  displayName: { type: 'string', description: 'Display name' },
  givenName: { type: 'string', description: 'First name' },
  surname: { type: 'string', description: 'Last name' },
  userPrincipalName: { type: 'string', description: 'User principal name (email)' },
  mail: { type: 'string', description: 'Email address' },
  jobTitle: { type: 'string', description: 'Job title' },
  department: { type: 'string', description: 'Department' },
  officeLocation: { type: 'string', description: 'Office location' },
  mobilePhone: { type: 'string', description: 'Mobile phone number' },
  accountEnabled: { type: 'boolean', description: 'Whether the account is enabled' },
} as const satisfies Record<string, OutputProperty>

export const GROUP_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Group ID' },
  displayName: { type: 'string', description: 'Display name' },
  description: { type: 'string', description: 'Group description' },
  mail: { type: 'string', description: 'Email address' },
  mailEnabled: { type: 'boolean', description: 'Whether mail is enabled' },
  mailNickname: { type: 'string', description: 'Mail nickname' },
  securityEnabled: { type: 'boolean', description: 'Whether security is enabled' },
  groupTypes: { type: 'array', description: 'Group types' },
  visibility: { type: 'string', description: 'Group visibility' },
  createdDateTime: { type: 'string', description: 'Creation date' },
} as const satisfies Record<string, OutputProperty>

export const MEMBER_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Member ID' },
  displayName: { type: 'string', description: 'Display name' },
  mail: { type: 'string', description: 'Email address' },
  odataType: { type: 'string', description: 'Directory object type' },
} as const satisfies Record<string, OutputProperty>

export interface MicrosoftAdListUsersResponse extends ToolResponse {
  output: {
    users: Array<Record<string, unknown>>
    userCount: number
  }
}

export interface MicrosoftAdGetUserResponse extends ToolResponse {
  output: {
    user: Record<string, unknown>
  }
}

export interface MicrosoftAdCreateUserResponse extends ToolResponse {
  output: {
    user: Record<string, unknown>
  }
}

export interface MicrosoftAdUpdateUserResponse extends ToolResponse {
  output: {
    updated: boolean
    userId: string
  }
}

export interface MicrosoftAdDeleteUserResponse extends ToolResponse {
  output: {
    deleted: boolean
    userId: string
  }
}

export interface MicrosoftAdListGroupsResponse extends ToolResponse {
  output: {
    groups: Array<Record<string, unknown>>
    groupCount: number
  }
}

export interface MicrosoftAdGetGroupResponse extends ToolResponse {
  output: {
    group: Record<string, unknown>
  }
}

export interface MicrosoftAdCreateGroupResponse extends ToolResponse {
  output: {
    group: Record<string, unknown>
  }
}

export interface MicrosoftAdUpdateGroupResponse extends ToolResponse {
  output: {
    updated: boolean
    groupId: string
  }
}

export interface MicrosoftAdDeleteGroupResponse extends ToolResponse {
  output: {
    deleted: boolean
    groupId: string
  }
}

export interface MicrosoftAdListGroupMembersResponse extends ToolResponse {
  output: {
    members: Array<Record<string, unknown>>
    memberCount: number
  }
}

export interface MicrosoftAdAddGroupMemberResponse extends ToolResponse {
  output: {
    added: boolean
    groupId: string
    memberId: string
  }
}

export interface MicrosoftAdRemoveGroupMemberResponse extends ToolResponse {
  output: {
    removed: boolean
    groupId: string
    memberId: string
  }
}

export type MicrosoftAdResponse =
  | MicrosoftAdListUsersResponse
  | MicrosoftAdGetUserResponse
  | MicrosoftAdCreateUserResponse
  | MicrosoftAdUpdateUserResponse
  | MicrosoftAdDeleteUserResponse
  | MicrosoftAdListGroupsResponse
  | MicrosoftAdGetGroupResponse
  | MicrosoftAdCreateGroupResponse
  | MicrosoftAdUpdateGroupResponse
  | MicrosoftAdDeleteGroupResponse
  | MicrosoftAdListGroupMembersResponse
  | MicrosoftAdAddGroupMemberResponse
  | MicrosoftAdRemoveGroupMemberResponse
