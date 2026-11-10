/**
 * @vitest-environment jsdom
 *
 * AWS and Databricks credentials, keyless sign-in included, set up from the Platform's shared
 * service-account dialog. Failure modes: the dialog renders nothing for these providers; keyless
 * sign-in is offered where the deployment or scope cannot complete it, or hidden without a reason;
 * the keyless instructions are missing or carry another subject; the submitted configuration is
 * not the one the legacy dialogs sent (wrong `authType`, a hidden auth type's secret, a dropped
 * subject proof), so server verification diverges; a secret survives a switch to an auth type that
 * does not use it; a server rejection is swallowed; and a reconnect creates a second credential or
 * re-issues the subject the customer's cloud already trusts.
 */
import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { authClientMock } from '@sim/testing/mocks/auth-client.mock'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('@/lib/auth/client', () => authClientMock)

import { ServiceAccountModal } from '@/app/(product)/_components/service-account-modal/service-account-modal'
import type { ResourceScope } from '@/platform/lib/data/credentials'

const WORKSPACE_ID = '3f0c7a52-1b6e-4d2a-9c8f-5e7d1a2b3c4d'
const WORKSPACE: ResourceScope = { kind: 'workspace', workspaceId: WORKSPACE_ID }
const ROLE_ARN = 'arn:aws:iam::123456789012:role/sim-workflows'
const TRUST = {
  available: true,
  issuer: 'https://oidc.sim.test',
  audience: 'sts.amazonaws.com',
  subject: 'sim:workspace:abc:credential:xyz',
  subjectProof: 'proof-123',
  expiresAt: '2026-11-10T01:00:00.000Z',
}

interface RecordedRequest {
  method: string
  path: string
  body: Record<string, unknown>
}

let container: HTMLDivElement
let root: Root
let requests: RecordedRequest[]
let keyless: typeof TRUST | { available: false }
let createFailure: { status: number; body: unknown } | null
let createdIds: string[]

function credentialResponse(id: string) {
  return {
    credential: {
      id,
      workspaceId: WORKSPACE_ID,
      type: 'service_account',
      displayName: 'AWS',
      description: null,
      unredacted: false,
      providerId: 'aws-service-account',
      accountId: null,
      envKey: null,
      envOwnerUserId: null,
      createdBy: 'viewer',
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
    },
  }
}

beforeEach(() => {
  stubResizeObserver()
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false
  }
  Element.prototype.checkVisibility = () => true
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  requests = []
  keyless = TRUST
  createFailure = null
  createdIds = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input), 'https://sim.test')
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      requests.push({ method, path: url.pathname, body })
      if (url.pathname === '/api/credentials/workload-identity') return Response.json(keyless)
      if (url.pathname === '/api/credentials' && method === 'POST') {
        if (createFailure)
          return Response.json(createFailure.body, { status: createFailure.status })
        return Response.json(credentialResponse('cred-new'))
      }
      if (url.pathname.startsWith('/api/credentials/') && method === 'PUT')
        return Response.json(credentialResponse(url.pathname.split('/').at(-1) ?? ''))
      return Response.json({ credentials: [] })
    })
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function settle() {
  for (let round = 0; round < 6; round++) await act(flushMacrotask)
}

async function open(
  providerId: string,
  serviceName: string,
  options: {
    scope?: ResourceScope
    replacedAccount?: { credentialId: string; displayName: string }
  } = {}
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ServiceAccountModal
          open
          onOpenChange={() => {}}
          scope={options.scope ?? WORKSPACE}
          serviceAccountProviderId={providerId}
          serviceName={serviceName}
          onCreated={(id) => createdIds.push(id)}
          replacedAccount={options.replacedAccount}
        />
      </QueryClientProvider>
    )
  )
  await settle()
  const dialog = document.body.querySelector('dialog[open]')
  if (!dialog) throw new Error('The setup dialog did not open')
  return dialog
}

function labelled(dialog: Element, label: string) {
  const caption = [...dialog.querySelectorAll('label')].find(
    (item) => item.textContent?.replace(/\(optional\)\s*$/, '').trim() === label
  )
  if (!caption) return null
  return caption.htmlFor
    ? dialog.querySelector(`#${CSS.escape(caption.htmlFor)}`)
    : caption.querySelector('input, textarea, button')
}

