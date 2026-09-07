import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_MAX_GROUP_MEMBERS,
  SCIM_MAX_PATCH_OPERATIONS,
  SCIM_PATCH_OP_SCHEMA,
} from '@/lib/scim/protocol/constants'
import { normalizeScimBoolean, unwrapSingleElement } from '@/lib/scim/protocol/normalize'

/**
 * Wire schemas for the SCIM 2.0 surface.
 *
 * Inbound shapes are deliberately tolerant. RFC 7643 defines far more than Sim
 * models, and a provider that sends an attribute this server does not store must
 * still get its write accepted — so object schemas pass unknown keys through
 * rather than stripping or rejecting them, and the canonicalizer decides what is
 * kept. Outbound shapes are strict and drive the route builder's response
 * validation.
 */

/** Accepts the string booleans Microsoft Entra's classic provisioning job sends. */
const scimBoolean = z.preprocess(
  (value) => normalizeScimBoolean(unwrapSingleElement(value)),
  z.boolean()
)

const scimEmailSchema = z.looseObject({
  value: z.string().trim().min(1, 'An email entry requires a value').max(320),
  type: z.string().max(64).optional(),
  primary: scimBoolean.optional(),
})

const scimNameSchema = z.looseObject({
  formatted: z.string().max(256).optional(),
  givenName: z.string().max(128).optional(),
  familyName: z.string().max(128).optional(),
})

const scimEnterpriseSchema = z.looseObject({
  department: z.string().max(256).optional(),
  employeeNumber: z.string().max(128).optional(),
  costCenter: z.string().max(128).optional(),
  division: z.string().max(128).optional(),
  organization: z.string().max(256).optional(),
  manager: z
    .union([
      z.string().max(256),
      z.looseObject({
        value: z.string().max(256).optional(),
        displayName: z.string().max(256).optional(),
      }),
    ])
    .optional(),
})

/**
 * An inbound User.
 *
 * `password` is stripped during parsing. Okta sends one on every create even
 * when password sync is off, and Sim never stores or uses it; dropping it here
 * keeps the credential out of the parsed request object and therefore out of
 * every log line and error detail downstream.
 */
export const scimUserWriteSchema = z
  .looseObject({
    schemas: z.array(z.string().max(256)).min(1, 'schemas must name at least one URN').max(10),
    userName: z.string().trim().min(1, 'userName must not be empty').max(320),
    externalId: z.string().trim().max(256).optional(),
    active: scimBoolean.optional(),
    displayName: z.string().max(256).optional(),
    name: scimNameSchema.optional(),
    emails: z.array(scimEmailSchema).max(20).optional(),
    [SCIM_ENTERPRISE_USER_SCHEMA]: scimEnterpriseSchema.optional(),
  })
  .transform(({ password: _password, ...rest }) => rest)
/** What a client may send. */
export type ScimUserWrite = z.input<typeof scimUserWriteSchema>
/** What the route receives after parsing, which is what the canonicalizer reads. */
export type ScimUserWriteParsed = z.output<typeof scimUserWriteSchema>

const scimGroupMemberSchema = z.looseObject({
  value: z.string().trim().min(1, 'A group member requires a value').max(256),
  display: z.string().max(256).optional(),
  type: z.string().max(64).optional(),
})

export const scimGroupWriteSchema = z.looseObject({
  schemas: z.array(z.string().max(256)).min(1, 'schemas must name at least one URN').max(10),
  displayName: z.string().trim().min(1, 'displayName must not be empty').max(256),
  externalId: z.string().trim().max(256).optional(),
  members: z.array(scimGroupMemberSchema).max(SCIM_MAX_GROUP_MEMBERS).optional(),
})
export type ScimGroupWrite = z.input<typeof scimGroupWriteSchema>
export type ScimGroupWriteParsed = z.output<typeof scimGroupWriteSchema>

/**
 * A PATCH request body.
 *
 * `op` is lower-cased before validation because Entra capitalizes it, and
 * defaults to `replace` because Okta omits it on the deactivation call that is
 * the single most important request this server handles.
 */
export const scimPatchBodySchema = z.object({
  schemas: z
    .array(z.string().max(256))
    .refine(
      (schemas) => schemas.includes(SCIM_PATCH_OP_SCHEMA),
      `schemas must include ${SCIM_PATCH_OP_SCHEMA}`
    ),
  Operations: z
    .array(
      z.object({
        op: z
          .string()
          .default('replace')
          .transform((value) => value.trim().toLowerCase())
          .pipe(z.enum(['add', 'replace', 'remove'])),
        path: z.string().max(512).optional(),
        value: z.unknown().optional(),
      })
    )
    .min(1, 'Operations must contain at least one operation')
    .max(SCIM_MAX_PATCH_OPERATIONS),
})
export type ScimPatchBody = z.output<typeof scimPatchBodySchema>
export type ScimPatchOperation = ScimPatchBody['Operations'][number]

export const scimAttributesQuerySchema = z.object({
  attributes: z.string().max(1024).optional(),
  excludedAttributes: z.string().max(1024).optional(),
})

