import { z } from 'zod'
import { nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const projectEnvironmentSchema = z.object({
  id: nonEmptyIdSchema,
  name: z.string(),
  forkedFromWorkspaceId: nonEmptyIdSchema.nullable(),
})
export type ProjectEnvironment = z.output<typeof projectEnvironmentSchema>
export const projectSchema = z.object({
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
export const projectParamsSchema = z.object({ id: nonEmptyIdSchema })
export type ProjectParams = z.input<typeof projectParamsSchema>
export const projectQuerySchema = z.object({
  organizationId: nonEmptyIdSchema.optional(),
  workspaceId: nonEmptyIdSchema.optional(),
})
export type ProjectQuery = z.input<typeof projectQuerySchema>
export const listProjectsQuerySchema = z.object({
  organizationId: nonEmptyIdSchema.optional(),
  cursor: nonEmptyIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})
export type ListProjectsQuery = z.input<typeof listProjectsQuerySchema>
export const listProjectsResponseSchema = z.object({
  projects: z.array(projectSchema),
  nextCursor: nonEmptyIdSchema.nullable(),
})
export type ListProjectsResponse = z.output<typeof listProjectsResponseSchema>
export const listProjectsContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects',
  query: listProjectsQuerySchema,
  response: { mode: 'json', schema: listProjectsResponseSchema },
})
export const getProjectResponseSchema = z.object({ project: projectSchema })
export type GetProjectResponse = z.output<typeof getProjectResponseSchema>
export const getProjectContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/[id]',
  params: projectParamsSchema,
  query: projectQuerySchema,
  response: { mode: 'json', schema: getProjectResponseSchema },
})
export const renameProjectBodySchema = z.object({ name: z.string().trim().min(1).max(100) })
export type RenameProjectBody = z.input<typeof renameProjectBodySchema>
export const renameProjectResponseSchema = z.object({ id: nonEmptyIdSchema, name: z.string() })
export type RenameProjectResponse = z.output<typeof renameProjectResponseSchema>
export const renameProjectContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/projects/[id]',
  params: projectParamsSchema,
  body: renameProjectBodySchema,
  response: { mode: 'json', schema: renameProjectResponseSchema },
})
export const archiveProjectResponseSchema = z.object({
  id: nonEmptyIdSchema,
  archived: z.boolean(),
})
export type ArchiveProjectResponse = z.output<typeof archiveProjectResponseSchema>
export const archiveProjectContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/projects/[id]',
  params: projectParamsSchema,
  response: { mode: 'json', schema: archiveProjectResponseSchema },
})

export const workspaceProjectParamsSchema = z.object({ workspaceId: nonEmptyIdSchema })
export type WorkspaceProjectParams = z.input<typeof workspaceProjectParamsSchema>
export const getWorkspaceProjectContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects/by-workspace/[workspaceId]',
  params: workspaceProjectParamsSchema,
  response: { mode: 'json', schema: getProjectResponseSchema },
})
