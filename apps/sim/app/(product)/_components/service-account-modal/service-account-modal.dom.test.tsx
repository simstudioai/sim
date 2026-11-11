/**
 * @vitest-environment jsdom
 *
 * AWS, Databricks, Snowflake and Microsoft app credentials, keyless sign-in included, plus keyless
 * Google Cloud service accounts and the GitHub, Bitbucket and DocuSign tokens, set up from the
 * Platform's shared service-account dialog. Failure modes: the dialog renders nothing for these providers; keyless
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
/** The workload-identity setup; Google's has no fixed audience. */
let keyless:
  | (Omit<typeof TRUST, 'audience'> & { audience?: string; reconnectAuthType?: string })
  | { available: false; reconnectAuthType?: string }
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
    oauthServiceId?: string
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
          oauthServiceId={options.oauthServiceId}
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

function submittedBody(method = 'POST') {
  const saved = requests.filter(
    (request) =>
      request.method === method &&
      request.path !== '/api/credentials/workload-identity' &&
      request.path.startsWith('/api/credentials')
  )
  expect(saved).toHaveLength(1)
  return saved[0].body
}

function submittedConfig(method = 'POST') {
  const body = submittedBody(method)
  return { body, config: JSON.parse(String(body.serviceAccountJson)) }
}

