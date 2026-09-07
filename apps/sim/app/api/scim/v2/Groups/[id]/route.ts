import {
  deleteScimGroupContract,
  getScimGroupContract,
  patchScimGroupContract,
  replaceScimGroupContract,
} from '@/lib/api/contracts/scim'
import {
  deleteScimGroupUseCase,
  getScimGroup,
  patchScimGroup,
  replaceScimGroup,
} from '@/lib/scim/application/groups/manage-groups'
import { assertGroupSchemas, toCanonicalGroup } from '@/lib/scim/protocol/canonical'
import { parseAttributeProjection } from '@/lib/scim/protocol/resources'
import { defineScimRoute } from '@/lib/scim/route'

/** One Group resource. */

export const GET = defineScimRoute({
  contract: getScimGroupContract,
  scope: 'groups:read',
  operation: getScimGroup.operation,
  useCase: getScimGroup,
  mapInput: ({ params, query }) => ({
    groupId: params.id,
    projection: parseAttributeProjection(query),
  }),
  present: (resource) => resource,
})

export const PUT = defineScimRoute({
  contract: replaceScimGroupContract,
  scope: 'groups:write',
  operation: replaceScimGroup.operation,
  useCase: replaceScimGroup,
  mapInput: ({ params, body }) => {
    assertGroupSchemas(body.schemas)
    return { groupId: params.id, group: toCanonicalGroup(body) }
  },
  present: (result) => result.resource,
})

/** Answers 204: Microsoft asks that a group patch not echo the member list. */
export const PATCH = defineScimRoute({
  contract: patchScimGroupContract,
  scope: 'groups:write',
  operation: patchScimGroup.operation,
  useCase: patchScimGroup,
  mapInput: ({ params, body }) => ({ groupId: params.id, operations: body.Operations }),
})

export const DELETE = defineScimRoute({
  contract: deleteScimGroupContract,
  scope: 'groups:write',
  operation: deleteScimGroupUseCase.operation,
  useCase: deleteScimGroupUseCase,
  mapInput: ({ params }) => ({ groupId: params.id }),
})
