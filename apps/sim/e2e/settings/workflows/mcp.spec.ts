import {
  deleteRunPrefixedMcpServers,
  expectMcpReady,
  listMcpServers,
  newPersonaPage,
  primaryWorldIds,
  uniqueRunPrefixedName,
  waitForSameOriginResponse,
  workflowResourcePrefix,
  writeMcpWorkflowCompleteMarker,
} from './helpers'
import { expect, test } from './workflow-test'

test('MCP allowlist, discovery, edit, and delete lifecycle uses the real fake server', async ({
  contextForPersona,
  personaManifest,
  registerCleanup,
}) => {
  const ids = primaryWorldIds(personaManifest)
  const namePrefix = workflowResourcePrefix(personaManifest, 'mcp')
  const serverName = uniqueRunPrefixedName(personaManifest, 'mcp')
  const editedServerName = `${serverName}-edited`
  const blockedUrl = `https://blocked-${serverName.slice(-12)}.invalid/mcp`
  const mcpServerUrl = process.env.E2E_MCP_SERVER_URL
  if (!mcpServerUrl) throw new Error('Missing Playwright-only E2E MCP server URL')
  const { context, page } = await newPersonaPage(contextForPersona, 'enterpriseOrganizationAdmin')

  registerCleanup('remove run-prefixed MCP servers', () =>
    deleteRunPrefixedMcpServers(context.request, ids.enterpriseWorkspaceId, namePrefix)
  )
  await deleteRunPrefixedMcpServers(context.request, ids.enterpriseWorkspaceId, namePrefix)

  await page.goto(`/workspace/${encodeURIComponent(ids.enterpriseWorkspaceId)}/settings/mcp`)
  let mcp = await expectMcpReady(page)
  const blockedMutationRequests: string[] = []
  const recordBlockedMutation = (request: import('@playwright/test').Request) => {
    const url = new URL(request.url())
    if (
      (request.method() === 'POST' && url.pathname === '/api/mcp/servers/test-connection') ||
      (request.method() === 'POST' && url.pathname === '/api/mcp/servers')
    ) {
      blockedMutationRequests.push(`${request.method()} ${url.pathname}`)
    }
  }
  page.on('request', recordBlockedMutation)
  await page.getByRole('button', { name: 'Add server', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Add MCP server' })
  await dialog.getByRole('textbox', { name: 'Server Name' }).fill(`${serverName}-blocked`)
  await dialog.getByRole('textbox', { name: 'Server URL' }).fill(blockedUrl)
  await expect(
    dialog.getByText('Domain not permitted by server policy', { exact: true })
  ).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Add server', exact: true })).toBeDisabled()
  expect(blockedMutationRequests).toEqual([])
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  page.off('request', recordBlockedMutation)

  mcp = await expectMcpReady(page)
  await page.getByRole('button', { name: 'Add server', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Add MCP server' })
  await dialog.getByRole('textbox', { name: 'Server Name' }).fill(serverName)
  await dialog.getByRole('textbox', { name: 'Server URL' }).fill(mcpServerUrl)

  const initialTestResponsePromise = waitForSameOriginResponse(
    page,
    'POST',
    '/api/mcp/servers/test-connection'
  )
  const createResponsePromise = waitForSameOriginResponse(page, 'POST', '/api/mcp/servers')
  await dialog.getByRole('button', { name: 'Add server', exact: true }).click()
  const initialTestResponse = await initialTestResponsePromise
  expect(initialTestResponse.status()).toBe(200)
  const initialTestBody = initialTestResponse.request().postDataJSON() as Record<string, unknown>
  expect(initialTestBody).toEqual({
    name: serverName,
    transport: 'streamable-http',
    url: mcpServerUrl,
    headers: {},
    timeout: 30000,
    workspaceId: ids.enterpriseWorkspaceId,
  })
  expect(initialTestBody).not.toHaveProperty('oauthClientId')
  expect(initialTestBody).not.toHaveProperty('oauthClientSecret')

  const createResponse = await createResponsePromise
  expect([200, 201]).toContain(createResponse.status())
  const createRequestBody = createResponse.request().postDataJSON() as Record<string, unknown>
  expect(createRequestBody).toEqual({
    name: serverName,
    transport: 'streamable-http',
    url: mcpServerUrl,
    headers: {},
    timeout: 30000,
    authType: 'none',
    enabled: true,
    workspaceId: ids.enterpriseWorkspaceId,
  })
  const createResponseBody = (await createResponse.json()) as {
    success?: boolean
    data?: { serverId?: string; updated?: boolean }
  }
  expect(createResponseBody.success).toBe(true)
  if (createResponse.status() === 200) expect(createResponseBody.data?.updated).toBe(true)
  else expect(createResponseBody.data?.updated).not.toBe(true)

  const created = (await listMcpServers(context.request, ids.enterpriseWorkspaceId)).find(
    (server) => server.name === serverName
  )
  expect(created).toMatchObject({
    name: serverName,
    workspaceId: ids.enterpriseWorkspaceId,
    url: mcpServerUrl,
    headers: {},
    authType: 'none',
    connectionStatus: 'connected',
  })
  if (!created) throw new Error('Created MCP server was not recoverable')

  mcp = await expectMcpReady(page)
  const serverRow = mcp.getByRole('group', { name: `MCP server ${serverName}` })
  await expect(serverRow).toContainText('1 tool')
  await serverRow.getByRole('button', { name: `Actions for ${serverName}` }).click()
  await page.getByRole('menuitem', { name: 'Details', exact: true }).click()
  mcp = await expectMcpReady(page)
  const tool = mcp.getByRole('button', { name: /e2e_lookup/ })
  await expect(tool).toContainText('e2e_lookup')
  await tool.click()
  await expect(mcp.getByText('query', { exact: true })).toBeVisible()
  await expect(mcp.getByText('string', { exact: true })).toBeVisible()
  await expect(mcp.getByText('required', { exact: true })).toBeVisible()
  await expect(mcp.getByText('Fixture query to look up.', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Edit MCP server' })
  await dialog.getByRole('textbox', { name: 'Server Name' }).fill(editedServerName)
  await expect(dialog.getByRole('textbox', { name: 'Server URL' })).toHaveValue(mcpServerUrl)
  const editTestResponsePromise = waitForSameOriginResponse(
    page,
    'POST',
    '/api/mcp/servers/test-connection'
  )
  const updateResponsePromise = waitForSameOriginResponse(
    page,
    'PATCH',
    `/api/mcp/servers/${encodeURIComponent(created.id)}`,
    { workspaceId: ids.enterpriseWorkspaceId }
  )
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  const editTestResponse = await editTestResponsePromise
  expect(editTestResponse.status()).toBe(200)
  const editTestBody = editTestResponse.request().postDataJSON() as Record<string, unknown>
  expect(editTestBody).toEqual({
    name: editedServerName,
    transport: 'streamable-http',
    url: mcpServerUrl,
    headers: {},
    timeout: 30000,
    workspaceId: ids.enterpriseWorkspaceId,
  })

  const updateResponse = await updateResponsePromise
  expect(updateResponse.status()).toBe(200)
  const updateBody = updateResponse.request().postDataJSON() as Record<string, unknown>
  expect(updateBody).toEqual({
    name: editedServerName,
    transport: 'streamable-http',
    url: mcpServerUrl,
    headers: {},
    timeout: 30000,
    authType: 'none',
    enabled: true,
  })
  expect(updateBody).not.toHaveProperty('oauthClientId')
  expect(updateBody).not.toHaveProperty('oauthClientSecret')
  expect(
    (await listMcpServers(context.request, ids.enterpriseWorkspaceId)).find(
      (server) => server.id === created.id
    )
  ).toMatchObject({
    name: editedServerName,
    url: mcpServerUrl,
    headers: {},
    authType: 'none',
  })

  mcp = await expectMcpReady(page)
  await page
    .getByRole('button', { name: 'MCP tools', exact: true })
    .and(page.locator('button:not([aria-current])'))
    .click()
  mcp = await expectMcpReady(page)
  const editedRow = mcp.getByRole('group', { name: `MCP server ${editedServerName}` })
  await editedRow.getByRole('button', { name: `Actions for ${editedServerName}` }).click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Delete MCP server' })
  const deleteResponsePromise = waitForSameOriginResponse(page, 'DELETE', '/api/mcp/servers', {
    workspaceId: ids.enterpriseWorkspaceId,
    serverId: created.id,
  })
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click()
  expect((await deleteResponsePromise).status()).toBe(200)
  expect(
    (await listMcpServers(context.request, ids.enterpriseWorkspaceId)).some(
      (server) => server.id === created.id
    )
  ).toBe(false)
  await expect(editedRow).toHaveCount(0)

  writeMcpWorkflowCompleteMarker()
})
