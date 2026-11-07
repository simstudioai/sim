import { expect, test } from '@playwright/test'
import { signInAsAdmin } from '@/platform/checks/live/session'

test('A query lands in the URL, searches under the viewer, and a filter narrows it', async ({
  page,
}) => {
  await signInAsAdmin(page, '/org/search')

  const searched = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes('/api/knowledge/search')
  )
  const field = page.getByRole('textbox', { name: 'Search' })
  await field.fill('onboarding')
  await field.press('Enter')
  await expect(page).toHaveURL(/q=onboarding/)
  expect((await searched).postDataJSON().query).toBe('onboarding')

  const filters = page.getByRole('group', { name: 'Search filters' })
  await expect(filters).toBeVisible()
  await filters.getByRole('button', { name: /^Filter by date:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Past week' }).click()
  await expect(page).toHaveURL(/updated=7d/)

  await page.reload()
  await expect(field).toHaveValue('onboarding')
})

test('Home’s Search segment opens Search with the query', async ({ page }) => {
  await signInAsAdmin(page, '/org/home')
  await page.getByRole('radio', { name: 'Search' }).click()
  await page.getByRole('textbox', { name: /Search your company/ }).fill('renewal')
  await page.getByRole('button', { name: 'Send message' }).click()
  await expect(page).toHaveURL(/\/org\/search\?.*q=renewal/)
})

test('Summarize on a result switches to Assistant and asks about that document', async ({
  page,
}) => {
  await page.route('**/api/knowledge/search', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          query: 'renewal',
          retrieval: { status: 'complete', timedOutLegs: [] },
          results: [
            {
              documentId: 'doc-renewal',
              knowledgeBaseId: 'kb-1',
              knowledgeBaseName: 'Drive',
              documentName: 'Renewal plan',
              sourceUrl: 'https://example.com/renewal',
              connectorType: null,
              sourceModifiedAt: null,
              author: null,
              content: 'The renewal plan',
              chunkIndex: 0,
              similarity: 1,
            },
          ],
        },
      },
    })
  )
  await signInAsAdmin(page, '/org/search?mode=search&q=renewal')
  await page.getByRole('button', { name: 'Actions for Renewal plan' }).click()
  const posted = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().includes('/api/mothership/chat')
  )
  await page.getByRole('menuitem', { name: 'Summarize' }).click()
  await expect(page).toHaveURL(/mode=assistant/)
  const body = (await posted).postDataJSON()
  expect(body.message).toBe('Summarize "Renewal plan"')
  expect(body.assistantSearch.documentIds).toEqual(['doc-renewal'])
  await expect(page.getByRole('radio', { name: 'Assistant' })).toBeChecked()
})
