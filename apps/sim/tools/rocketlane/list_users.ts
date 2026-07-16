import {
  mapPagination,
  mapUser,
  PAGINATION_OUTPUT_PROPERTIES,
  ROCKETLANE_API_BASE,
  type RocketlaneListUsersParams,
  type RocketlaneListUsersResponse,
  rocketlaneError,
  rocketlaneHeaders,
  USER_OUTPUT_PROPERTIES,
} from '@/tools/rocketlane/types'
import type { ToolConfig } from '@/tools/types'

export const rocketlaneListUsersTool: ToolConfig<
  RocketlaneListUsersParams,
  RocketlaneListUsersResponse
> = {
  id: 'rocketlane_list_users',
  name: 'Rocketlane List Users',
  description:
    'List users in your Rocketlane account, with optional filters, sorting, and pagination',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rocketlane API key',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of users per page (defaults to 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous request (valid for 15 minutes)',
    },
    includeFields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated extra fields to include: role, company, permission, holidayCalendar, capacityInMinutes, profilePictureUrl',
    },
    includeAllFields: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to include all fields in the response',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field to sort by: email, firstName, lastName, type, status, or capacityInMinutes',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: ASC or DESC (defaults to DESC)',
    },
    match: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'How to combine filters: all (AND) or any (OR); defaults to all',
    },
    firstNameEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users whose first name exactly matches this value',
    },
    firstNameCn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users whose first name contains this value',
    },
    firstNameNc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude users whose first name contains this value',
    },
    lastNameEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users whose last name exactly matches this value',
    },
    lastNameCn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users whose last name contains this value',
    },
    lastNameNc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude users whose last name contains this value',
    },
    emailEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users whose email exactly matches this value',
    },
    emailCn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users whose email contains this value',
    },
    emailNc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude users whose email contains this value',
    },
    statusEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users with this status: INACTIVE, INVITED, ACTIVE, or PASSIVE',
    },
    statusOneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated statuses; only include users matching one of them (INACTIVE, INVITED, ACTIVE, PASSIVE)',
    },
    statusNoneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated statuses; exclude users matching any of them (INACTIVE, INVITED, ACTIVE, PASSIVE)',
    },
    typeEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only include users of this type: TEAM_MEMBER, PARTNER, CUSTOMER, or EXTERNAL_PARTNER',
    },
    typeOneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated types; only include users matching one of them (TEAM_MEMBER, PARTNER, CUSTOMER, EXTERNAL_PARTNER)',
    },
    roleIdEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users with this role ID',
    },
    roleIdOneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated role IDs; only include users matching one of them',
    },
    roleIdNoneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated role IDs; exclude users matching any of them',
    },
    permissionIdEq: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users with this permission ID',
    },
    permissionIdOneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated permission IDs; only include users matching one of them',
    },
    permissionIdNoneOf: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated permission IDs; exclude users matching any of them',
    },
    capacityInMinutesEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users whose capacity in minutes equals this value',
    },
    capacityInMinutesGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users whose capacity in minutes is greater than this value',
    },
    capacityInMinutesGe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only include users whose capacity in minutes is greater than or equal to this value',
    },
    capacityInMinutesLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users whose capacity in minutes is less than this value',
    },
    capacityInMinutesLe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only include users whose capacity in minutes is less than or equal to this value',
    },
    createdAtGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users created after this time (epoch millis)',
    },
    createdAtEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users created at exactly this time (epoch millis)',
    },
    createdAtLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users created before this time (epoch millis)',
    },
    createdAtGe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users created at or after this time (epoch millis)',
    },
    createdAtLe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users created at or before this time (epoch millis)',
    },
    updatedAtGt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users updated after this time (epoch millis)',
    },
    updatedAtEq: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users updated at exactly this time (epoch millis)',
    },
    updatedAtLt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users updated before this time (epoch millis)',
    },
    updatedAtGe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users updated at or after this time (epoch millis)',
    },
    updatedAtLe: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include users updated at or before this time (epoch millis)',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${ROCKETLANE_API_BASE}/users`)
      if (params.pageSize != null) url.searchParams.set('pageSize', String(params.pageSize))
      if (params.pageToken) url.searchParams.set('pageToken', params.pageToken)
      if (params.includeFields) url.searchParams.set('includeFields', params.includeFields)
      if (params.includeAllFields != null)
        url.searchParams.set('includeAllFields', String(params.includeAllFields))
      if (params.sortBy) url.searchParams.set('sortBy', params.sortBy)
      if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder)
      if (params.match) url.searchParams.set('match', params.match)
      if (params.firstNameEq) url.searchParams.set('firstName.eq', params.firstNameEq)
      if (params.firstNameCn) url.searchParams.set('firstName.cn', params.firstNameCn)
      if (params.firstNameNc) url.searchParams.set('firstName.nc', params.firstNameNc)
      if (params.lastNameEq) url.searchParams.set('lastName.eq', params.lastNameEq)
      if (params.lastNameCn) url.searchParams.set('lastName.cn', params.lastNameCn)
      if (params.lastNameNc) url.searchParams.set('lastName.nc', params.lastNameNc)
      if (params.emailEq) url.searchParams.set('email.eq', params.emailEq)
      if (params.emailCn) url.searchParams.set('email.cn', params.emailCn)
      if (params.emailNc) url.searchParams.set('email.nc', params.emailNc)
      if (params.statusEq) url.searchParams.set('status.eq', params.statusEq)
      if (params.statusOneOf) url.searchParams.set('status.oneOf', params.statusOneOf)
      if (params.statusNoneOf) url.searchParams.set('status.noneOf', params.statusNoneOf)
      if (params.typeEq) url.searchParams.set('type.eq', params.typeEq)
      if (params.typeOneOf) url.searchParams.set('type.oneOf', params.typeOneOf)
      if (params.roleIdEq) url.searchParams.set('roleId.eq', params.roleIdEq)
      if (params.roleIdOneOf) url.searchParams.set('roleId.oneOf', params.roleIdOneOf)
      if (params.roleIdNoneOf) url.searchParams.set('roleId.noneOf', params.roleIdNoneOf)
      if (params.permissionIdEq) url.searchParams.set('permissionId.eq', params.permissionIdEq)
      if (params.permissionIdOneOf)
        url.searchParams.set('permissionId.oneOf', params.permissionIdOneOf)
      if (params.permissionIdNoneOf)
        url.searchParams.set('permissionId.noneOf', params.permissionIdNoneOf)
      if (params.capacityInMinutesEq != null)
        url.searchParams.set('capacityInMinutes.eq', String(params.capacityInMinutesEq))
      if (params.capacityInMinutesGt != null)
        url.searchParams.set('capacityInMinutes.gt', String(params.capacityInMinutesGt))
      if (params.capacityInMinutesGe != null)
        url.searchParams.set('capacityInMinutes.ge', String(params.capacityInMinutesGe))
      if (params.capacityInMinutesLt != null)
        url.searchParams.set('capacityInMinutes.lt', String(params.capacityInMinutesLt))
      if (params.capacityInMinutesLe != null)
        url.searchParams.set('capacityInMinutes.le', String(params.capacityInMinutesLe))
      if (params.createdAtGt != null)
        url.searchParams.set('createdAt.gt', String(params.createdAtGt))
      if (params.createdAtEq != null)
        url.searchParams.set('createdAt.eq', String(params.createdAtEq))
      if (params.createdAtLt != null)
        url.searchParams.set('createdAt.lt', String(params.createdAtLt))
      if (params.createdAtGe != null)
        url.searchParams.set('createdAt.ge', String(params.createdAtGe))
      if (params.createdAtLe != null)
        url.searchParams.set('createdAt.le', String(params.createdAtLe))
      if (params.updatedAtGt != null)
        url.searchParams.set('updatedAt.gt', String(params.updatedAtGt))
      if (params.updatedAtEq != null)
        url.searchParams.set('updatedAt.eq', String(params.updatedAtEq))
      if (params.updatedAtLt != null)
        url.searchParams.set('updatedAt.lt', String(params.updatedAtLt))
      if (params.updatedAtGe != null)
        url.searchParams.set('updatedAt.ge', String(params.updatedAtGe))
      if (params.updatedAtLe != null)
        url.searchParams.set('updatedAt.le', String(params.updatedAtLe))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => rocketlaneHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await rocketlaneError(response))
    }
    const data = await response.json()
    const users = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        users: users.map(mapUser),
        pagination: mapPagination(data?.pagination),
      },
    }
  },

  outputs: {
    users: {
      type: 'array',
      description: 'List of users',
      items: { type: 'object', properties: USER_OUTPUT_PROPERTIES },
    },
    pagination: {
      type: 'object',
      description: 'Pagination details',
      properties: PAGINATION_OUTPUT_PROPERTIES,
    },
  },
}
