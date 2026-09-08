import {
  deleteScimUserContract,
  getScimUserContract,
  patchScimUserContract,
  replaceScimUserContract,
} from '@/lib/api/contracts/scim'
import { deprovisionScimUser } from '@/ee/scim/lib/application/users/deprovision-user'
import { getScimUser } from '@/ee/scim/lib/application/users/read-users'
import { patchScimUser, replaceScimUser } from '@/ee/scim/lib/application/users/update-user'
import { toCanonicalUser } from '@/ee/scim/lib/protocol/canonical'
import { parseAttributeProjection } from '@/ee/scim/lib/protocol/resources'
import { defineScimRoute } from '@/ee/scim/lib/route'

/** One User resource. */

export const GET = defineScimRoute({
  contract: getScimUserContract,
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
  operation: replaceScimUser.operation,
  useCase: replaceScimUser,
  mapInput: ({ params, body }) => {
    return { scimUserId: params.id, attributes: toCanonicalUser(body) }
  },
  present: (result) => result.resource,
})

export const PATCH = defineScimRoute({
  contract: patchScimUserContract,
  operation: patchScimUser.operation,
  useCase: patchScimUser,
  mapInput: ({ params, body }) => ({ scimUserId: params.id, operations: body.Operations }),
  present: (result) => result.resource,
})

export const DELETE = defineScimRoute({
  contract: deleteScimUserContract,
  operation: deprovisionScimUser.operation,
  useCase: deprovisionScimUser,
  mapInput: ({ params }) => ({ scimUserId: params.id }),
})
