import { expect } from '@playwright/test'
import { adminEmail, requireEnv, signInAsAdmin } from '@/platform/checks/live/session'
import { databaseNow, removeChatsStartedSince } from '@/platform/checks/live/support/chats'
import { liveRoute, liveRoutePattern } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

/** A model turn needs a reachable orchestrator, which not every environment running these has. */
const orchestrator = process.env.PLATFORM_LIVE_ORCHESTRATOR === '1'

/**
 * Every turn here starts a chat for the seeded administrator. Each check deletes the ones it
 * started, so the Chats section and Recently deleted read the same for every later check and rerun.
 */
let startedAt: Date
test.beforeEach(async () => {
  startedAt = await databaseNow()
})
test.afterEach(async () => {
  await removeChatsStartedSince(adminEmail(), startedAt)
})

test('Home hands a draft to a new chat, which posts it for this organization', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/home'))
  const composer = page.getByRole('textbox', { name: /Ask about your business/ })
  await composer.fill('Say hello')
  const posted = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes('/api/mothership/chat')
  )
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page).toHaveURL(liveRoutePattern('/chat'))
  const body = (await posted).postDataJSON()
  expect(body.message).toBe('Say hello')
  expect(body.organizationId).toBeTruthy()
  expect(body.createNewChat).toBe(true)
  await expect(page.getByText('Say hello')).toBeVisible()
})

test('A chat outside the viewer’s access is not found rather than an empty chat', async ({
  page,
}) => {
  await signInAsAdmin(page, liveRoute('/home'))
  await page.goto(liveRoute('/chat/00000000-0000-4000-8000-000000000000'))
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Conversation' })).toHaveCount(0)
})

test('A resource in the URL survives a reload of the chat route', async ({ page }) => {
  await signInAsAdmin(page, liveRoute('/chat?resource=stale-id'))
  await expect(page.getByRole('textbox')).toBeVisible()
  await expect(page).toHaveURL(/resource=stale-id/)
  await page.reload()
  await expect(page.getByRole('textbox')).toBeVisible()
  await expect(page).toHaveURL(/resource=stale-id/)
})

test('A running turn streams, stops, and keeps what arrived', async ({ page }) => {
  test.skip(!orchestrator, 'Needs PLATFORM_LIVE_ORCHESTRATOR=1')
  await signInAsAdmin(page, liveRoute('/chat'))
  await page.getByRole('textbox').fill('Count slowly from 1 to 50, one number per line.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page).toHaveURL(liveRoutePattern('/chat', '/[^/?]+'), { timeout: 30_000 })
  const stop = page.getByRole('button', { name: 'Stop response' })
  await expect(stop).toBeVisible()
  const conversation = page.getByRole('region', { name: 'Conversation' })
  await expect(conversation.getByText(/^1\s/)).toBeVisible()
  const stopped = page.waitForRequest((request) =>
    request.url().includes('/api/mothership/chat/stop')
  )
  await stop.click()
  await stopped
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Stopped by you')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Count slowly from 1 to 50')).toBeVisible()
  await expect(conversation.getByText(/^1\s/)).toBeVisible()
})

test('A message sent during a running turn steers it', async ({ page }) => {
  test.skip(!orchestrator, 'Needs PLATFORM_LIVE_ORCHESTRATOR=1')
  await signInAsAdmin(page, liveRoute('/chat'))
  const turnPosts: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/mothership/chat')) {
      turnPosts.push(request.postDataJSON().message)
    }
  })
  const field = page.getByRole('textbox')
  await field.fill('Count slowly from 1 to 50, one number per line.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible()
  const conversation = page.getByRole('region', { name: 'Conversation' })
  // Stop shows before the agent's stream is open, and a steer the agent cannot place yet is held
  // for after the response, so this steers once the turn is counting.
  await expect(conversation.getByText(/^1\s/)).toBeVisible()
  const steered = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes('/api/copilot/chat/steer')
  )
  await field.fill('And then say done.')
  await field.press('Enter')
  expect((await steered).postDataJSON().content).toBe('And then say done.')
  await expect(conversation.getByText('And then say done.', { exact: true })).toBeVisible()
  await expect(conversation.getByText('Applied: And then say done.')).toBeVisible()
  await page.getByRole('button', { name: 'Stop response' }).click()
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible({ timeout: 30_000 })
  expect(turnPosts).toEqual(['Count slowly from 1 to 50, one number per line.'])
})

test('A message the turn ends without applying goes out as the next turn', async ({ page }) => {
  test.skip(!orchestrator, 'Needs PLATFORM_LIVE_ORCHESTRATOR=1')
  await signInAsAdmin(page, liveRoute('/chat'))
  const turnPosts: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/mothership/chat')) {
      turnPosts.push(request.postDataJSON().message)
    }
  })
  const field = page.getByRole('textbox')
  await field.fill('Count slowly to 6 and ignore steering.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible()
  const conversation = page.getByRole('region', { name: 'Conversation' })
  await expect(conversation.getByText(/^1\s/)).toBeVisible()
  const steered = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes('/api/copilot/chat/steer')
  )
  await field.fill('Then say done.')
  await field.press('Enter')
  expect((await steered).postDataJSON().content).toBe('Then say done.')
  await expect(conversation.getByText('Then say done.', { exact: true })).toBeVisible()
  await expect(conversation.getByText('Hello from the scripted agent.')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()
  expect(turnPosts).toEqual(['Count slowly to 6 and ignore steering.', 'Then say done.'])
  await expect(conversation.getByText('Then say done.', { exact: true })).toHaveCount(1)
})

test('A gated tool holds the turn until the prompt is answered', async ({ page }) => {
  test.skip(
    !orchestrator || !process.env.PLATFORM_LIVE_APPROVAL_PROMPT,
    'Needs an orchestrator and a prompt that triggers a gated tool'
  )
  await signInAsAdmin(page, liveRoute('/chat'))
  await page.getByRole('textbox').fill(requireEnv('PLATFORM_LIVE_APPROVAL_PROMPT'))
  await page.getByRole('button', { name: 'Send message' }).click()
  const allow = page.getByRole('button', { name: 'Allow', exact: true })
  await expect(allow).toBeVisible({ timeout: 60_000 })
  const decided = page.waitForRequest((request) =>
    request.url().includes('/api/copilot/tool-permission')
  )
  await allow.click()
  expect((await (await decided).response())?.ok(), 'the decision was refused').toBe(true)
  await expect(allow).toHaveCount(0, { timeout: 60_000 })
  // The scripted worker's resumed leg: Sim carried the decision back and the turn finished.
  await expect(page.getByText('The approval probe has its answer.')).toBeVisible({
    timeout: 60_000,
  })
})
