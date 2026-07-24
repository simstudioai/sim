import { absoluteE2eUrl } from '../navigation/contract-resolver'
import { expect, test } from './credential-test'
import {
  expectWorkspaceSettingsReady,
  findEnvironmentCredential,
  newPersonaPage,
  runSecretApi,
  sensitiveInputFingerprint,
  setSensitiveInput,
  uniqueEnvironmentKey,
  waitForSameOriginResponse,
  workspaceId,
} from './helpers'

test('read member manages a personal secret without workspace mutation rights', async ({
  contextForPersona,
  credentialCleanup,
  personaManifest,
}) => {
  const page = await newPersonaPage(contextForPersona, 'workspaceReadMember', credentialCleanup)
  const targetWorkspaceId = workspaceId(personaManifest)
  const key = uniqueEnvironmentKey('PERSONAL_READ_MEMBER')
  credentialCleanup.register('personal secret exact-key cleanup', async () => {
    assertStatus(await runSecretApi(page, { kind: 'remove-personal', key }), 200)
  })

  await page.goto(absoluteE2eUrl(`/workspace/${targetWorkspaceId}/settings/secrets`))
  await expectWorkspaceSettingsReady(page)
  await expect(page.getByRole('textbox', { name: 'Search secrets...', exact: true })).toBeVisible()

  const name = page.getByRole('textbox', { name: 'New personal secret name', exact: true }).first()
  await name.click()
  await name.fill(key)
  const fingerprint = await setSensitiveInput(
    page.getByRole('textbox', { name: `Personal secret value ${key}`, exact: true })
  )
  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeEnabled()
  await save.click()
  await expect
    .poll(() => runSecretApi(page, { kind: 'read-personal', key }))
    .toEqual({
      status: 200,
      present: true,
      fingerprint,
    })

  await page.getByRole('button', { name: `Secret actions for ${key}`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  await expect(save).toBeEnabled()
  await save.click()
  await expect
    .poll(() => runSecretApi(page, { kind: 'read-personal', key }))
    .toEqual({
      status: 200,
      present: false,
    })
})

test('write member completes the workspace secret lifecycle', async ({
  contextForPersona,
  credentialCleanup,
  personaManifest,
}) => {
  const page = await newPersonaPage(contextForPersona, 'workspaceWriteMember', credentialCleanup)
  const targetWorkspaceId = workspaceId(personaManifest)
  const key = uniqueEnvironmentKey('WORKSPACE_LIFECYCLE')
  credentialCleanup.register('workspace secret exact-key cleanup', async () => {
    assertStatus(
      await runSecretApi(page, { kind: 'delete-workspace', workspaceId: targetWorkspaceId, key }),
      200
    )
  })

  await page.goto(absoluteE2eUrl(`/workspace/${targetWorkspaceId}/settings/secrets`))
  await expectWorkspaceSettingsReady(page)

  const newName = page
    .getByRole('textbox', {
      name: 'New workspace secret name',
      exact: true,
    })
    .first()
  await newName.click()
  await newName.fill(key)
  await setSensitiveInput(
    page.getByRole('textbox', { name: 'New workspace secret value', exact: true }).first()
  )
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  expect(
    await runSecretApi(page, {
      kind: 'read-workspace',
      workspaceId: targetWorkspaceId,
      key,
    })
  ).toEqual({ status: 200, present: false, withheld: false })

  await newName.click()
  await newName.fill(key)
  const originalFingerprint = await setSensitiveInput(
    page.getByRole('textbox', { name: 'New workspace secret value', exact: true }).first()
  )
  const createResponse = waitForSameOriginResponse(
    page,
    'PUT',
    `/api/workspaces/${targetWorkspaceId}/environment`
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await createResponse).status()).toBe(200)
  expect(
    await runSecretApi(page, {
      kind: 'read-workspace',
      workspaceId: targetWorkspaceId,
      key,
    })
  ).toEqual({
    status: 200,
    present: true,
    withheld: false,
    fingerprint: originalFingerprint,
  })
  await expect
    .poll(() => findEnvironmentCredential(page, targetWorkspaceId, key))
    .toMatchObject({ status: 200, id: expect.any(String), role: 'admin' })

  const existingValue = page.getByRole('textbox', {
    name: `Workspace secret value ${key}`,
    exact: true,
  })
  await setSensitiveInput(existingValue)
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await page.reload()
  await expectWorkspaceSettingsReady(page)
  expect(
    await runSecretApi(page, {
      kind: 'read-workspace',
      workspaceId: targetWorkspaceId,
      key,
    })
  ).toMatchObject({ status: 200, fingerprint: originalFingerprint })

  const updatedFingerprint = await setSensitiveInput(
    page.getByRole('textbox', { name: `Workspace secret value ${key}`, exact: true })
  )
  const updateResponse = waitForSameOriginResponse(
    page,
    'PUT',
    `/api/workspaces/${targetWorkspaceId}/environment`
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await updateResponse).status()).toBe(200)
  expect(updatedFingerprint).not.toBe(originalFingerprint)
  expect(
    await runSecretApi(page, {
      kind: 'read-workspace',
      workspaceId: targetWorkspaceId,
      key,
    })
  ).toMatchObject({ status: 200, fingerprint: updatedFingerprint })

  await page.getByRole('button', { name: `Secret actions for ${key}`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  const deleteResponse = waitForSameOriginResponse(
    page,
    'DELETE',
    `/api/workspaces/${targetWorkspaceId}/environment`
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await deleteResponse).status()).toBe(200)
  expect(
    await runSecretApi(page, {
      kind: 'read-workspace',
      workspaceId: targetWorkspaceId,
      key,
    })
  ).toMatchObject({ status: 200, present: false })
  await expect
    .poll(() => findEnvironmentCredential(page, targetWorkspaceId, key))
    .toEqual({
      status: 200,
      id: null,
      role: null,
    })
})

test('workspace admin edits a secret from its detail route', async ({
  contextForPersona,
  credentialCleanup,
  personaManifest,
}) => {
  const page = await newPersonaPage(contextForPersona, 'workspaceAdminMember', credentialCleanup)
  const targetWorkspaceId = workspaceId(personaManifest)
  const key = uniqueEnvironmentKey('ADMIN_DETAIL_SAVE')
  credentialCleanup.register('admin detail secret cleanup', async () => {
    assertStatus(
      await runSecretApi(page, { kind: 'delete-workspace', workspaceId: targetWorkspaceId, key }),
      200
    )
  })
  const arranged = await runSecretApi(page, {
    kind: 'upsert-workspace',
    workspaceId: targetWorkspaceId,
    key,
  })
  assertStatus(arranged, 200)
  const credential = await findEnvironmentCredential(page, targetWorkspaceId, key)
  expect(credential).toMatchObject({ status: 200, id: expect.any(String), role: 'admin' })

  await page.goto(
    absoluteE2eUrl(
      `/workspace/${targetWorkspaceId}/settings/secrets/${encodeURIComponent(credential.id ?? '')}`
    )
  )
  await expect(page.getByText('Workspace secret', { exact: true })).toBeVisible()
  const updatedFingerprint = await setSensitiveInput(
    page.getByRole('textbox', { name: 'Secret value', exact: true })
  )
  const saveResponse = waitForSameOriginResponse(
    page,
    'PUT',
    `/api/workspaces/${targetWorkspaceId}/environment`
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await saveResponse).status()).toBe(200)
  expect(
    await runSecretApi(page, {
      kind: 'read-workspace',
      workspaceId: targetWorkspaceId,
      key,
    })
  ).toMatchObject({ status: 200, fingerprint: updatedFingerprint })
})

