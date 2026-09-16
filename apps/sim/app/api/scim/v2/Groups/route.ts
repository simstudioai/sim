import { createScimGroupContract, listScimGroupsContract } from '@/lib/api/contracts/scim'
import { createScimGroup, listScimGroups } from '@/ee/scim/lib/application/groups/manage-groups'
import { toCanonicalGroup } from '@/ee/scim/lib/protocol/canonical'
import { parseAttributeProjection, toListResponse } from '@/ee/scim/lib/protocol/resources'
import { defineScimRoute } from '@/ee/scim/lib/route'

/** The Group collection. */

export const GET = defineScimRoute({
  contract: listScimGroupsContract,
  operation: listScimGroups.operation,
  useCase: listScimGroups,
  mapInput: ({ query }) => ({
    filter: query.filter,
    startIndex: query.startIndex,
    count: query.count,
    projection: parseAttributeProjection(query),
  }),
  present: (result) => toListResponse(result.resources, result.totalResults, result.startIndex),
})

export const POST = defineScimRoute({
  contract: createScimGroupContract,
  operation: createScimGroup.operation,
  useCase: createScimGroup,
  mapInput: ({ body }) => {
    return { group: toCanonicalGroup(body) }
  },
  present: (result) => result.resource,
  headers: (result, { baseUrl }) => ({ Location: `${baseUrl}/Groups/${result.groupId}` }),
})
