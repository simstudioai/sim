import type { Page } from '@playwright/test'
import { absoluteE2eUrl } from '../navigation/contract-resolver'
import { expect, test } from './credential-test'
import {
  attemptWorkspaceApiKeyCreate,
  attemptWorkspaceApiKeyDelete,
  deleteApiKeyByName,
  expectWorkspaceSettingsReady,
  listApiKeys,
  newPersonaPage,
  setWorkspacePersonalKeyPolicy,
  uniqueResourceName,
  waitForSameOriginResponse,
  workspaceId,
  workspacePersonalKeyPolicy,
} from './helpers'

test('creates and revokes a personal API key from account settings', async ({
  contextForPersona,
  credentialCleanup,
}) => {
  const page = await newPersonaPage(contextForPersona, 'personalPaidOwner', credentialCleanup)
  const name = uniqueResourceName('account-personal-key')
  credentialCleanup.register('account personal API key cleanup', async () => {
    expect(await deleteApiKeyByName(page, 'personal', name)).toBe(200)
  })

  await page.goto(absoluteE2eUrl('/account/settings/api-keys'))
  await expect(page.getByRole('textbox', { name: 'Search API keys...', exact: true })).toBeVisible()
  await expectApiKeysReady(page)
  await createApiKeyThroughUi(page, name, {
    responsePath: '/api/users/me/api-keys',
  })

  const listed = await expectKeyByName(page, 'personal', name)
  await deleteApiKeyThroughUi(page, name, `/api/users/me/api-keys/${listed.id}`)
  await expectKeyAbsent(page, 'personal', name)
})

test('workspace admin creates and revokes a workspace API key', async ({
  contextForPersona,
  credentialCleanup,
  personaManifest,
}) => {
  const page = await newPersonaPage(contextForPersona, 'workspaceAdminMember', credentialCleanup)
  const targetWorkspaceId = workspaceId(personaManifest)
  const name = uniqueResourceName('workspace-admin-key')
  credentialCleanup.register('workspace admin API key cleanup', async () => {
    expect(await deleteApiKeyByName(page, 'workspace', name, targetWorkspaceId)).toBe(200)
  })

  await page.goto(absoluteE2eUrl(`/workspace/${targetWorkspaceId}/settings/apikeys`))
  await expectWorkspaceSettingsReady(page)
  await expectApiKeysReady(page)
  await createApiKeyThroughUi(page, name, {
    keyType: 'Workspace',
    responsePath: `/api/workspaces/${targetWorkspaceId}/api-keys`,
  })

  const listed = await expectKeyByName(page, 'workspace', name, targetWorkspaceId)
  await deleteApiKeyThroughUi(
    page,
    name,
    `/api/workspaces/${targetWorkspaceId}/api-keys/${listed.id}`
  )
  await expectKeyAbsent(page, 'workspace', name, targetWorkspaceId)
})

