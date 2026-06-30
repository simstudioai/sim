import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const asanaUserSummarySchema = z.object({
  gid: z.string(),
  name: z.string(),
})

const asanaCreatedBySchema = asanaUserSummarySchema.extend({
  resource_type: z.string().optional(),
})

const asanaTaskSchema = z.object({
  gid: z.string(),
  resource_type: z.string().optional(),
  resource_subtype: z.string().optional(),
  name: z.string(),
  notes: z.string(),
  completed: z.boolean(),
  assignee: asanaUserSummarySchema.optional(),
  created_by: asanaCreatedBySchema.optional(),
  due_on: z.string().optional(),
  created_at: z.string().optional(),
  modified_at: z.string().optional(),
})

const asanaTaskMutationResponseSchema = z.object({
  success: z.literal(true),
  ts: z.string(),
  gid: z.string(),
  name: z.string(),
  notes: z.string(),
  completed: z.boolean(),
  created_at: z.string().optional(),
  modified_at: z.string().optional(),
  permalink_url: z.string().optional(),
})

const asanaTasksResponseSchema = z.object({
  success: z.literal(true),
  ts: z.string(),
  tasks: z.array(asanaTaskSchema),
  next_page: z.unknown().optional(),
})

const asanaSingleTaskResponseSchema = asanaTaskSchema.extend({
  success: z.literal(true),
  ts: z.string(),
})

const asanaProjectSchema = z.object({
  gid: z.string(),
  name: z.string(),
  resource_type: z.string(),
})

const asanaProjectsResponseSchema = z.object({
  success: z.literal(true),
  ts: z.string(),
  projects: z.array(asanaProjectSchema),
})

const asanaCommentResponseSchema = z.object({
  success: z.literal(true),
  ts: z.string(),
  gid: z.string(),
  text: z.string(),
  created_at: z.string().optional(),
  created_by: asanaUserSummarySchema.optional(),
})

const asanaGetTaskResponseSchema = z.union([
  asanaSingleTaskResponseSchema,
  asanaTasksResponseSchema,
])

const asanaProjectRecordResponseSchema = z.object({
  success: z.literal(true),
  ts: z.string(),
  gid: z.string(),
  name: z.string(),
  notes: z.string(),
  archived: z.boolean().optional(),
  color: z.string().nullable().optional(),
  created_at: z.string().optional(),
  modified_at: z.string().optional(),
  permalink_url: z.string().optional(),
})

const asanaWorkspaceSchema = z.object({
  gid: z.string(),
  name: z.string(),
  resource_type: z.string().optional(),
})

const asanaListWorkspacesResponseSchema = z.object({
  success: z.literal(true),
  ts: z.string(),
  workspaces: z.array(asanaWorkspaceSchema),
})

const asanaDeleteTaskResponseSchema = z.object({
  success: z.literal(true),
  ts: z.string(),
  gid: z.string(),
  deleted: z.literal(true),
})

const asanaAddFollowersResponseSchema = z.object({
  success: z.literal(true),
  ts: z.string(),
  gid: z.string(),
  name: z.string(),
  followers: z.array(asanaUserSummarySchema),
})

const asanaSectionSchema = z.object({
  gid: z.string(),
  name: z.string(),
  resource_type: z.string().optional(),
})

const asanaSectionResponseSchema = z.object({
  success: z.literal(true),
  ts: z.string(),
  gid: z.string(),
  name: z.string(),
  created_at: z.string().optional(),
})

const asanaListSectionsResponseSchema = z.object({
  success: z.literal(true),
  ts: z.string(),
  sections: z.array(asanaSectionSchema),
})

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

export const asanaCreateProjectBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  workspace: z.string().min(1, 'Workspace GID is required'),
  name: z.string().min(1, 'Project name is required'),
  notes: z.string().nullish(),
})

export const asanaGetProjectBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  projectGid: z.string().min(1, 'Project GID is required'),
})

export const asanaListWorkspacesBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
})

export const asanaCreateSubtaskBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  taskGid: z.string().min(1, 'Parent task GID is required'),
  name: z.string().min(1, 'Subtask name is required'),
  notes: z.string().nullish(),
  assignee: z.string().nullish(),
  due_on: z.string().nullish(),
})

export const asanaDeleteTaskBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  taskGid: z.string().min(1, 'Task GID is required'),
})

export const asanaAddFollowersBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  taskGid: z.string().min(1, 'Task GID is required'),
  followers: z.array(z.string().min(1)).min(1, 'At least one follower GID is required'),
})

export const asanaCreateSectionBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  projectGid: z.string().min(1, 'Project GID is required'),
  name: z.string().min(1, 'Section name is required'),
})

export const asanaListSectionsBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  projectGid: z.string().min(1, 'Project GID is required'),
})

export const asanaAddCommentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/add-comment',
  body: asanaAddCommentBodySchema,
  response: { mode: 'json', schema: asanaCommentResponseSchema },
})