/** The provider each workload-identity setup request asked for. */
function setupProviders() {
  return requests
    .filter((request) => request.path === '/api/credentials/workload-identity')
    .map((request) => request.body.provider)
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
  await chooseAuthType(dialog, 'Access keys (long-lived)')

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
  await chooseAuthType(dialog, 'Access keys (long-lived)')
  type(input(dialog, 'Access key ID'), 'AKIAEXAMPLEKEY12345')
  type(input(dialog, 'Secret access key'), 'first-secret')

  await chooseAuthType(dialog, 'IAM role (keyless, via Sim OIDC)')
  await chooseAuthType(dialog, 'Access keys (long-lived)')

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

  expect(authTypeTrigger(dialog).textContent).toContain('Access keys (long-lived)')
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

  expect(authTypeTrigger(dialog).textContent).toContain('Access keys (long-lived)')
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
  keyless = { ...TRUST, reconnectAuthType: 'oidc_role' }
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

it('reopens a reconnect on the stored keyed mode even where keyless is offered', async () => {
  keyless = { ...TRUST, reconnectAuthType: 'access_keys' }
  const dialog = await open('aws-service-account', 'AWS', {
    replacedAccount: { credentialId: 'cred-old', displayName: 'Prod keys' },
  })

  expect(authTypeTrigger(dialog).textContent).toContain('Access keys')
  expect(labelled(dialog, 'Role ARN')).toBeNull()
})

it('adds a keyless Snowflake service user: shows the CREATE USER statement and submits a bare host', async () => {
  keyless = { ...TRUST, audience: 'snowflakecomputing.com' }
  const dialog = await open('snowflake-service-account', 'Snowflake')

  expect(dialog.textContent).toContain('Add Snowflake connection')
  expect(setupProviders()).toContain('snowflake')
  expect(authTypeTrigger(dialog).textContent).toContain('Service user (keyless, via Sim OIDC)')
  expect(labelled(dialog, 'Programmatic access token')).toBeNull()
  expect(input(dialog, 'Audience').value).toBe('snowflakecomputing.com')
  const statement = input(dialog, 'Service user statement').value
  expect(statement).toContain(`ISSUER = '${TRUST.issuer}'`)
  expect(statement).toContain(`SUBJECT = '${TRUST.subject}'`)

  type(input(dialog, 'Account host'), 'https://myorg-acct.snowflakecomputing.com/console')
  await confirm(dialog, 'Add connection')

  const { body, config } = submittedConfig()
  expect(body).toMatchObject({ type: 'service_account', providerId: 'snowflake-service-account' })
  expect(body.apiToken).toBeUndefined()
  expect(config).toEqual({
    authType: 'workload_identity',
    host: 'myorg-acct.snowflakecomputing.com',
    subject: TRUST.subject,
    subjectProof: TRUST.subjectProof,
  })
})

it('adds a Snowflake programmatic access token as the token fields, never a configuration', async () => {
  keyless = { available: false }
  const dialog = await open('snowflake-service-account', 'Snowflake')

  expect(authTypeTrigger(dialog).textContent).toContain('Programmatic access token')
  type(input(dialog, 'Account host'), 'myorg-acct.snowflakecomputing.com')
  type(input(dialog, 'Programmatic access token'), ' pat-secret ')
  await confirm(dialog, 'Add connection')

  const body = submittedBody()
  expect(body).toMatchObject({
    providerId: 'snowflake-service-account',
    domain: 'myorg-acct.snowflakecomputing.com',
    apiToken: 'pat-secret',
  })
  expect(body.serviceAccountJson).toBeUndefined()
})

it('adds a keyless Microsoft app credential for the federated credential it trusts', async () => {
  keyless = { ...TRUST, audience: 'api://AzureADTokenExchange' }
  const dialog = await open('microsoft-app-service-account', 'SharePoint')

  expect(dialog.textContent).toContain('Add Microsoft app credential')
  expect(setupProviders()).toContain('microsoft')
  expect(authTypeTrigger(dialog).textContent).toContain(
    'Federated credential (keyless, via Sim OIDC)'
  )
  expect(input(dialog, 'Audience').value).toBe('api://AzureADTokenExchange')
  expect(labelled(dialog, 'Client secret')).toBeNull()
  type(input(dialog, 'Directory (tenant) ID'), ' 11111111-1111-1111-1111-111111111111 ')
  type(input(dialog, 'Application (client) ID'), '22222222-2222-2222-2222-222222222222')

  await confirm(dialog, 'Add app credential')

  expect(submittedConfig().config).toEqual({
    authType: 'federated',
    tenantId: '11111111-1111-1111-1111-111111111111',
    clientId: '22222222-2222-2222-2222-222222222222',
    subject: TRUST.subject,
    subjectProof: TRUST.subjectProof,
  })
})

it("adds a Microsoft app certificate with its environment URL, and only that mode's secrets", async () => {
  keyless = { available: false }
  const dialog = await open('microsoft-app-service-account', 'Dataverse')

  expect(authTypeTrigger(dialog).textContent).toContain('Client secret')
  type(input(dialog, 'Directory (tenant) ID'), '11111111-1111-1111-1111-111111111111')
  type(input(dialog, 'Application (client) ID'), '22222222-2222-2222-2222-222222222222')
  type(input(dialog, 'Client secret'), 'left-behind')
  await chooseAuthType(dialog, 'Certificate')
  type(
    input(dialog, 'Dataverse or Dynamics 365 environment URL'),
    'https://contoso.crm.dynamics.com'
  )
  type(input(dialog, 'Certificate'), '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----')
  type(
    input(dialog, 'Private key (unencrypted PEM)'),
    '-----BEGIN PRIVATE KEY-----\nk\n-----END PRIVATE KEY-----'
  )

  await confirm(dialog, 'Add app credential')

  expect(submittedConfig().config).toEqual({
    authType: 'certificate',
    tenantId: '11111111-1111-1111-1111-111111111111',
    clientId: '22222222-2222-2222-2222-222222222222',
    environmentUrl: 'https://contoso.crm.dynamics.com',
    certificate: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
    privateKey: '-----BEGIN PRIVATE KEY-----\nk\n-----END PRIVATE KEY-----',
  })
})

it('reconnects a Microsoft app credential on its keyed mode unless the setup reports it keyless', async () => {
  keyless = { ...TRUST, audience: 'api://AzureADTokenExchange' }
  const dialog = await open('microsoft-app-service-account', 'Entra ID', {
    replacedAccount: { credentialId: 'cred-old', displayName: 'Graph app' },
  })

  expect(authTypeTrigger(dialog).textContent).toContain('Client secret')
  expect(
    requests.find((request) => request.path === '/api/credentials/workload-identity')?.body
  ).toMatchObject({ provider: 'microsoft', credentialId: 'cred-old' })
})

it('adds a keyless Google Cloud service account from BigQuery, with the gcloud commands to run', async () => {
  const { audience: _fixedAudience, ...googleTrust } = TRUST
  keyless = googleTrust
  const dialog = await open('google-service-account', 'Google', {
    oauthServiceId: 'google-bigquery',
  })

  expect(authTypeTrigger(dialog).textContent).toContain('JSON key')
  await chooseAuthType(dialog, 'Workload Identity Federation (keyless, via Sim OIDC)')
  expect(setupProviders()).toContain('google')
  expect(labelled(dialog, 'JSON key')).toBeNull()
  expect(labelled(dialog, 'Audience')).toBeNull()
  expect(button(dialog, 'Add service account').disabled).toBe(true)

  type(input(dialog, 'Project number (numeric, not the project ID)'), '123456789012')
  type(input(dialog, 'Workload identity pool ID'), 'sim-pool')
  type(input(dialog, 'Provider ID'), 'sim-oidc')
  type(input(dialog, 'Service account email'), 'Runner@my-project.iam.gserviceaccount.com')

  expect(input(dialog, 'Audience').value).toBe(
    'https://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/sim-pool/providers/sim-oidc'
  )
  expect(input(dialog, 'Setup commands').value).toContain(
    `--attribute-condition="assertion.sub=='${TRUST.subject}'"`
  )
  await confirm(dialog, 'Add service account')

  expect(submittedConfig().config).toEqual({
    authType: 'workload_identity',
    projectNumber: '123456789012',
    poolId: 'sim-pool',
    providerId: 'sim-oidc',
    serviceAccountEmail: 'runner@my-project.iam.gserviceaccount.com',
    subject: TRUST.subject,
    subjectProof: TRUST.subjectProof,
  })
})

it('never offers keyless Google setup for a Google Workspace service', async () => {
  const dialog = await open('google-service-account', 'Google', { oauthServiceId: 'google-drive' })

  expect(dialog.querySelector('[aria-label="Authentication"]')).toBeNull()
  expect(input(dialog, 'JSON key')).toBeTruthy()
  expect(setupProviders()).toEqual([])
})

it.each([
  [
    'github-service-account',
    'GitHub',
    'Add personal access token',
    { 'Personal access token': 'github_pat_abc' },
    { apiToken: 'github_pat_abc' },
  ],
  [
    'bitbucket-service-account',
    'Bitbucket',
    'Add access token',
    { 'Access token': 'bb-token', Repository: 'my-workspace/my-repo' },
    { apiToken: 'bb-token', providerWorkspaceId: 'my-workspace/my-repo' },
  ],
])('adds a saved %s token', async (providerId, serviceName, action, entries, expected) => {
  const dialog = await open(providerId, serviceName)
  for (const [label, value] of Object.entries(entries)) type(input(dialog, label), value)

  await confirm(dialog, action)

  expect(submittedBody()).toMatchObject({ type: 'service_account', providerId, ...expected })
})

it('adds a DocuSign JWT Grant app with its environment, key, user and RSA key', async () => {
  const dialog = await open('docusign-service-account', 'DocuSign')

  expect(dialog.textContent).toContain('Add DocuSign JWT Grant app')
  type(input(dialog, 'Integration key'), '33333333-3333-3333-3333-333333333333')
  type(input(dialog, 'Impersonated user ID'), '44444444-4444-4444-4444-444444444444')
  type(
    input(dialog, 'RSA private key'),
    '-----BEGIN RSA PRIVATE KEY-----\nk\n-----END RSA PRIVATE KEY-----'
  )
  expect(button(dialog, 'Add JWT Grant app').disabled).toBe(true)
  act(() =>
    labelled(dialog, 'Integration key environment')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    )
  )
  await settle()
  const demo = [...document.body.querySelectorAll('[role="option"]')].find(
    (item) => item.textContent?.trim() === 'Developer (demo)'
  )
  if (!(demo instanceof HTMLElement)) throw new Error('No Developer (demo) option')
  for (const type of ['pointermove', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    act(() => {
      demo.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }))
    })
    await settle()
  }

  await confirm(dialog, 'Add JWT Grant app')

  expect(submittedBody()).toMatchObject({
    providerId: 'docusign-service-account',
    dataCenter: 'demo',
    clientId: '33333333-3333-3333-3333-333333333333',
    username: '44444444-4444-4444-4444-444444444444',
    privateKey: '-----BEGIN RSA PRIVATE KEY-----\nk\n-----END RSA PRIVATE KEY-----',
  })
})
