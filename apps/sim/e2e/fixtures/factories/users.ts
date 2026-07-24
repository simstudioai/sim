import { z } from 'zod'
import { E2eHttpClient } from '../http-client'

const authUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string(),
})
const authResponseSchema = z
  .object({
    user: authUserSchema,
  })
  .passthrough()

export interface SyntheticLogin {
  name: string
  email: string
  password: string
}

export async function createSyntheticUser(
  client: E2eHttpClient,
  login: SyntheticLogin
): Promise<z.infer<typeof authUserSchema>> {
  const response = await client.request({
    method: 'POST',
    path: '/api/auth/sign-up/email',
    body: login,
    schema: authResponseSchema,
    expectedStatus: 200,
  })
  return response.user
}

export async function createAuthenticatedClient(
  baseUrl: string,
  login: SyntheticLogin,
  onAttempt?: ConstructorParameters<typeof E2eHttpClient>[0]['onAttempt']
): Promise<E2eHttpClient> {
  const client = new E2eHttpClient({ baseUrl, onAttempt })
  await client.request({
    method: 'POST',
    path: '/api/auth/sign-in/email',
    body: { email: login.email, password: login.password },
    schema: authResponseSchema,
    expectedStatus: 200,
  })
  return client
}