function input(dialog: Element, label: string) {
  const control = labelled(dialog, label)
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement))
    throw new Error(`No ${label} field`)
  return control
}

function type(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    control instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value)
    control.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function button(dialog: Element, text: string) {
  const match = [...dialog.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text
  )
  if (!match) throw new Error(`No ${text} button`)
  return match
}

/** The auth type control shows the chosen type's label. */
function authTypeTrigger(dialog: Element) {
  const trigger = dialog.querySelector('[aria-label="Authentication"]')
  if (!(trigger instanceof HTMLElement)) throw new Error('No Authentication choice')
  return trigger
}

async function chooseAuthType(dialog: Element, label: string) {
  const trigger = authTypeTrigger(dialog)
  act(() => trigger.click())
  await settle()
  const option = authTypeOption(label)
  for (const type of ['pointermove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    act(() => {
      option.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }))
    })
    await settle()
  }
}

function authTypeOption(label: string) {
  const option = [...document.body.querySelectorAll('[role="option"]')].find(
    (item) => item.textContent?.trim() === label
  )
  if (!(option instanceof HTMLElement)) throw new Error(`No ${label} option`)
  return option
}

async function confirm(dialog: Element, text: string) {
  const action = button(dialog, text)
  expect(action.disabled).toBe(false)
  act(() => action.click())
  await settle()
}

function submittedConfig(method = 'POST') {
  const saved = requests.filter(
    (request) =>
      request.method === method &&
      request.path !== '/api/credentials/workload-identity' &&
      request.path.startsWith('/api/credentials')
  )
  expect(saved).toHaveLength(1)
  return {
    body: saved[0].body,
    config: JSON.parse(String(saved[0].body.serviceAccountJson)),
  }
}

it('adds a keyless AWS role: shows what to paste into AWS and submits the signed subject', async () => {
  const dialog = await open('aws-service-account', 'S3')

  expect(dialog.textContent).toContain('Add AWS credential')
  expect(authTypeTrigger(dialog).textContent).toContain('IAM role (keyless, via Sim OIDC)')
  expect(input(dialog, 'Issuer').value).toBe(TRUST.issuer)
  expect(input(dialog, 'Audience').value).toBe(TRUST.audience)
  expect(input(dialog, 'Subject').value).toBe(TRUST.subject)
  expect(labelled(dialog, 'Access key ID')).toBeNull()
  expect(button(dialog, 'Add credential').disabled).toBe(true)

  type(input(dialog, 'Role ARN'), ` ${ROLE_ARN} `)
  const policy = JSON.parse(input(dialog, 'Role trust policy').value)
  expect(policy.Statement[0].Principal.Federated).toBe(
    'arn:aws:iam::123456789012:oidc-provider/oidc.sim.test'
  )
  expect(policy.Statement[0].Condition.StringEquals['oidc.sim.test:sub']).toBe(TRUST.subject)
  expect(dialog.querySelector('button[aria-label="Copy Subject"]')).not.toBeNull()

  await confirm(dialog, 'Add credential')

  const { body, config } = submittedConfig()
  expect(body).toMatchObject({
    workspaceId: WORKSPACE_ID,
    type: 'service_account',
    providerId: 'aws-service-account',
  })
  expect(config).toEqual({
    authType: 'oidc_role',
    roleArn: ROLE_ARN,
    subject: TRUST.subject,
    subjectProof: TRUST.subjectProof,
  })
  expect(createdIds).toEqual(['cred-new'])
})

it('adds AWS access keys: submits only the keys, never a subject, and requires both', async () => {
  const dialog = await open('aws-service-account', 'AWS')
  await chooseAuthType(dialog, 'Access keys')

  expect(labelled(dialog, 'Issuer')).toBeNull()
  expect(labelled(dialog, 'Role ARN')).toBeNull()
  type(input(dialog, 'Access key ID'), ' AKIAEXAMPLEKEY12345 ')
  expect(button(dialog, 'Add credential').disabled).toBe(true)
  type(input(dialog, 'Secret access key'), ' secret/with spaces ')

  await confirm(dialog, 'Add credential')

  expect(submittedConfig().config).toEqual({
    authType: 'access_keys',
    accessKeyId: 'AKIAEXAMPLEKEY12345',
    secretAccessKey: ' secret/with spaces ',
  })
})