export const asanaCreateTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/create-task',
  body: asanaCreateTaskBodySchema,
  response: { mode: 'json', schema: asanaTaskMutationResponseSchema },
})

export const asanaGetProjectsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/get-projects',
  body: asanaGetProjectsBodySchema,
  response: { mode: 'json', schema: asanaProjectsResponseSchema },
})

export const asanaGetTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/get-task',
  body: asanaGetTaskBodySchema,
  response: { mode: 'json', schema: asanaGetTaskResponseSchema },
})

export const asanaSearchTasksContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/search-tasks',
  body: asanaSearchTasksBodySchema,
  response: { mode: 'json', schema: asanaTasksResponseSchema },
})

export const asanaUpdateTaskContract = defineRouteContract({
  method: 'PUT',
  path: '/api/tools/asana/update-task',
  body: asanaUpdateTaskBodySchema,
  response: { mode: 'json', schema: asanaTaskMutationResponseSchema },
})

export const asanaCreateProjectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/create-project',
  body: asanaCreateProjectBodySchema,
  response: { mode: 'json', schema: asanaProjectRecordResponseSchema },
})

export const asanaGetProjectContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/get-project',
  body: asanaGetProjectBodySchema,
  response: { mode: 'json', schema: asanaProjectRecordResponseSchema },
})

export const asanaListWorkspacesContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/list-workspaces',
  body: asanaListWorkspacesBodySchema,
  response: { mode: 'json', schema: asanaListWorkspacesResponseSchema },
})

export const asanaCreateSubtaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/create-subtask',
  body: asanaCreateSubtaskBodySchema,
  response: { mode: 'json', schema: asanaTaskMutationResponseSchema },
})

export const asanaDeleteTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/delete-task',
  body: asanaDeleteTaskBodySchema,
  response: { mode: 'json', schema: asanaDeleteTaskResponseSchema },
})

export const asanaAddFollowersContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/add-followers',
  body: asanaAddFollowersBodySchema,
  response: { mode: 'json', schema: asanaAddFollowersResponseSchema },
})

export const asanaCreateSectionContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/create-section',
  body: asanaCreateSectionBodySchema,
  response: { mode: 'json', schema: asanaSectionResponseSchema },
})

export const asanaListSectionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/asana/list-sections',
  body: asanaListSectionsBodySchema,
  response: { mode: 'json', schema: asanaListSectionsResponseSchema },
})

export type AsanaCreateProjectBody = ContractBody<typeof asanaCreateProjectContract>
export type AsanaCreateProjectBodyInput = ContractBodyInput<typeof asanaCreateProjectContract>
export type AsanaCreateProjectResponse = ContractJsonResponse<typeof asanaCreateProjectContract>
export type AsanaGetProjectBody = ContractBody<typeof asanaGetProjectContract>
export type AsanaGetProjectBodyInput = ContractBodyInput<typeof asanaGetProjectContract>
export type AsanaGetProjectResponse = ContractJsonResponse<typeof asanaGetProjectContract>
export type AsanaListWorkspacesBody = ContractBody<typeof asanaListWorkspacesContract>
export type AsanaListWorkspacesBodyInput = ContractBodyInput<typeof asanaListWorkspacesContract>
export type AsanaListWorkspacesResponse = ContractJsonResponse<typeof asanaListWorkspacesContract>
export type AsanaCreateSubtaskBody = ContractBody<typeof asanaCreateSubtaskContract>
export type AsanaCreateSubtaskBodyInput = ContractBodyInput<typeof asanaCreateSubtaskContract>
export type AsanaCreateSubtaskResponse = ContractJsonResponse<typeof asanaCreateSubtaskContract>
export type AsanaDeleteTaskBody = ContractBody<typeof asanaDeleteTaskContract>
export type AsanaDeleteTaskBodyInput = ContractBodyInput<typeof asanaDeleteTaskContract>
export type AsanaDeleteTaskResponse = ContractJsonResponse<typeof asanaDeleteTaskContract>
export type AsanaAddFollowersBody = ContractBody<typeof asanaAddFollowersContract>
export type AsanaAddFollowersBodyInput = ContractBodyInput<typeof asanaAddFollowersContract>
export type AsanaAddFollowersResponse = ContractJsonResponse<typeof asanaAddFollowersContract>
export type AsanaCreateSectionBody = ContractBody<typeof asanaCreateSectionContract>
export type AsanaCreateSectionBodyInput = ContractBodyInput<typeof asanaCreateSectionContract>
export type AsanaCreateSectionResponse = ContractJsonResponse<typeof asanaCreateSectionContract>
export type AsanaListSectionsBody = ContractBody<typeof asanaListSectionsContract>
export type AsanaListSectionsBodyInput = ContractBodyInput<typeof asanaListSectionsContract>
export type AsanaListSectionsResponse = ContractJsonResponse<typeof asanaListSectionsContract>

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
