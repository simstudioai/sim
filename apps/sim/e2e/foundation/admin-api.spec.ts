import { expect, test } from '@playwright/test'

test('Admin API is configured and rejects missing credentials', async ({ request }) => {
  const adminKey = process.env.E2E_ADMIN_API_KEY
  expect(adminKey, 'E2E_ADMIN_API_KEY must be provided to the Playwright worker').toBeTruthy()

  const unauthorized = await request.get('/api/v1/admin/users?limit=1&offset=0')
  expect(unauthorized.status()).toBe(401)

  const authorized = await request.get('/api/v1/admin/users?limit=1&offset=0', {
    headers: { 'x-admin-key': adminKey! },
  })
  const responseText = await authorized.text()
  expect(authorized.status(), responseText).toBe(200)
  const body = JSON.parse(responseText) as { data?: unknown[] }
  expect(Array.isArray(body.data)).toBe(true)
})
