import { expect, test } from '@playwright/test'

test('blacklisted local providers skip outbound model discovery', async ({ request }) => {
  const response = await request.get('/api/providers/ollama/models')
  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ models: [] })
})
