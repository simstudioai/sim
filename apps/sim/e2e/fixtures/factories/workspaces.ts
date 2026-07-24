import { z } from 'zod'
import type { E2eHttpClient } from '../http-client'

const workspaceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    ownerId: z.string(),
    organizationId: z.string().nullable(),
    billedAccountUserId: z.string(),
    workspaceMode: z.enum(['personal', 'organization', 'grandfathered_shared']),
  })
  .passthrough()
const permissionMutationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  permissions: z.enum(['admin', 'write', 'read']),
  action: z.enum(['created', 'updated', 'already_member']),
})

export async function createWorkspace(
  ownerClient: E2eHttpClient,
  input: { name: string; color?: string }
): Promise<z.infer<typeof workspaceSchema>> {
  const response = await ownerClient.request({
    method: 'POST',
    path: '/api/workspaces',
    body: { ...input, skipDefaultWorkflow: true },
    schema: z.object({ workspace: workspaceSchema }),
    expectedStatus: 200,
  })
  return response.workspace
}

export async function grantWorkspacePermission(
  adminClient: E2eHttpClient,
  workspaceId: string,
  input: { userId: string; permissions: 'admin' | 'write' | 'read' }
): Promise<z.infer<typeof permissionMutationSchema>> {
  const response = await adminClient.request({
    method: 'POST',
    path: `/api/v1/admin/workspaces/${workspaceId}/members`,
    body: input,
    schema: z.object({ data: permissionMutationSchema }),
    expectedStatus: 200,
  })
  return response.data
}
