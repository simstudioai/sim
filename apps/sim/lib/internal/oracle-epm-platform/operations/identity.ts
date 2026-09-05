import type { OracleEpmPlatformOperationImplementations } from '@/lib/internal/oracle-epm-platform/operations'
import {
  groupReportSchema,
  groupsSchema,
  jsonBody,
  parseResponse,
  projectBatch,
  requireSuccess,
  roleReportSchema,
  rolesSchema,
  usersSchema,
} from '@/lib/internal/oracle-epm-platform/responses'
import { endpoints } from '@/lib/internal/oracle-epm-platform/routes'

export const identityOperations = {
  list_users: async (input, { client, signal }) => {
    const value = jsonBody(
      await client.request(endpoints.list_users, {
        json: {
          ...(input.userlogin === undefined ? {} : { userlogin: input.userlogin }),
          ...(input.userattribute === undefined ? {} : { userattribute: input.userattribute }),
          ...(input.epmgroups === undefined ? {} : { epmgroups: input.epmgroups }),
          ...(input.idcsgroups === undefined ? {} : { idcsgroups: input.idcsgroups }),
          ...(input.granularroles === undefined ? {} : { granularroles: input.granularroles }),
          ...(input.applicationroles === undefined
            ? {}
            : { applicationroles: input.applicationroles }),
          ...(input.indirect === undefined ? {} : { indirect: input.indirect }),
        },
        signal,
      })
    )
    return { ...requireSuccess(value), users: parseResponse(usersSchema, value).details }
  },
  list_groups: async (input, { client, signal }) => {
    const value = jsonBody(
      await client.request(endpoints.list_groups, {
        json: {
          ...(input.groupname === undefined ? {} : { groupname: input.groupname }),
          ...(input.members === undefined ? {} : { members: input.members }),
          ...(input.roles === undefined ? {} : { roles: input.roles }),
        },
        signal,
      })
    )
    return { ...requireSuccess(value), groups: parseResponse(groupsSchema, value).details }
  },
  list_roles: async (input, { client, signal }) => {
    const value = jsonBody(
      await client.request(endpoints.list_roles, {
        query: { type: input.type },
        signal,
      })
    )
    return { ...requireSuccess(value), roles: parseResponse(rolesSchema, value).details }
  },
  get_role_assignments: async (input, { client, signal }) => {
    const value = jsonBody(
      await client.request(endpoints.get_role_assignments, {
        query: {
          userlogin: input.userlogin,
          rolename: input.rolename,
          userattribute: input.userattribute,
        },
        signal,
      })
    )
    return { ...requireSuccess(value), assignments: parseResponse(roleReportSchema, value).details }
  },
  get_user_group_report: async (input, { client, signal }) => {
    const value = jsonBody(
      await client.request(endpoints.get_user_group_report, {
        query: {
          userlogin: input.userlogin,
          groupname: input.groupname,
          userattribute: input.userattribute,
        },
        signal,
      })
    )
    return { ...requireSuccess(value), users: parseResponse(groupReportSchema, value).details }
  },
  create_users: async (input, { client, signal }) =>
    projectBatch(
      jsonBody(
        await client.request(endpoints.create_users, {
          json: { users: input.users },
          signal,
        })
      )
    ),
  update_users: async (input, { client, signal }) =>
    projectBatch(
      jsonBody(
        await client.request(endpoints.update_users, {
          json: { users: input.users },
          signal,
        })
      )
    ),
  delete_users: async (input, { client, signal }) =>
    projectBatch(
      jsonBody(
        await client.request(endpoints.delete_users, {
          json: { users: input.users },
          signal,
        })
      )
    ),
  create_groups: async (input, { client, signal }) =>
    projectBatch(
      jsonBody(
        await client.request(endpoints.create_groups, {
          json: { groups: input.groups },
          signal,
        })
      )
    ),
  delete_groups: async (input, { client, signal }) =>
    projectBatch(
      jsonBody(
        await client.request(endpoints.delete_groups, {
          json: { groups: input.groups },
          signal,
        })
      )
    ),
  add_users_to_group: async (input, { client, signal }) =>
    projectBatch(
      jsonBody(
        await client.request(endpoints.add_users_to_group, {
          json: { groupname: input.groupname, users: input.users },
          signal,
        })
      )
    ),
  remove_users_from_group: async (input, { client, signal }) =>
    projectBatch(
      jsonBody(
        await client.request(endpoints.remove_users_from_group, {
          json: { groupname: input.groupname, users: input.users },
          signal,
        })
      )
    ),
  assign_role: async (input, { client, signal }) =>
    projectBatch(
      jsonBody(
        await client.request(endpoints.assign_role, {
          json: { rolename: input.rolename, users: input.users },
          signal,
        })
      )
    ),
  unassign_role: async (input, { client, signal }) =>
    projectBatch(
      jsonBody(
        await client.request(endpoints.unassign_role, {
          json: { rolename: input.rolename, users: input.users },
          signal,
        })
      )
    ),
} satisfies Pick<
  OracleEpmPlatformOperationImplementations,
  | 'list_users'
  | 'list_groups'
  | 'list_roles'
  | 'get_role_assignments'
  | 'get_user_group_report'
  | 'create_users'
  | 'update_users'
  | 'delete_users'
  | 'create_groups'
  | 'delete_groups'
  | 'add_users_to_group'
  | 'remove_users_from_group'
  | 'assign_role'
  | 'unassign_role'
>