it('drops a secret when the auth type that used it is left', async () => {
  const dialog = await open('aws-service-account', 'AWS')
  await chooseAuthType(dialog, 'Access keys')
  type(input(dialog, 'Access key ID'), 'AKIAEXAMPLEKEY12345')
  type(input(dialog, 'Secret access key'), 'first-secret')

  await chooseAuthType(dialog, 'IAM role (keyless, via Sim OIDC)')
  await chooseAuthType(dialog, 'Access keys')

  expect(input(dialog, 'Secret access key').value).toBe('')
  expect(input(dialog, 'Access key ID').value).toBe('AKIAEXAMPLEKEY12345')
})

it('adds a Databricks service principal with its host, application ID and OAuth secret', async () => {
  keyless = { available: false }
  const dialog = await open('databricks-service-account', 'Databricks')

  expect(dialog.textContent).toContain('Add Databricks connection')
  expect(authTypeTrigger(dialog).textContent).toContain('Service principal OAuth secret')
  type(input(dialog, 'Workspace host'), ' dbc-abc123.cloud.databricks.com ')
  type(input(dialog, 'Service principal application ID'), '7cb2f8a4-49a7-4147-83db-35cb69e5cede')
  type(input(dialog, 'OAuth secret'), 'dose-secret')

  await confirm(dialog, 'Add connection')

  expect(submittedConfig().config).toEqual({
    authType: 'service_principal',
    host: 'dbc-abc123.cloud.databricks.com',
    clientId: '7cb2f8a4-49a7-4147-83db-35cb69e5cede',
    clientSecret: 'dose-secret',
  })
})

it('offers keyless sign-in disabled, with no instructions, where the deployment has no issuer', async () => {
  keyless = { available: false }
  const dialog = await open('aws-service-account', 'AWS')

  expect(authTypeTrigger(dialog).textContent).toContain('Access keys')
  expect(labelled(dialog, 'Issuer')).toBeNull()
  act(() => authTypeTrigger(dialog).click())
  await settle()
  expect(authTypeOption('IAM role (keyless, via Sim OIDC)').getAttribute('aria-disabled')).toBe(
    'true'
  )
})

it('never offers keyless sign-in to an organization credential, and never mints a subject for one', async () => {
  const dialog = await open('aws-service-account', 'AWS', {
    scope: { kind: 'organization', organizationId: 'org-1' },
  })

  expect(authTypeTrigger(dialog).textContent).toContain('Access keys')
  expect(requests.some((request) => request.path === '/api/credentials/workload-identity')).toBe(
    false
  )
  act(() => authTypeTrigger(dialog).click())
  await settle()
  expect(authTypeOption('IAM role (keyless, via Sim OIDC)').getAttribute('aria-disabled')).toBe(
    'true'
  )
})

it("shows the server's verification failure in the dialog", async () => {
  keyless = { available: false }
  createFailure = {
    status: 400,
    body: {
      error: 'AWS rejected these keys: The security token included in the request is invalid.',
    },
  }
  const dialog = await open('aws-service-account', 'AWS')
  type(input(dialog, 'Access key ID'), 'AKIAEXAMPLEKEY12345')
  type(input(dialog, 'Secret access key'), 'wrong')

  await confirm(dialog, 'Add credential')

  expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(
    'AWS rejected these keys: The security token included in the request is invalid.'
  )
  expect(createdIds).toEqual([])
})

it('reconnects in place, keeps the trusted subject by default and prefills no secret', async () => {
  const dialog = await open('aws-service-account', 'AWS', {
    replacedAccount: { credentialId: 'cred-old', displayName: 'Prod role' },
  })

  expect(dialog.textContent).toContain('Reconnect AWS credential')
  expect(input(dialog, 'Display name').value).toBe('Prod role')
  expect(input(dialog, 'Role ARN').value).toBe('')
  expect(labelled(dialog, 'Subject')).toBeNull()
  type(input(dialog, 'Role ARN'), ROLE_ARN)

  await confirm(dialog, 'Reconnect credential')

  const { body, config } = submittedConfig('PUT')
  expect(requests.find((request) => request.method === 'PUT')?.path).toBe(
    '/api/credentials/cred-old'
  )
  expect(body).toMatchObject({ displayName: 'Prod role' })
  expect(config).toEqual({ authType: 'oidc_role', roleArn: ROLE_ARN })
  expect(createdIds).toEqual(['cred-old'])
})
