import { expect } from '@playwright/test'
import { requireEnv, signInAsAdmin } from '@/platform/checks/live/session'
import { liveRoute, liveRoutePattern } from '@/platform/checks/routes'
import { test } from '@/platform/checks/test'

/** A model turn needs a reachable orchestrator, which not every environment running these has. */
const orchestrator = process.env.PLATFORM_LIVE_ORCHESTRATOR === '1'

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
})

test('A running turn streams, stops, and keeps what arrived', async ({ page }) => {
  test.skip(!orchestrator, 'Needs PLATFORM_LIVE_ORCHESTRATOR=1')
  await signInAsAdmin(page, liveRoute('/chat'))
  await page.getByRole('textbox').fill('Count slowly from 1 to 50, one number per line.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page).toHaveURL(liveRoutePattern('/chat', '/[^/?]+'), { timeout: 30_000 })
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
  const steered = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes('/api/copilot/chat/steer')
  )
  await field.fill('And then say done.')
  await field.press('Enter')
  expect((await steered).postDataJSON().content).toBe('And then say done.')
  const conversation = page.getByRole('region', { name: 'Conversation' })
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
  await field.fill('Count slowly to 3 and ignore steering.')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible()
  await field.fill('Then say done.')
  await field.press('Enter')
  const conversation = page.getByRole('region', { name: 'Conversation' })
  await expect(conversation.getByText('Then say done.', { exact: true })).toBeVisible()
  await expect(conversation.getByText('Hello from the scripted agent.')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible()
  expect(turnPosts).toEqual(['Count slowly to 3 and ignore steering.', 'Then say done.'])
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
  await decided
  await expect(allow).toHaveCount(0, { timeout: 60_000 })
})