test('write member cannot create or revoke workspace API keys', async ({
  contextForPersona,
  credentialCleanup,
  personaManifest,
}) => {
  const adminPage = await newPersonaPage(
    contextForPersona,
    'workspaceAdminMember',
    credentialCleanup
  )
  const writePage = await newPersonaPage(
    contextForPersona,
    'workspaceWriteMember',
    credentialCleanup
  )
  const targetWorkspaceId = workspaceId(personaManifest)
  const name = uniqueResourceName('workspace-write-denial')
  credentialCleanup.register('workspace write-denial API key cleanup', async () => {
    expect(await deleteApiKeyByName(adminPage, 'workspace', name, targetWorkspaceId)).toBe(200)
  })

  await adminPage.goto(absoluteE2eUrl(`/workspace/${targetWorkspaceId}/settings/apikeys`))
  await expectWorkspaceSettingsReady(adminPage)
  await expectApiKeysReady(adminPage)
  await createApiKeyThroughUi(adminPage, name, {
    keyType: 'Workspace',
    responsePath: `/api/workspaces/${targetWorkspaceId}/api-keys`,
  })
  const listed = await expectKeyByName(adminPage, 'workspace', name, targetWorkspaceId)

  await writePage.goto(absoluteE2eUrl(`/workspace/${targetWorkspaceId}/settings/apikeys`))
  await expectWorkspaceSettingsReady(writePage)
  await expectApiKeysReady(writePage)
  const row = writePage.getByRole('group', { name, exact: true })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'API key actions', exact: true }).click()
  await expect(writePage.getByRole('menuitem', { name: 'Delete', exact: true })).toBeDisabled()
  await writePage.keyboard.press('Escape')

  const forbiddenName = uniqueResourceName('forbidden-workspace-key')
  credentialCleanup.register('forbidden workspace API key cleanup', async () => {
    expect(await deleteApiKeyByName(adminPage, 'workspace', forbiddenName, targetWorkspaceId)).toBe(
      200
    )
  })
  expect(await attemptWorkspaceApiKeyCreate(writePage, targetWorkspaceId, forbiddenName)).toBe(403)
  expect(await attemptWorkspaceApiKeyDelete(writePage, targetWorkspaceId, listed.id)).toBe(403)
  expect(await expectKeyByName(adminPage, 'workspace', name, targetWorkspaceId)).toMatchObject({
    id: listed.id,
  })
})

test('workspace personal-key policy gates combined-page creation', async ({
  contextForPersona,
  credentialCleanup,
  personaManifest,
}) => {
  const adminPage = await newPersonaPage(
    contextForPersona,
    'workspaceAdminMember',
    credentialCleanup
  )
  const writePage = await newPersonaPage(
    contextForPersona,
    'workspaceWriteMember',
    credentialCleanup
  )
  const targetWorkspaceId = workspaceId(personaManifest)
  const name = uniqueResourceName('workspace-personal-policy')

  expect(await setWorkspacePersonalKeyPolicy(adminPage, targetWorkspaceId, true)).toBe(200)
  expect(await workspacePersonalKeyPolicy(adminPage, targetWorkspaceId)).toEqual({
    status: 200,
    allowed: true,
  })
  credentialCleanup.register('workspace personal-key policy reset', async () => {
    expect(await setWorkspacePersonalKeyPolicy(adminPage, targetWorkspaceId, true)).toBe(200)
    expect(await workspacePersonalKeyPolicy(adminPage, targetWorkspaceId)).toEqual({
      status: 200,
      allowed: true,
    })
  })
  credentialCleanup.register('workspace personal API key cleanup', async () => {
    expect(await deleteApiKeyByName(writePage, 'personal', name)).toBe(200)
  })

  await writePage.goto(absoluteE2eUrl(`/workspace/${targetWorkspaceId}/settings/apikeys`))
  await expectWorkspaceSettingsReady(writePage)
  await expectApiKeysReady(writePage)
  await createApiKeyThroughUi(writePage, name, {
    responsePath: '/api/users/me/api-keys',
  })
  const personalKey = await expectKeyByName(writePage, 'personal', name)
  await deleteApiKeyThroughUi(
    writePage,
    name,
    `/api/users/me/api-keys/${encodeURIComponent(personalKey.id)}`
  )
  await expectKeyAbsent(writePage, 'personal', name)

  await adminPage.goto(absoluteE2eUrl(`/workspace/${targetWorkspaceId}/settings/apikeys`))
  await expectWorkspaceSettingsReady(adminPage)
  await expectApiKeysReady(adminPage)
  const policySwitch = adminPage.getByRole('switch', {
    name: 'Allow personal API keys',
    exact: true,
  })
  await expect(policySwitch).toBeChecked()
  const policyResponse = waitForSameOriginResponse(
    adminPage,
    'PATCH',
    `/api/workspaces/${targetWorkspaceId}`
  )
  await policySwitch.click()
  expect((await policyResponse).status()).toBe(200)
  await expect(policySwitch).not.toBeChecked()
  expect(await workspacePersonalKeyPolicy(adminPage, targetWorkspaceId)).toEqual({
    status: 200,
    allowed: false,
  })

  await writePage.goto(absoluteE2eUrl(`/workspace/${targetWorkspaceId}/settings/apikeys`))
  await expectWorkspaceSettingsReady(writePage)
  await expectApiKeysReady(writePage)
  await expect(
    writePage.getByRole('button', { name: 'Create API key', exact: true })
  ).toBeDisabled()
  expect(await setWorkspacePersonalKeyPolicy(writePage, targetWorkspaceId, true)).toBe(403)
  expect(await workspacePersonalKeyPolicy(adminPage, targetWorkspaceId)).toEqual({
    status: 200,
    allowed: false,
  })
})