for (const navigationKind of ['in-app Back', 'browser popstate'] as const) {
  test(`secret detail protects dirty state for ${navigationKind}`, async ({
    contextForPersona,
    credentialCleanup,
    personaManifest,
  }) => {
    const page = await newPersonaPage(contextForPersona, 'workspaceAdminMember', credentialCleanup)
    const targetWorkspaceId = workspaceId(personaManifest)
    const key = uniqueEnvironmentKey(`DETAIL_GUARD_${navigationKind}`)
    credentialCleanup.register('detail guard secret cleanup', async () => {
      assertStatus(
        await runSecretApi(page, { kind: 'delete-workspace', workspaceId: targetWorkspaceId, key }),
        200
      )
    })
    const arranged = await runSecretApi(page, {
      kind: 'upsert-workspace',
      workspaceId: targetWorkspaceId,
      key,
    })
    assertStatus(arranged, 200)
    const credential = await findEnvironmentCredential(page, targetWorkspaceId, key)
    expect(credential.id).toEqual(expect.any(String))
    const listPath = `/workspace/${targetWorkspaceId}/settings/secrets`
    const detailPath = `${listPath}/${encodeURIComponent(credential.id ?? '')}`

    await page.goto(absoluteE2eUrl(listPath))
    await expectWorkspaceSettingsReady(page)
    await page.getByRole('button', { name: `Secret actions for ${key}`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'View details', exact: true }).click()
    await expect(page).toHaveURL(absoluteE2eUrl(detailPath))

    const value = page.getByRole('textbox', { name: 'Secret value', exact: true })
    const dirtyFingerprint = await setSensitiveInput(value)
    const attemptNavigation = async () => {
      if (navigationKind === 'in-app Back') {
        await page.getByRole('link', { name: 'Secrets', exact: true }).click()
      } else {
        await page.evaluate(() => window.history.back())
      }
    }

    await attemptNavigation()
    const dialog = page.getByRole('dialog', { name: 'Unsaved Changes', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page).toHaveURL(absoluteE2eUrl(detailPath))
    expect(await sensitiveInputFingerprint(value)).toBe(dirtyFingerprint)

    await attemptNavigation()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Discard Changes', exact: true }).click()
    await expect(page).toHaveURL(absoluteE2eUrl(listPath))
    expect(
      await runSecretApi(page, {
        kind: 'read-workspace',
        workspaceId: targetWorkspaceId,
        key,
      })
    ).toMatchObject({ status: 200, fingerprint: arranged.fingerprint })
  })
}

test('read member sees masked workspace secret and cannot mutate it', async ({
  contextForPersona,
  credentialCleanup,
  personaManifest,
}) => {
  const adminPage = await newPersonaPage(
    contextForPersona,
    'workspaceAdminMember',
    credentialCleanup
  )
  const readPage = await newPersonaPage(contextForPersona, 'workspaceReadMember', credentialCleanup)
  const targetWorkspaceId = workspaceId(personaManifest)
  const key = uniqueEnvironmentKey('READ_DENIAL')
  credentialCleanup.register('read denial secret cleanup', async () => {
    assertStatus(
      await runSecretApi(adminPage, {
        kind: 'delete-workspace',
        workspaceId: targetWorkspaceId,
        key,
      }),
      200
    )
  })
  assertStatus(
    await runSecretApi(adminPage, {
      kind: 'upsert-workspace',
      workspaceId: targetWorkspaceId,
      key,
    }),
    200
  )
  const credential = await findEnvironmentCredential(adminPage, targetWorkspaceId, key)
  expect(credential.id).toEqual(expect.any(String))

  await readPage.goto(absoluteE2eUrl(`/workspace/${targetWorkspaceId}/settings/secrets`))
  await expectWorkspaceSettingsReady(readPage)
  const value = readPage.getByRole('textbox', {
    name: `Workspace secret value ${key}`,
    exact: true,
  })
  await expect(value).toHaveValue('••••••••••')
  await expect(value).toHaveJSProperty('readOnly', true)
  await readPage.getByRole('button', { name: `Secret actions for ${key}`, exact: true }).click()
  await expect(readPage.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0)
  await readPage.keyboard.press('Escape')
  await expect(readPage.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)

  const detailResponse = await readPage.goto(
    absoluteE2eUrl(
      `/workspace/${targetWorkspaceId}/settings/secrets/${encodeURIComponent(credential.id ?? '')}`
    )
  )
  expect(detailResponse?.status()).toBe(200)
  await expect(readPage.getByText('Workspace secret', { exact: true })).toBeVisible()
  const detailValue = readPage.getByRole('textbox', { name: 'Secret value', exact: true })
  await expect(detailValue).toHaveValue('••••••••••')
  await expect(detailValue).toHaveJSProperty('readOnly', true)
  await expect(readPage.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)

  expect(
    await runSecretApi(readPage, {
      kind: 'read-workspace',
      workspaceId: targetWorkspaceId,
      key,
    })
  ).toEqual({ status: 200, present: true, withheld: true })
  expect(
    await runSecretApi(readPage, {
      kind: 'upsert-workspace',
      workspaceId: targetWorkspaceId,
      key,
    })
  ).toMatchObject({ status: 403 })
  expect(
    await runSecretApi(readPage, {
      kind: 'delete-workspace',
      workspaceId: targetWorkspaceId,
      key,
    })
  ).toEqual({ status: 403 })
})

test('nested secret route rejects cross-workspace credential binding', async ({
  contextForPersona,
  credentialCleanup,
  personaManifest,
}) => {
  const page = await newPersonaPage(contextForPersona, 'paidOrganizationOwner', credentialCleanup)
  const urlWorkspaceId = workspaceId(personaManifest, 'team-workspace')
  const credentialWorkspaceId = workspaceId(personaManifest, 'team-invitation-workspace')
  const key = uniqueEnvironmentKey('CROSS_WORKSPACE')
  credentialCleanup.register('cross-workspace secret cleanup', async () => {
    assertStatus(
      await runSecretApi(page, {
        kind: 'delete-workspace',
        workspaceId: credentialWorkspaceId,
        key,
      }),
      200
    )
  })
  assertStatus(
    await runSecretApi(page, {
      kind: 'upsert-workspace',
      workspaceId: credentialWorkspaceId,
      key,
    }),
    200
  )
  const credential = await findEnvironmentCredential(page, credentialWorkspaceId, key)
  expect(credential.id).toEqual(expect.any(String))

  const response = await page.goto(
    absoluteE2eUrl(
      `/workspace/${urlWorkspaceId}/settings/secrets/${encodeURIComponent(credential.id ?? '')}`
    )
  )
  expect(response?.status()).toBe(404)
})

test('permission-group restriction rejects nested secret detail', async ({
  contextForPersona,
  credentialCleanup,
  personaManifest,
}) => {
  const adminPage = await newPersonaPage(
    contextForPersona,
    'enterpriseOrganizationAdmin',
    credentialCleanup
  )
  const restrictedPage = await newPersonaPage(
    contextForPersona,
    'permissionGroupRestricted',
    credentialCleanup
  )
  const targetWorkspaceId = workspaceId(personaManifest, 'enterprise-workspace')
  const key = uniqueEnvironmentKey('PERMISSION_GROUP_DETAIL')
  credentialCleanup.register('permission-group secret cleanup', async () => {
    assertStatus(
      await runSecretApi(adminPage, {
        kind: 'delete-workspace',
        workspaceId: targetWorkspaceId,
        key,
      }),
      200
    )
  })
  assertStatus(
    await runSecretApi(adminPage, {
      kind: 'upsert-workspace',
      workspaceId: targetWorkspaceId,
      key,
    }),
    200
  )
  const credential = await findEnvironmentCredential(adminPage, targetWorkspaceId, key)
  expect(credential.id).toEqual(expect.any(String))

  const response = await restrictedPage.goto(
    absoluteE2eUrl(
      `/workspace/${targetWorkspaceId}/settings/secrets/${encodeURIComponent(credential.id ?? '')}`
    )
  )
  expect(response?.status()).toBe(404)
})

function assertStatus(result: { status: number }, expected: number): void {
  expect(result.status).toBe(expected)
}
