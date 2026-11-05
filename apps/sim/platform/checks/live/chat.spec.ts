import { expect, type Page, test } from '@playwright/test'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required: the live checks use a real seeded member`)
  return value
}

async function signIn(page: Page) {
  await page.goto('/org/home')
  await page.locator('#email').fill(requireEnv('PLATFORM_LIVE_EMAIL'))
  await page.locator('#password').fill(requireEnv('PLATFORM_LIVE_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/platform\//)
}

/** A model turn needs a reachable orchestrator, which not every environment running these has. */
const orchestrator = process.env.PLATFORM_LIVE_ORCHESTRATOR === '1'

test('Home hands a draft to a new chat, which posts it for this organization', async ({ page }) => {
  await signIn(page)
  const composer = page.getByRole('textbox', { name: /Ask about your business/ })
  await composer.fill('Say hello')
  const posted = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes('/api/mothership/chat')
  )
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page).toHaveURL(/\/platform\/chat/)
  const body = (await posted).postDataJSON()
  expect(body.message).toBe('Say hello')
  expect(body.organizationId).toBeTruthy()
  expect(body.createNewChat).toBe(true)
  await expect(page.getByText('Say hello')).toBeVisible()
})

test('A chat outside the viewer’s access is not found rather than an empty chat', async ({
  page,
}) => {
  await signIn(page)
  const response = await page.goto('/org/chat/00000000-0000-4000-8000-000000000000')
  expect(response?.status()).toBe(404)
})

test('A resource in the URL survives a reload of the chat route', async ({ page }) => {
  await signIn(page)
  await page.goto('/org/chat?resource=stale-id')
  await expect(page.getByRole('textbox')).toBeVisible()
  await expect(page).toHaveURL(/resource=stale-id/)
})

test('A running turn streams, stops, and keeps what arrived', async ({ page }) => {
  test.skip(!orchestrator, 'Needs PLATFORM_LIVE_ORCHESTRATOR=1')
  await signIn(page)
  await page.goto('/org/chat')
  await page.getByRole('textbox').fill('Count slowly from 1 to 50, one number per line.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page).toHaveURL(/\/platform\/chat\/[^/?]+/, { timeout: 30_000 })
  const stop = page.getByRole('button', { name: 'Stop response' })
  await expect(stop).toBeVisible()
  const stopped = page.waitForRequest((request) =>
    request.url().includes('/api/mothership/chat/stop')
  )
  await stop.click()
  await stopped
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Stopped by you')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Count slowly from 1 to 50')).toBeVisible()
})

test('A message sent during a running turn waits in the queue and can be removed', async ({
  page,
}) => {
  test.skip(!orchestrator, 'Needs PLATFORM_LIVE_ORCHESTRATOR=1')
  await signIn(page)
  await page.goto('/org/chat')
  const field = page.getByRole('textbox')
  await field.fill('Count slowly from 1 to 50, one number per line.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible()
  await field.fill('And then say done.')
  await field.press('Enter')
  const queue = page.getByRole('region', { name: 'Queued messages' })
  await expect(queue.getByText('And then say done.')).toBeVisible()
  await queue.getByRole('button', { name: 'Remove queued message' }).click()
  await expect(queue).toHaveCount(0)
})

test('A gated tool holds the turn until the prompt is answered', async ({ page }) => {
  test.skip(
    !orchestrator || !process.env.PLATFORM_LIVE_APPROVAL_PROMPT,
    'Needs an orchestrator and a prompt that triggers a gated tool'
  )
  await signIn(page)
  await page.goto('/org/chat')
  await page.getByRole('textbox').fill(requireEnv('PLATFORM_LIVE_APPROVAL_PROMPT'))
  await page.getByRole('button', { name: 'Send message' }).click()
  const allow = page.getByRole('button', { name: 'Allow', exact: true })
  await expect(allow).toBeVisible({ timeout: 60_000 })
  const decided = page.waitForRequest((request) =>
    request.url().includes('/api/copilot/tool-permission')
  )
  await allow.click()
  await decided
  await expect(allow).toHaveCount(0, { timeout: 60_000 })
})