interface CreateApiKeyOptions {
  responsePath: string
  keyType?: 'Personal' | 'Workspace'
}

async function expectApiKeysReady(page: Page): Promise<void> {
  const region = page.getByRole('region', { name: 'API keys data', exact: true })
  await expect(region).toHaveAttribute('aria-busy', 'false')
  await expect(region).toHaveAttribute('data-api-keys-state', 'ready')
}

async function createApiKeyThroughUi(
  page: Page,
  name: string,
  options: CreateApiKeyOptions
): Promise<void> {
  await page.getByRole('button', { name: 'Create API key', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create new API key', exact: true })
  await expect(dialog).toBeVisible()
  if (options.keyType) {
    await dialog.getByRole('radio', { name: options.keyType, exact: true }).click()
  }
  await dialog.getByPlaceholder('e.g., Development, Production', { exact: true }).fill(name)
  const response = waitForSameOriginResponse(page, 'POST', options.responsePath)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  expect((await response).status()).toBe(200)

  await page.waitForFunction(() =>
    [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(
      (candidate) =>
        candidate.textContent?.includes('Your API key has been created') &&
        [...candidate.querySelectorAll('button')].some(
          (button) => button.textContent?.trim() === 'Done'
        )
    )
  )
  const revealClosed = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
      (candidate) => candidate.textContent?.includes('Your API key has been created')
    )
    if (!dialog) return false
    for (const code of dialog.querySelectorAll('code')) code.textContent = '[redacted]'
    const done = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'Done'
    )
    done?.click()
    return Boolean(done)
  })
  expect(revealClosed).toBe(true)
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some((candidate) =>
        candidate.textContent?.includes('Your API key has been created')
      )
  )
}

async function expectKeyByName(
  page: Page,
  scope: 'personal' | 'workspace',
  name: string,
  targetWorkspaceId?: string
): Promise<{ id: string; name: string; displayKey: string }> {
  let match: { id: string; name: string; displayKey: string } | undefined
  await expect
    .poll(async () => {
      const listed = await listApiKeys(page, scope, targetWorkspaceId)
      expect(listed.status).toBe(200)
      expect(listed.containsPlaintextField).toBe(false)
      match = listed.keys.find((key) => key.name === name)
      return match
    })
    .toEqual({
      id: expect.any(String),
      name,
      displayKey: expect.stringMatching(/^(?:sk-sim-|sim_)\.\.\.[A-Za-z0-9_-]{4}$/),
    })
  if (!match) throw new Error('Created API key metadata was not found')
  return match
}

async function expectKeyAbsent(
  page: Page,
  scope: 'personal' | 'workspace',
  name: string,
  targetWorkspaceId?: string
): Promise<void> {
  await expect
    .poll(async () => {
      const listed = await listApiKeys(page, scope, targetWorkspaceId)
      return {
        status: listed.status,
        containsPlaintextField: listed.containsPlaintextField,
        present: listed.keys.some((key) => key.name === name),
      }
    })
    .toEqual({ status: 200, containsPlaintextField: false, present: false })
}

async function deleteApiKeyThroughUi(
  page: Page,
  name: string,
  responsePath: string
): Promise<void> {
  const row = page.getByRole('group', { name, exact: true })
  await row.getByRole('button', { name: 'API key actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete API key', exact: true })
  await expect(dialog).toBeVisible()
  const response = waitForSameOriginResponse(page, 'DELETE', responsePath)
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  expect((await response).status()).toBe(200)
  await expect(dialog).toHaveCount(0)
}
