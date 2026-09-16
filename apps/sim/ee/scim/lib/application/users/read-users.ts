import { db } from '@sim/db'
import {
  defineAuthorizedScimUseCase,
  type ScimUseCaseArgs,
} from '@/ee/scim/lib/application/authorized-scim-use-case'
import { scimOperations } from '@/ee/scim/lib/application/operations'
import { notFound } from '@/ee/scim/lib/protocol/errors'
import { parseUserFilter } from '@/ee/scim/lib/protocol/filter'
import {
  projectionWants,
  projectResource,
  resolvePage,
  type ScimAttributeProjection,
  toUserResource,
} from '@/ee/scim/lib/protocol/resources'
import {
  findScimUserById,
  loadGroupsForScimUsers,
  pageScimUsers,
  toUserResourceRow,
} from '@/ee/scim/lib/repository/users'

export interface ListScimUsersInput {
  filter?: string | undefined
  startIndex?: number | undefined
  count?: number | undefined
  projection: ScimAttributeProjection
}

export const listScimUsers = defineAuthorizedScimUseCase({
  operation: scimOperations.listUsers,
  async execute({ input, context }: ScimUseCaseArgs<ListScimUsersInput>) {
    const page = resolvePage({ startIndex: input.startIndex, count: input.count })
    const filters = input.filter ? parseUserFilter(input.filter) : []

    const { records, totalResults } = await pageScimUsers(db, {
      connectionId: context.connection.id,
      filters,
      offset: page.offset,
      limit: page.count,
    })

    /**
     * The group join is skipped when the request excluded `groups`. Microsoft
     * Entra pages every user on an initial cycle, so avoiding a per-page join it
     * did not ask for is the difference between one query and two at scale.
     */
    const wantsGroups = projectionWants(input.projection, 'groups')
    const groupsByUser = wantsGroups
      ? await loadGroupsForScimUsers(
          db,
          records.map((record) => record.id)
        )
      : new Map<string, Array<{ id: string; displayName: string }>>()

    const resources = records.map((record) =>
      projectResource(
        toUserResource(
          toUserResourceRow(record, groupsByUser.get(record.id) ?? []),
          context.baseUrl
        ),
        input.projection
      )
    )

    return { resources, totalResults, startIndex: page.startIndex }
  },
})

export interface GetScimUserInput {
  scimUserId: string
  projection: ScimAttributeProjection
}

export const getScimUser = defineAuthorizedScimUseCase({
  operation: scimOperations.readUser,
  async execute({ input, context }: ScimUseCaseArgs<GetScimUserInput>) {
    const record = await findScimUserById(db, context.connection.id, input.scimUserId)
    /**
     * A resource belonging to another connection is reported as absent rather
     * than forbidden. Distinguishing the two would confirm that an id exists in
     * some other tenant.
     */
    if (!record) throw notFound('SCIM User not found')

    const groups = projectionWants(input.projection, 'groups')
      ? ((await loadGroupsForScimUsers(db, [record.id])).get(record.id) ?? [])
      : []

    return projectResource(
      toUserResource(toUserResourceRow(record, groups), context.baseUrl),
      input.projection
    )
  },
})
