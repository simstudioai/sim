import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const asanaToolResponseSchema = z.object({}).passthrough()

export const asanaAddCommentBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  taskGid: z.string().min(1, 'Task GID is required'),
  text: z.string().min(1, 'Comment text is required'),
})

export const asanaCreateTaskBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  name: z.string().min(1, 'Task name is required'),
  workspace: z.string().min(1, 'Workspace GID is required'),
  notes: z.string().nullish(),
  assignee: z.string().nullish(),
  due_on: z.string().nullish(),
})

export const asanaGetProjectsBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  workspace: z.string().min(1, 'Workspace is required'),
})

export const asanaGetTaskBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  taskGid: z.string().nullish(),
  workspace: z.string().nullish(),
  project: z.string().nullish(),
  limit: z.union([z.string(), z.number()]).nullish(),
})

export const asanaSearchTasksBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  workspace: z.string().min(1, 'Workspace is required'),
  text: z.string().nullish(),
  assignee: z.string().nullish(),
  projects: z.array(z.string()).nullish(),
  completed: z.boolean().nullish(),
})

export const asanaUpdateTaskBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  taskGid: z.string().min(1, 'Task GID is required'),
  name: z.string().nullish(),
  notes: z.string().nullish(),
  assignee: z.string().nullish(),
  completed: z.boolean().nullish(),
  due_on: z.string().nullish(),
})

export const asanaAddCommentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/add-comment',
  body: asanaAddCommentBodySchema,
  response: { mode: 'json', schema: asanaToolResponseSchema },
})

export const asanaCreateTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/create-task',
  body: asanaCreateTaskBodySchema,
  response: { mode: 'json', schema: asanaToolResponseSchema },
})

export const asanaGetProjectsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/get-projects',
  body: asanaGetProjectsBodySchema,
  response: { mode: 'json', schema: asanaToolResponseSchema },
})

export const asanaGetTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/get-task',
  body: asanaGetTaskBodySchema,
  response: { mode: 'json', schema: asanaToolResponseSchema },
})

export const asanaSearchTasksContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/search-tasks',
  body: asanaSearchTasksBodySchema,
  response: { mode: 'json', schema: asanaToolResponseSchema },
})

export const asanaUpdateTaskContract = defineRouteContract({
  method: 'PUT',
  path: '/api/tools/asana/update-task',
  body: asanaUpdateTaskBodySchema,
  response: { mode: 'json', schema: asanaToolResponseSchema },
})

export type AsanaAddCommentBody = ContractBody<typeof asanaAddCommentContract>
export type AsanaAddCommentBodyInput = ContractBodyInput<typeof asanaAddCommentContract>
export type AsanaAddCommentResponse = ContractJsonResponse<typeof asanaAddCommentContract>
export type AsanaCreateTaskBody = ContractBody<typeof asanaCreateTaskContract>
export type AsanaCreateTaskBodyInput = ContractBodyInput<typeof asanaCreateTaskContract>
export type AsanaCreateTaskResponse = ContractJsonResponse<typeof asanaCreateTaskContract>
export type AsanaGetProjectsBody = ContractBody<typeof asanaGetProjectsContract>
export type AsanaGetProjectsBodyInput = ContractBodyInput<typeof asanaGetProjectsContract>
export type AsanaGetProjectsResponse = ContractJsonResponse<typeof asanaGetProjectsContract>
export type AsanaGetTaskBody = ContractBody<typeof asanaGetTaskContract>
export type AsanaGetTaskBodyInput = ContractBodyInput<typeof asanaGetTaskContract>
export type AsanaGetTaskResponse = ContractJsonResponse<typeof asanaGetTaskContract>
export type AsanaSearchTasksBody = ContractBody<typeof asanaSearchTasksContract>
export type AsanaSearchTasksBodyInput = ContractBodyInput<typeof asanaSearchTasksContract>
export type AsanaSearchTasksResponse = ContractJsonResponse<typeof asanaSearchTasksContract>
export type AsanaUpdateTaskBody = ContractBody<typeof asanaUpdateTaskContract>
export type AsanaUpdateTaskBodyInput = ContractBodyInput<typeof asanaUpdateTaskContract>
export type AsanaUpdateTaskResponse = ContractJsonResponse<typeof asanaUpdateTaskContract>
