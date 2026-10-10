import { z } from 'zod'
import {
  nonEmptyIdSchema,
  organizationIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { createProjectInputSchema } from '@/lib/projects/create-input'

const projectEnvironmentSchema = z.object({
  id: nonEmptyIdSchema,
  name: z.string(),
  forkedFromWorkspaceId: nonEmptyIdSchema.nullable(),
})
const projectSchema = z.object({
  id: nonEmptyIdSchema,
  name: z.string(),
  organizationId: nonEmptyIdSchema.nullable(),
  ownerId: nonEmptyIdSchema,
  archivedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  environments: z.array(projectEnvironmentSchema),
  capabilities: z.object({ administer: z.boolean(), issues: z.boolean() }),
})
export type Project = z.output<typeof projectSchema>

const projectParamsSchema = z.object({ id: nonEmptyIdSchema })
const projectQuerySchema = z.object({
  organizationId: organizationIdSchema.optional(),
  workspaceId: workspaceIdSchema.optional(),
})
const listProjectsQuerySchema = z.object({
  organizationId: organizationIdSchema.optional(),
  cursor: nonEmptyIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
const listProjectsResponseSchema = z.object({
  projects: z.array(projectSchema),
  nextCursor: nonEmptyIdSchema.nullable(),
})
export const listProjectsContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects',
  query: listProjectsQuerySchema,
  response: { mode: 'json', schema: listProjectsResponseSchema },
})
const getProjectResponseSchema = z.object({ project: projectSchema })
export const getProjectContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]',
  params: projectParamsSchema,
  query: projectQuerySchema,
  response: { mode: 'json', schema: getProjectResponseSchema },
})
const renameProjectBodySchema = z.object({ name: z.string().trim().min(1).max(100) })
const renameProjectResponseSchema = z.object({ id: nonEmptyIdSchema, name: z.string() })
export const renameProjectContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/projects/[id]',
  params: projectParamsSchema,
  body: renameProjectBodySchema,
  response: { mode: 'json', schema: renameProjectResponseSchema },
})
const archiveProjectResponseSchema = z.object({
  id: nonEmptyIdSchema,
  archived: z.boolean(),
})
export const archiveProjectContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/projects/[id]',
  params: projectParamsSchema,
  response: { mode: 'json', schema: archiveProjectResponseSchema },
})

const workspaceProjectParamsSchema = z.object({ workspaceId: workspaceIdSchema })
export const getWorkspaceProjectContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/by-workspace/[workspaceId]',
  params: workspaceProjectParamsSchema,
  response: { mode: 'json', schema: getProjectResponseSchema },
})

const createProjectBodySchema = createProjectInputSchema
const createProjectResponseSchema = z.object({
  project: z.object({ id: nonEmptyIdSchema, name: z.string() }),
  initialEnvironment: z.object({ id: nonEmptyIdSchema, name: z.string() }),
})
export const createProjectContract = defineRouteContract({
  method: 'POST',
  path: '/api/projects',
  body: createProjectBodySchema,
  response: { mode: 'json', status: 201, schema: createProjectResponseSchema },
})
