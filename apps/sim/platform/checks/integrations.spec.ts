import { expect, test } from '@playwright/test'

const origin = process.env.PLATFORM_E2E_ORIGIN ?? 'http://127.0.0.1:3181'

test('app discovery opens skills and templates and preserves installed skills through navigation', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(`${origin}/integrations?state=full`)
  const main = page.getByRole('main')
  await main.getByRole('searchbox', { name: 'Search apps', exact: true }).fill('1Password')
  await main.getByRole('button', { name: /^App filter:/ }).click()
  await page.getByRole('menuitem', { name: 'Categories', exact: true }).hover()
  await page.getByRole('menuitemradio', { name: 'Security', exact: true }).click()
  await main.getByRole('link', { name: /^1Password / }).click()
  await expect(main.getByRole('link', { name: 'Docs', exact: true })).toHaveAttribute(
    'href',
    'https://docs.sim.ai/integrations/onepassword'
  )
  const suggested = main.getByRole('region', { name: 'Skills', exact: true })
  await suggested.getByRole('button', { name: /^fetch-secret-for-runtime / }).click()
  const skill = page.getByRole('dialog', { name: 'fetch-secret-for-runtime', exact: true })
  const instructions =
    'Ask which vault to use, then retrieve the requested secret without displaying its value.'
  await skill.getByRole('textbox', { name: 'Instructions', exact: true }).fill(instructions)
  await skill.getByRole('button', { name: 'Add to Skills', exact: true }).click()
  await expect(skill).toHaveCount(0)
  await suggested.getByRole('button', { name: /^fetch-secret-for-runtime / }).click()
  await expect(skill.getByRole('button', { name: 'Added to Skills', exact: true })).toBeDisabled()
  await skill.getByRole('button', { name: 'Cancel', exact: true }).click()
  await main
    .getByRole('region', { name: 'Agent templates', exact: true })
    .getByRole('button', { name: /1Password vault audit / })
    .click()
  const template = page.getByRole('dialog', { name: '1Password vault audit', exact: true })
  const prompt = await template.getByRole('textbox', { name: 'Prompt', exact: true }).inputValue()
  await template.getByRole('button', { name: 'Copy prompt', exact: true }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(prompt)
  await template.getByRole('button', { name: 'Close', exact: true }).click()
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await expect(main.getByRole('searchbox', { name: 'Search apps', exact: true })).toHaveValue(
    '1Password'
  )
  await expect(main.getByRole('button', { name: /^App filter:/ })).toContainText('Security')
  await main
    .getByRole('navigation', { name: 'Integration categories' })
    .getByRole('link', { name: 'Skills', exact: true })
    .click()
  await main.getByRole('button', { name: /^fetch-secret-for-runtime / }).click()
  const editor = page.getByRole('dialog', { name: 'Edit skill', exact: true })
  await expect(editor.getByRole('textbox', { name: 'Instructions', exact: true })).toHaveValue(
    instructions
  )
  const editedInstructions =
    'Confirm the target vault, retrieve the secret, and report only its item reference.'
  await editor.getByRole('textbox', { name: 'Name', exact: true }).fill('runtime-vault-lookup')
  await editor.getByRole('textbox', { name: 'Instructions', exact: true }).fill(editedInstructions)
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await main
    .getByRole('navigation', { name: 'Integration categories' })
    .getByRole('link', { name: 'Apps', exact: true })
    .click()
  await main.getByRole('link', { name: /^1Password / }).click()
  await suggested.getByRole('button', { name: /^fetch-secret-for-runtime / }).click()
  await expect(skill.getByRole('button', { name: 'Added to Skills', exact: true })).toBeDisabled()
  await skill.getByRole('button', { name: 'Cancel', exact: true }).click()
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await main
    .getByRole('navigation', { name: 'Integration categories' })
    .getByRole('link', { name: 'Skills', exact: true })
    .click()
  const installed = main.getByRole('button', { name: /^runtime-vault-lookup / })
  await expect(installed).toHaveCount(1)
  await installed.click()
  await expect(editor.getByRole('textbox', { name: 'Instructions', exact: true })).toHaveValue(
    editedInstructions
  )
})

