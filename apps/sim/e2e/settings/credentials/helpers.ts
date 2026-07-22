import { randomUUID } from 'node:crypto'
import type { BrowserContext, Locator, Page, Response } from '@playwright/test'
import type { ScenarioManifest } from '../../fixtures/e2e-world'
import { absoluteE2eUrl } from '../navigation/contract-resolver'
import type { CredentialCleanupRegistry } from './credential-test'
import { expect } from './credential-test'

const RUNTIME_SECRET_PREFIX = 'E2E_RUNTIME_SECRET_V1_'

type SecretApiCommand =
  | { kind: 'read-workspace'; workspaceId: string; key: string }
  | { kind: 'upsert-workspace'; workspaceId: string; key: string }
  | { kind: 'delete-workspace'; workspaceId: string; key: string }
  | { kind: 'read-personal'; key: string }
  | { kind: 'remove-personal'; key: string }

export interface SecretApiResult {
  status: number
  readStatus?: number
  present?: boolean
  withheld?: boolean
  fingerprint?: string
}

export interface EnvironmentCredentialMetadata {
  status: number
  id: string | null
  role: string | null
}

export interface ApiKeyListResult {
  status: number
  containsPlaintextField: boolean
  keys: Array<{ id: string; name: string; displayKey: string }>
}

export function uniqueEnvironmentKey(label: string): string {
  return `E2E_${label.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_${randomUUID()
    .replaceAll('-', '')
    .slice(0, 12)
    .toUpperCase()}`
}

export function uniqueResourceName(label: string): string {
  return `e2e-${label}-${randomUUID()}`
}

export function workspaceId(manifest: ScenarioManifest, key = 'team-workspace'): string {
  const id = manifest.worlds['settings-primary']?.workspaceIds[key]
  if (!id) throw new Error(`Missing settings-primary workspace binding: ${key}`)
  return id
}

export async function newPersonaPage(
  contextForPersona: (personaKey: string) => Promise<BrowserContext>,
  personaKey: string,
  cleanup: CredentialCleanupRegistry
): Promise<Page> {
  const context = await contextForPersona(personaKey)
  const page = await context.newPage()
  cleanup.protect(page)
  const response = await page.goto(absoluteE2eUrl('/account/settings/general'))
  if (!response?.ok()) throw new Error('Unable to initialize credential test page origin')
  return page
}

export async function expectWorkspaceSettingsReady(page: Page): Promise<void> {
  const sidebar = page.getByRole('complementary', { name: 'Workspace sidebar' })
  const navigation = sidebar.getByRole('navigation', { name: 'Workspace settings sections' })
  await expect(navigation).toHaveAttribute('aria-busy', 'false')
  await expect(navigation).toHaveAttribute('data-authorization-state', 'granted')
}

export async function setSensitiveInput(locator: Locator): Promise<string> {
  await locator.focus()
  await expect(locator).toHaveJSProperty('readOnly', false)
  try {
    const expectedFingerprint = await locator.evaluate((node, prefix) => {
      if (!(node instanceof HTMLInputElement)) {
        throw new Error('Sensitive credential control is not an input')
      }
      const bytes = new Uint8Array(24)
      crypto.getRandomValues(bytes)
      const token = btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '')
      const value = `${prefix}${token}`
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      if (!setter) throw new Error('Native input value setter is unavailable')
      setter.call(node, value)
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      return fingerprint(value)

      function fingerprint(input: string): string {
        const bytes = new TextEncoder().encode(input)
        return [0xcbf29ce484222325n, 0x84222325cbf29cen]
          .map((seed) => {
            let hash = seed
            for (const byte of bytes) {
              hash ^= BigInt(byte)
              hash = BigInt.asUintN(64, hash * 0x100000001b3n)
            }
            return hash.toString(16).padStart(16, '0')
          })
          .join('')
      }
    }, RUNTIME_SECRET_PREFIX)

    await locator.blur()
    await expect(locator).toHaveJSProperty('readOnly', true)
    await locator.focus()
    const adoptedFingerprint = await sensitiveInputFingerprint(locator)
    expect(adoptedFingerprint).toBe(expectedFingerprint)
    return expectedFingerprint
  } finally {
    await locator.blur().catch(() => undefined)
  }
}

