import { z } from 'zod'
import { E2eHttpClient } from '../http-client'

const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  memberId: z.string(),
})
const organizationMemberSchema = z.object({
  id: z.string(),
  userId: z.string(),
  organizationId: z.string(),
  role: z.string(),
  action: z.enum(['created', 'updated', 'already_member']),
})

export function createAdminClient(baseUrl: string, adminApiKey: string): E2eHttpClient {
  return new E2eHttpClient({
    baseUrl,
    defaultHeaders: { 'x-admin-key': adminApiKey },
  })
}

export async function createOrganization(
  adminClient: E2eHttpClient,
  input: { name: string; slug: string; ownerId: string }
): Promise<z.infer<typeof organizationSchema>> {
  const response = await adminClient.request({
    method: 'POST',
    path: '/api/v1/admin/organizations',
    body: input,
    schema: z.object({ data: organizationSchema }),
    expectedStatus: 200,
  })
  return response.data
}

export async function addOrganizationMember(
  adminClient: E2eHttpClient,
  organizationId: string,
  input: { userId: string; role: 'admin' | 'member' }
): Promise<z.infer<typeof organizationMemberSchema>> {
  const response = await adminClient.request({
    method: 'POST',
    path: `/api/v1/admin/organizations/${organizationId}/members`,
    body: input,
    schema: z.object({ data: organizationMemberSchema }),
    expectedStatus: 200,
  })
  return response.data
}
