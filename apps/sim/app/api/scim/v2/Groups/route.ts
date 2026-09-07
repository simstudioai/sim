import { createScimGroupContract, listScimGroupsContract } from '@/lib/api/contracts/scim'
import { createScimGroup, listScimGroups } from '@/lib/scim/application/groups/manage-groups'
import { assertGroupSchemas, toCanonicalGroup } from '@/lib/scim/protocol/canonical'
import { parseAttributeProjection, toListResponse } from '@/lib/scim/protocol/resources'
import { defineScimRoute } from '@/lib/scim/route'

/** The Group collection. */

export const GET = defineScimRoute({
  contract: listScimGroupsContract,
  scope: 'groups:read',
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
  scope: 'groups:write',
  operation: createScimGroup.operation,
  useCase: createScimGroup,
  mapInput: ({ body }) => {
    assertGroupSchemas(body.schemas)
    return { group: toCanonicalGroup(body) }
  },
  present: (result) => result.resource,
  headers: (result, { baseUrl }) => ({ Location: `${baseUrl}/Groups/${result.groupId}` }),
})
