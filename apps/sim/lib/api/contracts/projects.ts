import { z } from 'zod'
import { nonEmptyIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** One workspace of a project the viewer can access; its name labels its environment. */
export const projectWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Pipeline order from the project's root (0). */
  position: z.number().int(),
  forkedFromWorkspaceId: z.string().nullable(),
})

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  organizationId: z.string().nullable(),
  /** Only the workspaces the viewer holds a permission on, in pipeline order. */
  workspaces: z.array(projectWorkspaceSchema),
})

export type ProjectApi = z.output<typeof projectSchema>
export type ProjectWorkspaceApi = z.output<typeof projectWorkspaceSchema>

export const listProjectsContract = defineRouteContract({
  method: 'GET',
  path: '/api/projects',
  query: z.object({ organizationId: nonEmptyIdSchema.optional() }),
  response: { mode: 'json', schema: z.object({ projects: z.array(projectSchema) }) },
})

export const renameProjectBodySchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(100),
})
export type RenameProjectBody = z.input<typeof renameProjectBodySchema>

export const renameProjectContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/projects/[id]',
  params: z.object({ id: nonEmptyIdSchema }),
  body: renameProjectBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ project: z.object({ id: z.string(), name: z.string() }) }),
  },
})

/** Organization administration lists every active environment, without borrowing workspace membership. */
export const listOrganizationProjectsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/projects',
  params: z.object({ id: nonEmptyIdSchema }),
  response: { mode: 'json', schema: z.object({ projects: z.array(projectSchema) }) },
})
