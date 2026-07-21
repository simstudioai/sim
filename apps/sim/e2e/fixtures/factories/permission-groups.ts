import { z } from 'zod'
import type { E2eHttpClient } from '../http-client'

const permissionGroupSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  createdBy: z.string(),
  isDefault: z.boolean(),
  workspaceIds: z.array(z.string()),
  config: z.record(z.string(), z.unknown()),
})

export interface RestrictedPermissionConfig {
  hideSecretsTab: boolean
  hideApiKeysTab: boolean
  hideInboxTab: boolean
  disableMcpTools: boolean
  disableCustomTools: boolean
}

export async function createPermissionGroup(
  ownerClient: E2eHttpClient,
  organizationId: string,
  input: {
    name: string
    description?: string
    workspaceIds: string[]
    config: RestrictedPermissionConfig
    isDefault: boolean
  }
): Promise<z.infer<typeof permissionGroupSchema>> {
  const response = await ownerClient.request({
    method: 'POST',
    path: `/api/organizations/${organizationId}/permission-groups`,
    body: input,
    schema: z.object({ permissionGroup: permissionGroupSchema }),
    expectedStatus: 201,
  })
  return response.permissionGroup
}

export async function addPermissionGroupMember(
  ownerClient: E2eHttpClient,
  organizationId: string,
  permissionGroupId: string,
  userId: string
): Promise<string> {
  const response = await ownerClient.request({
    method: 'POST',
    path: `/api/organizations/${organizationId}/permission-groups/${permissionGroupId}/members`,
    body: { userId },
    schema: z.object({
      member: z.object({
        id: z.string(),
        userId: z.string(),
      }),
    }),
    expectedStatus: 201,
  })
  return response.member.id
}
