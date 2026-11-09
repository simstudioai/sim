import { expect } from '@playwright/test'
import { test } from '@/platform/checks/fixture-test'
import { fixtureUrl } from '@/platform/checks/routes'

test('an integration idea prepares an editable Home draft without sending or losing existing text', async ({
  page,
}) => {
  await page.goto(fixtureUrl('/home?state=full&theme=light'))
  const composer = page.getByRole('textbox', {
    name: 'Ask about your business, or give Sim something to do…',
  })
  await composer.fill('Keep my existing notes.')
  await page.getByRole('link', { name: 'Integrations', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search apps', exact: true }).fill('Fireflies')
  await page.getByRole('link', { name: /^Fireflies / }).click()
  const idea = page.getByRole('button', { name: 'Use Fireflies idea', exact: true })
  await expect(idea).toBeVisible()
  const prompt = await idea.innerText()
  await idea.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/home\?/)
  await expect(composer).toHaveValue(`Keep my existing notes.\n\n${prompt}`)
  await expect(composer).toBeFocused()
  await composer.fill(`${await composer.inputValue()}\nAsk me before sending gifts.`)
  await expect(composer).toHaveValue(/Ask me before sending gifts\.$/)
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled()
})