export const scimListQuerySchema = scimAttributesQuerySchema.extend({
  filter: z.string().max(2048).optional(),
  startIndex: z.coerce.number().int().optional(),
  count: z.coerce.number().int().optional(),
})

export const scimResourceParamsSchema = z.object({ id: z.string().min(1).max(256) })

const scimMetaSchema = z.object({
  resourceType: z.enum(['User', 'Group']),
  created: z.string(),
  lastModified: z.string(),
  location: z.string(),
  version: z.string(),
})

export const scimUserResourceSchema = z.looseObject({
  schemas: z.array(z.string()),
  id: z.string(),
  externalId: z.string().optional(),
  userName: z.string(),
  active: z.boolean(),
  displayName: z.string(),
  name: z.looseObject({
    formatted: z.string(),
    givenName: z.string().optional(),
    familyName: z.string().optional(),
  }),
  emails: z.array(
    z.object({ value: z.string(), type: z.string().optional(), primary: z.boolean() })
  ),
  groups: z.array(z.object({ value: z.string(), display: z.string(), $ref: z.string() })),
  meta: scimMetaSchema,
})

export const scimGroupResourceSchema = z.looseObject({
  schemas: z.array(z.string()),
  id: z.string(),
  externalId: z.string().optional(),
  displayName: z.string(),
  members: z
    .array(
      z.object({
        value: z.string(),
        display: z.string().optional(),
        $ref: z.string(),
        type: z.literal('User'),
      })
    )
    .optional(),
  meta: scimMetaSchema,
})

function listResponseSchema<Item extends z.ZodTypeAny>(item: Item) {
  return z.object({
    schemas: z.tuple([z.literal(SCIM_LIST_RESPONSE_SCHEMA)]),
    totalResults: z.number().int(),
    startIndex: z.number().int(),
    itemsPerPage: z.number().int(),
    Resources: z.array(item),
  })
}

export const listScimUsersContract = defineRouteContract({
  method: 'GET',
  path: '/api/scim/v2/Users',
  query: scimListQuerySchema,
  response: { mode: 'json', schema: listResponseSchema(scimUserResourceSchema) },
})

export const createScimUserContract = defineRouteContract({
  method: 'POST',
  path: '/api/scim/v2/Users',
  body: scimUserWriteSchema,
  response: { mode: 'json', schema: scimUserResourceSchema, status: 201 },
})

export const getScimUserContract = defineRouteContract({
  method: 'GET',
  path: '/api/scim/v2/Users/[id]',
  params: scimResourceParamsSchema,
  query: scimAttributesQuerySchema,
  response: { mode: 'json', schema: scimUserResourceSchema },
})

export const replaceScimUserContract = defineRouteContract({
  method: 'PUT',
  path: '/api/scim/v2/Users/[id]',
  params: scimResourceParamsSchema,
  body: scimUserWriteSchema,
  response: { mode: 'json', schema: scimUserResourceSchema },
})

/**
 * Returns the updated resource rather than `204`. Okta documents both as
 * acceptable and Microsoft's own examples show a body, so the shape that
 * satisfies both providers is the one that carries the resource.
 */
export const patchScimUserContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/scim/v2/Users/[id]',
  params: scimResourceParamsSchema,
  body: scimPatchBodySchema,
  response: { mode: 'json', schema: scimUserResourceSchema },
})

export const deleteScimUserContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/scim/v2/Users/[id]',
  params: scimResourceParamsSchema,
  response: { mode: 'empty', status: 204 },
})

export const listScimGroupsContract = defineRouteContract({
  method: 'GET',
  path: '/api/scim/v2/Groups',
  query: scimListQuerySchema,
  response: { mode: 'json', schema: listResponseSchema(scimGroupResourceSchema) },
})

export const createScimGroupContract = defineRouteContract({
  method: 'POST',
  path: '/api/scim/v2/Groups',
  body: scimGroupWriteSchema,
  response: { mode: 'json', schema: scimGroupResourceSchema, status: 201 },
})

export const getScimGroupContract = defineRouteContract({
  method: 'GET',
  path: '/api/scim/v2/Groups/[id]',
  params: scimResourceParamsSchema,
  query: scimAttributesQuerySchema,
  response: { mode: 'json', schema: scimGroupResourceSchema },
})

export const replaceScimGroupContract = defineRouteContract({
  method: 'PUT',
  path: '/api/scim/v2/Groups/[id]',
  params: scimResourceParamsSchema,
  body: scimGroupWriteSchema,
  response: { mode: 'json', schema: scimGroupResourceSchema },
})

/**
 * Returns `204`. Microsoft states a group PATCH "should yield an HTTP 204 No
 * Content" and warns against returning the member list, which for a large
 * group is the difference between a small response and a thousand-entry one on
 * every incremental sync.
 */
export const patchScimGroupContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/scim/v2/Groups/[id]',
  params: scimResourceParamsSchema,
  body: scimPatchBodySchema,
  response: { mode: 'empty', status: 204 },
})

export const deleteScimGroupContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/scim/v2/Groups/[id]',
  params: scimResourceParamsSchema,
  response: { mode: 'empty', status: 204 },
})