export async function sensitiveInputFingerprint(locator: Locator): Promise<string> {
  await locator.focus()
  await expect(locator).toHaveJSProperty('readOnly', false)
  try {
    return await locator.evaluate((node) => {
      if (!(node instanceof HTMLInputElement)) {
        throw new Error('Sensitive credential control is not an input')
      }
      const bytes = new TextEncoder().encode(node.value)
      return [0xcbf29ce484222325n, 0x84222325cbf29cen]
        .map((seed) => {
          let hash = seed
          for (const byte of bytes) {
            hash ^= BigInt(byte)
            hash = BigInt.asUintN(64, hash * 0x100000001b3n)
          }
          return hash.toString(16).padStart(16, '0')
        })
        .join('')
    })
  } finally {
    await locator.blur().catch(() => undefined)
  }
}

export async function runSecretApi(
  page: Page,
  command: SecretApiCommand
): Promise<SecretApiResult> {
  return page.evaluate(async (operation) => {
    const headers = { 'content-type': 'application/json' }

    if (operation.kind === 'read-workspace') {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(operation.workspaceId)}/environment`
      )
      if (response.status !== 200) return { status: response.status }
      const payload = (await response.json()) as {
        data?: { workspace?: Record<string, string> }
      }
      const value = payload.data?.workspace?.[operation.key]
      return {
        status: response.status,
        present: value !== undefined,
        withheld: value === '',
        ...(value ? { fingerprint: fingerprint(value) } : {}),
      }
    }

    if (operation.kind === 'upsert-workspace') {
      const value = generateSecret()
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(operation.workspaceId)}/environment`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ variables: { [operation.key]: value } }),
        }
      )
      return { status: response.status, fingerprint: fingerprint(value) }
    }

    if (operation.kind === 'delete-workspace') {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(operation.workspaceId)}/environment`,
        {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ keys: [operation.key] }),
        }
      )
      return { status: response.status }
    }

    const readResponse = await fetch('/api/environment')
    if (readResponse.status !== 200) return { status: readResponse.status }
    const payload = (await readResponse.json()) as {
      data?: Record<string, { key: string; value: string }>
    }
    const variables = payload.data ?? {}

    if (operation.kind === 'read-personal') {
      const value = variables[operation.key]?.value
      return {
        status: readResponse.status,
        present: value !== undefined,
        ...(value ? { fingerprint: fingerprint(value) } : {}),
      }
    }

    delete variables[operation.key]
    const preservedVariables = Object.fromEntries(
      Object.entries(variables).map(([key, variable]) => [key, variable.value])
    )
    const writeResponse = await fetch('/api/environment', {
      method: 'POST',
      headers,
      body: JSON.stringify({ variables: preservedVariables }),
    })
    return { status: writeResponse.status, readStatus: readResponse.status }

    function generateSecret(): string {
      const bytes = new Uint8Array(24)
      crypto.getRandomValues(bytes)
      const token = btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '')
      return `E2E_RUNTIME_SECRET_V1_${token}`
    }

    function fingerprint(input: string): string {
      const bytes = new TextEncoder().encode(input)
      return [0xcbf29ce484222325n, 0x84222325cbf29cen]
        .map((seed) => {
          let hash = seed
          for (const byte of bytes) {
            hash ^= BigInt(byte)
            hash = BigInt.asUintN(64, hash * 0x100000001b3n)
          }
          return hash.toString(16).padStart(16, '0')
        })
        .join('')
    }
  }, command)
}

export async function findEnvironmentCredential(
  page: Page,
  workspaceId: string,
  key: string,
  type: 'env_personal' | 'env_workspace' = 'env_workspace'
): Promise<EnvironmentCredentialMetadata> {
  return page.evaluate(
    async ({ workspaceId, key, type }) => {
      const query = new URLSearchParams({ workspaceId, type })
      const response = await fetch(`/api/credentials?${query}`)
      if (response.status !== 200) {
        return { status: response.status, id: null, role: null }
      }
      const payload = (await response.json()) as {
        credentials?: Array<{ id: string; envKey?: string | null; role?: string | null }>
      }
      const match = payload.credentials?.find(({ envKey }) => envKey === key)
      return {
        status: response.status,
        id: match?.id ?? null,
        role: match?.role ?? null,
      }
    },
    { workspaceId, key, type }
  )
}

export async function listApiKeys(
  page: Page,
  scope: 'personal' | 'workspace',
  targetWorkspaceId?: string
): Promise<ApiKeyListResult> {
  return page.evaluate(
    async ({ scope, workspaceId }) => {
      const path =
        scope === 'personal'
          ? '/api/users/me/api-keys'
          : `/api/workspaces/${encodeURIComponent(workspaceId ?? '')}/api-keys`
      const response = await fetch(path)
      if (response.status !== 200) {
        return { status: response.status, containsPlaintextField: false, keys: [] }
      }
      const payload = (await response.json()) as {
        keys?: Array<Record<string, unknown>>
      }
      const keys = payload.keys ?? []
      return {
        status: response.status,
        containsPlaintextField: keys.some((key) => Object.hasOwn(key, 'key')),
        keys: keys.map((key) => ({
          id: String(key.id ?? ''),
          name: String(key.name ?? ''),
          displayKey: String(key.displayKey ?? ''),
        })),
      }
    },
    { scope, workspaceId: targetWorkspaceId }
  )
}

export async function deleteApiKeyByName(
  page: Page,
  scope: 'personal' | 'workspace',
  name: string,
  targetWorkspaceId?: string
): Promise<number> {
  const listed = await listApiKeys(page, scope, targetWorkspaceId)
  if (listed.status !== 200) return listed.status
  const match = listed.keys.find((key) => key.name === name)
  if (!match) return 200
  return page.evaluate(
    async ({ scope, workspaceId, id }) => {
      const path =
        scope === 'personal'
          ? `/api/users/me/api-keys/${encodeURIComponent(id)}`
          : `/api/workspaces/${encodeURIComponent(workspaceId ?? '')}/api-keys/${encodeURIComponent(id)}`
      return (await fetch(path, { method: 'DELETE' })).status
    },
    { scope, workspaceId: targetWorkspaceId, id: match.id }
  )
}

export async function workspacePersonalKeyPolicy(
  page: Page,
  targetWorkspaceId: string
): Promise<{ status: number; allowed?: boolean }> {
  return page.evaluate(async (workspaceId) => {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`)
    if (response.status !== 200) return { status: response.status }
    const payload = (await response.json()) as {
      workspace?: { allowPersonalApiKeys?: boolean }
    }
    const allowed = payload.workspace?.allowPersonalApiKeys
    return typeof allowed === 'boolean'
      ? { status: response.status, allowed }
      : { status: response.status }
  }, targetWorkspaceId)
}

