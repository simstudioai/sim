import {
  deleteScimUserContract,
  getScimUserContract,
  patchScimUserContract,
  replaceScimUserContract,
} from '@/lib/api/contracts/scim'
import { deprovisionScimUser } from '@/lib/scim/application/users/deprovision-user'
import { getScimUser } from '@/lib/scim/application/users/read-users'
import { patchScimUser, replaceScimUser } from '@/lib/scim/application/users/update-user'
import { assertUserSchemas, toCanonicalUser } from '@/lib/scim/protocol/canonical'
import { parseAttributeProjection } from '@/lib/scim/protocol/resources'
import { defineScimRoute } from '@/lib/scim/route'

/** One User resource. */

export const GET = defineScimRoute({
  contract: getScimUserContract,
  scope: 'users:read',
  operation: getScimUser.operation,
  useCase: getScimUser,
  mapInput: ({ params, query }) => ({
    scimUserId: params.id,
    projection: parseAttributeProjection(query),
  }),
  present: (resource) => resource,
})

export const PUT = defineScimRoute({
  contract: replaceScimUserContract,
  scope: 'users:write',
  operation: replaceScimUser.operation,
  useCase: replaceScimUser,
  mapInput: ({ params, body }) => {
    assertUserSchemas(body.schemas)
    return { scimUserId: params.id, attributes: toCanonicalUser(body) }
  },
  present: (result) => result.resource,
})

export const PATCH = defineScimRoute({
  contract: patchScimUserContract,
  scope: 'users:write',
  operation: patchScimUser.operation,
  useCase: patchScimUser,
  mapInput: ({ params, body }) => ({ scimUserId: params.id, operations: body.Operations }),
  present: (result) => result.resource,
})

export const DELETE = defineScimRoute({
  contract: deleteScimUserContract,
  scope: 'users:write',
  operation: deprovisionScimUser.operation,
  useCase: deprovisionScimUser,
  mapInput: ({ params }) => ({ scimUserId: params.id }),
})