test('adding another credential preserves existing accounts and its details survive immediate browser back', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=full`)
  const list = page.getByRole('main')
  await list.getByRole('searchbox', { name: 'Search apps' }).fill('gmail')
  await list.getByRole('link', { name: /^Gmail / }).click()
  const guide = list.getByRole('link', { name: 'Docs', exact: true })
  await expect(guide).toHaveAttribute('href', 'https://docs.sim.ai/search/gmail')
  await expect(guide).toHaveAttribute('target', '_blank')
  const credentials = list.getByRole('region', { name: 'Connected credentials', exact: true })
  const original = credentials.getByRole('button', { name: /^emir@sim.ai / })
  await expect(original).toBeVisible()
  await list.getByRole('button', { name: 'Connect integration', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Connect with OAuth', exact: true }).click()
  const connect = page.getByRole('dialog', { name: 'Connect Gmail', exact: true })
  await connect.getByRole('textbox', { name: 'Display name', exact: true }).fill('Secondary Gmail')
  await connect.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(original).toBeVisible()
  await credentials.getByRole('button', { name: /^Secondary Gmail / }).click()
  await expect(list.getByRole('heading', { name: 'Secondary Gmail', exact: true })).toBeVisible()
  await page.goBack()
  await expect(credentials).toBeVisible()
  await credentials.getByRole('button', { name: /^Secondary Gmail / }).click()
  await list
    .getByRole('textbox', { name: 'Display name', exact: true })
    .fill('Gmail account review')
  await list.getByRole('button', { name: 'Save changes', exact: true }).click()
  await list.getByRole('link', { name: 'Integrations', exact: true }).click()
  await expect(list.getByRole('searchbox')).toHaveValue('gmail')
  await list.getByRole('link', { name: /^Gmail / }).click()
  await credentials.getByRole('button', { name: /^Gmail account review / }).click()
  await list.getByRole('button', { name: 'Credential actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Disconnect', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Disconnect Gmail account review?', exact: true })
    .getByRole('button', { name: 'Disconnect', exact: true })
    .click()
  await expect(credentials.getByRole('button', { name: /^Gmail account review / })).toHaveCount(0)
  await expect(original).toBeVisible()
})

test('a private connection keeps its identity when shared and protects its only administrator', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations/gmail?state=full`)
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Connect integration', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Connect with OAuth', exact: true }).click()
  const connect = page.getByRole('dialog', { name: 'Connect Gmail', exact: true })
  await connect
    .getByRole('textbox', { name: 'Display name', exact: true })
    .fill('Account follow-ups')
  await connect
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Personal follow-up drafts.')
  await expect(connect.getByRole('combobox', { name: 'Workspace', exact: true })).toHaveCount(0)
  await expect(connect.getByRole('link', { name: 'Docs', exact: true })).toHaveCount(0)
  await connect.getByRole('button', { name: 'Continue', exact: true }).click()
  await main.getByRole('button', { name: /^Account follow-ups / }).click()
  const id = main.getByRole('textbox', { name: 'Credential ID', exact: true })
  const originalId = await id.inputValue()
  const people = main.getByRole('region', { name: 'People with access', exact: true })
  await expect(people.getByRole('listitem')).toHaveCount(1)
  await people.getByRole('button', { name: 'Manage access for Emir Karabeg', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Leave', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await main.getByRole('textbox', { name: 'Description', exact: true }).fill('Discard this edit')
  await main.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(main.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
    'Personal follow-up drafts.'
  )
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await main
    .getByRole('navigation', { name: 'Integration categories' })
    .getByRole('link', { name: 'Credentials', exact: true })
    .click()
  const row = main.getByRole('link', { name: /^Account follow-ups / })
  await main.getByRole('button', { name: /^Category:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Shared', exact: true }).click()
  await expect(row).toHaveCount(0)
  await main.getByRole('button', { name: /^Category:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Personal', exact: true }).click()
  await row.click()
  await people.getByRole('button', { name: 'Add people', exact: true }).click()
  const add = page.getByRole('dialog', { name: 'Add people', exact: true })
  await add.getByRole('combobox', { name: 'Person', exact: true }).click()
  await page.getByRole('option', { name: 'Nina Patel', exact: true }).click()
  await add.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(people.getByRole('listitem')).toHaveCount(2)
  await expect(id).toHaveValue(originalId)
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await expect(row).toHaveCount(0)
  await main.getByRole('button', { name: /^Category:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Shared', exact: true }).click()
  await row.click()
  await expect(id).toHaveValue(originalId)
  await expect(people.getByText('Nina Patel', { exact: true })).toBeVisible()
})

test('Fireflies uses its managed MCP method and keeps every template in page flow', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations/fireflies?state=full`)
  const main = page.getByRole('main')
  const templates = main.getByRole('region', { name: 'Agent templates', exact: true })
  await expect(templates.getByRole('listitem')).toHaveCount(10)
  expect(new Set(await templates.getByRole('listitem').allTextContents()).size).toBe(10)
  await expect(templates.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0)
  await main.getByRole('button', { name: 'Connect integration', exact: true }).click()
  const connect = page.getByRole('dialog', { name: 'Connect Fireflies', exact: true })
  await expect(connect.getByRole('textbox')).toHaveCount(2)
  await expect(
    connect.getByRole('region', { name: 'Connection access', exact: true })
  ).toBeVisible()
  await connect
    .getByRole('textbox', { name: 'Display name', exact: true })
    .fill('Meeting follow-ups')
  await connect.getByRole('button', { name: 'Continue', exact: true }).click()
  await main.getByRole('button', { name: /^Meeting follow-ups / }).click()
  await expect(main.getByRole('region', { name: 'People with access', exact: true })).toHaveCount(0)
  await main.getByRole('button', { name: 'Credential actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reconnect', exact: true }).click()
  await expect(
    page
      .getByRole('dialog', { name: 'Reconnect Meeting follow-ups', exact: true })
      .getByRole('textbox')
  ).toHaveCount(2)
})

test('shared family credential edits and access changes propagate without removing the last explicit admin', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=full`)
  const main = page.getByRole('main')
  await main.getByRole('link', { name: /^Google Sheets / }).click()
  await expect(
    main
      .getByRole('region', { name: 'Connected credentials', exact: true })
      .getByRole('button', { name: /^Customer operations service account / })
  ).toBeVisible()
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await main.getByRole('link', { name: /^Gmail / }).click()
  await expect(
    main.getByRole('region', { name: 'Connected credentials', exact: true })
  ).toBeVisible()
  await main
    .getByRole('region', { name: 'Connected credentials', exact: true })
    .getByRole('button', { name: /^Customer operations service account / })
    .click()
  const people = main.getByRole('region', { name: 'People with access', exact: true })
  await people.getByRole('button', { name: 'Manage access for Nina Patel', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Remove', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await people.getByRole('button', { name: 'Manage access for Emir Karabeg', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Leave', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await people.getByRole('button', { name: 'Add people', exact: true }).click()
  const add = page.getByRole('dialog', { name: 'Add people', exact: true })
  await add.getByRole('combobox', { name: 'Person', exact: true }).click()
  await page.getByRole('option', { name: 'Maya Thompson', exact: true }).click()
  await add.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(people.getByText('Maya Thompson', { exact: true })).toBeVisible()
  await people.getByRole('button', { name: /^Role for Alex Chen:/ }).click()
  await page.getByRole('menuitemradio', { name: 'Admin', exact: true }).click()
  await people.getByRole('button', { name: 'Manage access for Nina Patel', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Remove', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Remove Nina Patel?', exact: true })
    .getByRole('button', { name: 'Remove', exact: true })
    .click()
  await expect(people.getByText('Nina Patel', { exact: true })).toHaveCount(0)
  await main
    .getByRole('textbox', { name: 'Display name', exact: true })
    .fill('Shared Google operations')
  await main.getByRole('button', { name: 'Save changes', exact: true }).click()
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  const tabs = main.getByRole('navigation', { name: 'Integration categories' })
  await tabs.getByRole('link', { name: 'Credentials', exact: true }).click()
  const sharedCredential = main.getByRole('link', { name: /^Shared Google operations / })
  await expect(sharedCredential).toHaveCount(1)
  await sharedCredential.click()
  await expect(
    main.getByRole('heading', { name: 'Shared Google operations', exact: true })
  ).toBeVisible()
  await page.goBack()
  await expect(
    main.getByRole('searchbox', { name: 'Search credentials', exact: true })
  ).toBeVisible()
  await tabs.getByRole('link', { name: 'Apps', exact: true }).click()
  await main.getByRole('link', { name: /^Google Drive / }).click()
  await main
    .getByRole('region', { name: 'Connected credentials', exact: true })
    .getByRole('button', { name: /^Shared Google operations / })
    .click()
  await expect(people.getByText('Maya Thompson', { exact: true })).toBeVisible()
  await expect(people.getByText('Nina Patel', { exact: true })).toHaveCount(0)
  await people.getByRole('button', { name: 'Manage access for Alex Chen', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Remove', exact: true })).toBeDisabled()
})

test('service-account branches validate active fields and discard secrets after reconnecting', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url())
  })
  await page.goto(`${origin}/integrations/salesforce?state=full`)
  const main = page.getByRole('main')
  await expect(main.getByRole('button', { name: 'Connect integration', exact: true })).toBeVisible()
  await main.getByRole('button', { name: 'Connect integration', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Add integration user app', exact: true }).click()
  const connect = page.getByRole('dialog', { name: 'Connect Salesforce', exact: true })
  await connect
    .getByRole('textbox', { name: 'Display name', exact: true })
    .fill('Salesforce reporting')
  await connect.getByRole('textbox', { name: 'Consumer key', exact: true }).fill('test-consumer')
  await connect
    .getByRole('textbox', { name: 'My Domain host', exact: true })
    .fill('test.my.salesforce.com')
  await expect(connect.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled()
  await connect.getByRole('combobox', { name: 'Authentication method', exact: true }).click()
  await page.getByRole('option', { name: 'JWT bearer (private key)', exact: true }).click()
  await expect(connect.getByLabel('Consumer secret', { exact: true })).toHaveCount(0)
  await connect
    .getByRole('textbox', { name: 'Private key', exact: true })
    .fill('not-a-real-private-key')
  await expect(connect.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled()
  await connect
    .getByRole('textbox', { name: 'Run as username', exact: true })
    .fill('reporting@example.com')
  await connect.getByRole('button', { name: 'Connect', exact: true }).click()
  await main.getByRole('button', { name: /^Salesforce reporting / }).click()
  await main.getByRole('button', { name: 'Credential actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reconnect', exact: true }).click()
  const reconnect = page.getByRole('dialog', {
    name: 'Reconnect Salesforce reporting',
    exact: true,
  })
  await reconnect.getByRole('combobox', { name: 'Authentication method', exact: true }).click()
  await page.getByRole('option', { name: 'JWT bearer (private key)', exact: true }).click()
  await expect(reconnect.getByRole('textbox', { name: 'Private key', exact: true })).toHaveValue('')
  await expect(reconnect.getByRole('button', { name: 'Reconnect', exact: true })).toBeDisabled()
  await reconnect.getByRole('button', { name: 'Cancel', exact: true }).click()
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(storage).not.toContain('not-a-real-private-key')
  expect(writes).toEqual([])
})

test('a Google JSON credential is validated before joining every app in its family and never prefills a key', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations/gmail?state=full`)
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Connect integration', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Add service account', exact: true }).click()
  const connect = page.getByRole('dialog', { name: 'Connect Gmail', exact: true })
  await connect
    .getByRole('textbox', { name: 'Display name', exact: true })
    .fill('Google reporting key')
  await connect
    .getByRole('textbox', { name: 'JSON key', exact: true })
    .fill('{"type":"service_account"}')
  await connect.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(connect.getByRole('alert')).toContainText(
    'service account email, private key, and project ID'
  )
  await connect.getByLabel('Or upload a JSON key', { exact: true }).setInputFiles({
    name: 'service-account.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'service_account',
        client_email: 'test@example.iam.gserviceaccount.com',
        private_key: 'fixture-private-key',
        project_id: 'fixture-project',
      })
    ),
  })
  await connect
    .getByRole('textbox', { name: 'Display name', exact: true })
    .fill('Google reporting key')
  await connect.getByRole('button', { name: 'Connect', exact: true }).click()
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await main.getByRole('link', { name: /^Google Drive / }).click()
  const credentials = main.getByRole('region', { name: 'Connected credentials', exact: true })
  await expect(credentials.getByRole('button', { name: /^Google reporting key / })).toBeVisible()
  await credentials.getByRole('button', { name: /^Google reporting key / }).click()
  await main.getByRole('button', { name: 'Credential actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reconnect', exact: true }).click()
  const reconnect = page.getByRole('dialog', {
    name: 'Reconnect Google reporting key',
    exact: true,
  })
  await expect(reconnect.getByRole('textbox', { name: 'JSON key', exact: true })).toHaveValue('')
  await expect(reconnect.getByRole('button', { name: 'Reconnect', exact: true })).toBeDisabled()
  await reconnect.getByRole('button', { name: 'Cancel', exact: true }).click()
  await main.getByRole('button', { name: 'Credential actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Disconnect', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Disconnect Google reporting key?', exact: true })
    .getByRole('button', { name: 'Disconnect', exact: true })
    .click()
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await main.getByRole('link', { name: /^Gmail / }).click()
  await expect(credentials.getByRole('button', { name: /^Google reporting key / })).toHaveCount(0)
  await expect(credentials.getByRole('button', { name: /^emir@sim.ai / })).toBeVisible()
})

test('Slack bot steps preserve configuration when going back and clear secrets on a new connection', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations/slack?state=full`)
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Connect integration', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Set up a custom bot', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(
    modal.getByRole('heading', { name: 'Configure Slack bot', exact: true })
  ).toBeVisible()
  await modal.getByRole('textbox', { name: 'Bot name', exact: true }).fill('Review Bot')
  await modal.getByRole('combobox', { name: /^Additional permissions:/ }).click()
  await expect(page.getByRole('option', { name: '@mention', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await page.getByRole('option', { name: 'Direct message', exact: true }).click()
  await page.keyboard.press('Escape')
  await modal.getByRole('button', { name: 'Add command', exact: true }).click()
  await modal.getByRole('textbox', { name: 'Slash command 1', exact: true }).fill('/review')
  await modal
    .getByRole('textbox', { name: 'Command 1 description', exact: true })
    .fill('Review an account')
  await modal.getByRole('button', { name: 'Add command', exact: true }).click()
  await modal.getByRole('textbox', { name: 'Slash command 2', exact: true }).fill('/review')
  await modal
    .getByRole('textbox', { name: 'Command 2 description', exact: true })
    .fill('Duplicate command')
  await expect(modal.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
  await modal.getByRole('button', { name: 'Remove slash command 2', exact: true }).click()
  await modal.getByRole('button', { name: 'Continue', exact: true }).click()
  const selected = modal.getByRole('region', { name: 'Selected permissions', exact: true })
  await expect(selected.getByText('@mention', { exact: true })).toBeVisible()
  await expect(selected.getByText('Direct message', { exact: true })).toHaveCount(0)
  await modal.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(modal.getByRole('textbox', { name: 'Slash command 1', exact: true })).toHaveValue(
    '/review'
  )
  await modal.getByRole('button', { name: 'Continue', exact: true }).click()
  await modal.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(modal.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
  await modal.getByLabel('Bot token', { exact: true }).fill('xoxb-fixture-token')
  await modal.getByRole('button', { name: 'Continue', exact: true }).click()
  await modal.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(modal.getByLabel('Bot token', { exact: true })).toHaveValue('xoxb-fixture-token')
  await modal.getByRole('button', { name: 'Continue', exact: true }).click()
  await modal.getByLabel('Signing secret', { exact: true }).fill('fixture-signing-secret')
  await modal.getByRole('button', { name: 'Connect bot', exact: true }).click()
  await main.getByRole('button', { name: /^Review Bot / }).click()
  await main.getByRole('button', { name: 'Credential actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reconnect', exact: true }).click()
  const reconnect = page.getByRole('dialog')
  await expect(
    reconnect.getByRole('heading', { name: 'Reconnect Slack bot', exact: true })
  ).toBeVisible()
  await expect(reconnect.getByRole('textbox', { name: 'Bot name', exact: true })).toHaveValue(
    'Review Bot'
  )
  await expect(reconnect.getByRole('button', { name: 'Add command', exact: true })).toHaveCount(0)
  await reconnect.getByRole('button', { name: 'Continue', exact: true }).click()
  await reconnect.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(reconnect.getByLabel('Bot token', { exact: true })).toHaveValue('')
  await expect(reconnect.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(storage).not.toContain('xoxb-fixture-token')
  expect(storage).not.toContain('fixture-signing-secret')
})

test('Dataverse retains an immutable environment binding when reconnecting a named credential', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations/microsoft_dataverse?state=full`)
  const main = page.getByRole('main')
  await main.getByRole('button', { name: 'Connect integration', exact: true }).click()
  const connect = page.getByRole('dialog', { name: 'Connect Microsoft Dataverse', exact: true })
  await connect
    .getByRole('textbox', { name: 'Display name', exact: true })
    .fill('Sales environment')
  await connect
    .getByRole('textbox', { name: 'Environment URL', exact: true })
    .fill('https://sales.crm.dynamics.com/path')
  await connect.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(connect.getByRole('alert')).toContainText('without a path')
  await connect
    .getByRole('textbox', { name: 'Environment URL', exact: true })
    .fill('https://sales.crm.dynamics.com/')
  await connect.getByRole('button', { name: 'Continue', exact: true }).click()
  await main
    .getByRole('region', { name: 'Connected credentials', exact: true })
    .getByRole('button', { name: /^Sales environment / })
    .click()
  await expect(main.getByRole('textbox', { name: 'Environment URL', exact: true })).toHaveValue(
    'https://sales.crm.dynamics.com'
  )
  await main.getByRole('button', { name: 'Credential actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reconnect', exact: true }).click()
  const reconnect = page.getByRole('dialog', { name: 'Reconnect Sales environment', exact: true })
  const environment = reconnect.getByRole('textbox', { name: 'Environment URL', exact: true })
  await expect(environment).toHaveValue('https://sales.crm.dynamics.com')
  await expect(environment).toHaveAttribute('readonly', '')
  await reconnect.getByRole('button', { name: 'Reconnect', exact: true }).click()
  await expect(main.getByRole('textbox', { name: 'Environment URL', exact: true })).toHaveValue(
    'https://sales.crm.dynamics.com'
  )
})

test('member credentials withhold administration and personal tokens never offer sharing', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations/github?state=stress`)
  const main = page.getByRole('main')
  await main
    .getByRole('region', { name: 'Connected credentials', exact: true })
    .getByRole('button', { name: /^Engineering repositories / })
    .click()
  await expect(main.getByRole('textbox', { name: 'Display name', exact: true })).toHaveAttribute(
    'readonly',
    ''
  )
  await expect(main.getByRole('button', { name: 'Credential actions', exact: true })).toHaveCount(0)
  await expect(main.getByRole('button', { name: 'Add people', exact: true })).toHaveCount(0)
  await main.getByRole('button', { name: 'Manage access for Emir Karabeg', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Leave', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Leave credential?', exact: true })
    .getByRole('button', { name: 'Leave', exact: true })
    .click()
  await expect(main.getByRole('button', { name: /^Engineering repositories / })).toHaveCount(0)
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  await main.getByRole('link', { name: /^GitLab / }).click()
  await main
    .getByRole('region', { name: 'Connected credentials', exact: true })
    .getByRole('button', { name: /^My GitLab account / })
    .click()
  await expect(main.getByRole('region', { name: 'People with access', exact: true })).toHaveCount(0)
  await main.getByRole('button', { name: 'Credential actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reconnect', exact: true }).click()
  const reconnect = page.getByRole('dialog', { name: 'Reconnect My GitLab account', exact: true })
  await expect(reconnect.getByRole('combobox', { name: 'Workspace', exact: true })).toHaveCount(0)
  await expect(reconnect.getByLabel('Personal access token', { exact: true })).toHaveValue('')
  await expect(reconnect.getByRole('button', { name: 'Reconnect', exact: true })).toBeDisabled()
})

test('individual permissions inherit their default without changing other tools', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations/gmail?state=full`)
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Connect integration', exact: true })
    .click()
  await page.getByRole('menuitem', { name: 'Connect with OAuth', exact: true }).click()
  const connect = page.getByRole('dialog', { name: 'Connect Gmail', exact: true })
  const access = connect.getByRole('region', { name: 'Requested permissions' })
  const writeScopes = access.getByRole('region', { name: 'Write and manage' })
  await expect(
    writeScopes.getByText('Read, compose, send, and modify email messages', { exact: true })
  ).toBeVisible()
  await connect.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page
    .getByRole('region', { name: 'Connected credentials', exact: true })
    .getByRole('button', { name: /^emir@sim.ai / })
    .click()
  const tools = page.getByRole('region', { name: 'Tool permissions' })
  const send = tools.getByRole('group', { name: 'Gmail Send permission' })
  const draft = tools.getByRole('group', { name: 'Gmail Draft permission' })
  await send.getByRole('radio', { name: 'Block' }).check()
  await expect(draft.getByRole('radio', { name: 'Ask' })).toBeChecked()
  await page.getByRole('main').getByRole('link', { name: 'Integrations', exact: true }).click()
  await page.getByRole('link', { name: /^Gmail / }).click()
  await page
    .getByRole('region', { name: 'Connected credentials', exact: true })
    .getByRole('button', { name: /^emir@sim.ai / })
    .click()
  await expect(send.getByRole('radio', { name: 'Block' })).toBeChecked()
  await send.getByRole('radio', { name: 'Ask' }).check()
  await expect(send).toHaveAccessibleDescription('Inherits Ask from write tools.')
  const query = tools.getByRole('searchbox', { name: 'Search tools' })
  await query.fill('draft')
  await expect(draft).toBeVisible()
  await expect(send).toHaveCount(0)
  await query.fill('unknown-tool')
  await expect(tools.getByText('No matching tools', { exact: true })).toBeVisible()
  await page.goto(`${origin}/integrations/gmail?state=stress`)
  await page
    .getByRole('region', { name: 'Connected credentials', exact: true })
    .getByRole('button', { name: /^emir@sim.ai / })
    .click()
  await expect(send.getByRole('radio', { name: 'Allow' })).toBeDisabled()
})

test('a cleared integration search stays clear when opening a provider and returning', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=full&q=Fireflies`)
  const main = page.getByRole('main')
  const field = main.getByRole('searchbox', { name: 'Search apps' })
  await page
    .getByRole('region', { name: 'Platform navigation' })
    .getByRole('link', { name: 'Integrations', exact: true })
    .click()
  await expect(field).toHaveValue('')
  await field.fill('Nonexistent')
  await field.fill('emir')
  await main.getByRole('button', { name: 'Clear search' }).click()
  await main.getByRole('link', { name: /^Linear / }).click()
  await expect(main.getByRole('heading', { name: 'Linear', exact: true })).toBeVisible()
  await page.goBack()
  await expect(field).toHaveValue('')
  await expect(main.getByRole('link', { name: /^Fireflies / })).toBeVisible()
})

test('managed, unconfigured and retained connections expose only the actions the member can take', async ({
  page,
}) => {
  await page.goto(`${origin}/integrations?state=stress`)
  const main = page.getByRole('main')
  const fireflies = main.getByRole('link', { name: /^Fireflies / })
  await expect(fireflies).toContainText('meeting transcripts and recordings')
  await fireflies.click()
  await expect(main.getByRole('region', { name: 'Connected credentials' })).toContainText(
    'Fireflies'
  )
  await main
    .getByRole('region', { name: 'Connected credentials', exact: true })
    .getByRole('button', { name: /^Fireflies / })
    .click()
  await main.getByRole('button', { name: 'Credential actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Reconnect', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(main.getByRole('radio')).toHaveCount(0)
  await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  for (const provider of ['GitLab', 'Slack', 'Granola', 'Zoom']) {
    await main.getByRole('link', { name: new RegExp(`^${provider} `) }).click()
    const docs = main.getByRole('link', { name: /Docs/ })
    await expect(docs).toHaveAttribute(
      'href',
      `https://docs.sim.ai/search/${provider.toLowerCase()}`
    )
    await expect(main.getByRole('button', { name: provider, exact: true })).toHaveCount(0)
    await main.getByRole('link', { name: 'Integrations', exact: true }).click()
  }
  await main.getByRole('link', { name: /^Confluence / }).click()
  await main
    .getByRole('region', { name: 'Connected credentials', exact: true })
    .getByRole('button', { name: /^engineering@sim.ai / })
    .click()
  await main.getByRole('button', { name: 'Credential actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Disconnect', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Reconnect', exact: true })).toHaveCount(0)
})

test('a single click opens a member credential at 200 percent text size', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 820 })
  await page.goto(`${origin}/integrations?state=full`)
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await page.getByRole('link', { name: /^Gmail / }).click()
  await page
    .getByRole('region', { name: 'Connected credentials', exact: true })
    .getByRole('button', { name: /^emir@sim.ai / })
    .click()
  const tools = page.getByRole('region', { name: 'Tool permissions' })
  const choices = tools.getByRole('group', { name: 'Gmail Send permission' })
  await expect(choices).toBeVisible()
  for (const policy of ['Allow', 'Ask', 'Block']) {
    const lines = await choices.getByText(policy, { exact: true }).evaluate((label) => {
      const range = document.createRange()
      range.selectNodeContents(label)
      return new Set(Array.from(range.getClientRects(), (rect) => rect.top)).size
    })
    expect(lines).toBe(1)
  }
})

test('an empty member inventory gates both the index and deep links', async ({ page }) => {
  await page.goto(`${origin}/integrations?state=empty`)
  await expect(page.getByRole('heading', { name: 'No apps yet' })).toBeVisible()
  await page.goto(`${origin}/integrations/gmail?state=empty`)
  await expect(page.getByRole('heading', { name: 'Gmail', exact: true })).toHaveCount(0)
  await expect(page.getByText('emir@sim.ai', { exact: true })).toHaveCount(0)
})