export async function setWorkspacePersonalKeyPolicy(
  page: Page,
  targetWorkspaceId: string,
  allowed: boolean
): Promise<number> {
  return page.evaluate(
    async ({ workspaceId, allowed }) =>
      (
        await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ allowPersonalApiKeys: allowed }),
        })
      ).status,
    { workspaceId: targetWorkspaceId, allowed }
  )
}

export async function attemptWorkspaceApiKeyCreate(
  page: Page,
  targetWorkspaceId: string,
  name: string
): Promise<number> {
  return page.evaluate(
    async ({ workspaceId, name }) =>
      (
        await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/api-keys`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, source: 'settings' }),
        })
      ).status,
    { workspaceId: targetWorkspaceId, name }
  )
}

export async function attemptWorkspaceApiKeyDelete(
  page: Page,
  targetWorkspaceId: string,
  keyId: string
): Promise<number> {
  return page.evaluate(
    async ({ workspaceId, keyId }) =>
      (
        await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/api-keys/${encodeURIComponent(keyId)}`,
          { method: 'DELETE' }
        )
      ).status,
    { workspaceId: targetWorkspaceId, keyId }
  )
}

export function waitForSameOriginResponse(
  page: Page,
  method: string,
  pathname: string
): Promise<Response> {
  const origin = new URL(absoluteE2eUrl('/')).origin
  return page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.origin === origin && url.pathname === pathname && response.request().method() === method
    )
  })
}
