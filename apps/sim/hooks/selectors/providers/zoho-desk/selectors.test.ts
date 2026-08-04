/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({ mockRequestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))

import { getSelectorDefinition } from '@/hooks/selectors/registry'
import type { SelectorQueryArgs } from '@/hooks/selectors/types'

const organizations = getSelectorDefinition('zoho_desk.organizations')
const departments = getSelectorDefinition('zoho_desk.departments')
const agents = getSelectorDefinition('zoho_desk.agents')

const orgArgs = (overrides: Partial<SelectorQueryArgs['context']> = {}): SelectorQueryArgs => ({
  key: 'zoho_desk.organizations',
  context: { oauthCredential: 'cred-1', workflowId: 'wf-1', ...overrides },
})

const deptArgs = (overrides: Partial<SelectorQueryArgs['context']> = {}): SelectorQueryArgs => ({
  key: 'zoho_desk.departments',
  context: { oauthCredential: 'cred-1', workflowId: 'wf-1', orgId: 'org-9', ...overrides },
})

const agentArgs = (overrides: Partial<SelectorQueryArgs['context']> = {}): SelectorQueryArgs => ({
  key: 'zoho_desk.agents',
  context: { oauthCredential: 'cred-1', workflowId: 'wf-1', orgId: 'org-9', ...overrides },
})

describe('zoho_desk.organizations selector', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is enabled only once a credential is selected', () => {
    expect(organizations.enabled?.(orgArgs())).toBe(true)
    expect(organizations.enabled?.(orgArgs({ oauthCredential: undefined }))).toBe(false)
  })

  it('keys the query by credential', () => {
    expect(organizations.getQueryKey(orgArgs())).toEqual([
      'selectors',
      'zoho_desk.organizations',
      'cred-1',
    ])
    expect(organizations.getQueryKey(orgArgs({ oauthCredential: undefined }))).toEqual([
      'selectors',
      'zoho_desk.organizations',
      'none',
    ])
  })

  it('posts the credential id (never a token) and maps organizations to options', async () => {
    mockRequestJson.mockResolvedValue({
      organizations: [
        { id: '700123', name: 'Zylker' },
        { id: '700124', name: 'zPad' },
      ],
    })

    const options = await organizations.fetchList?.(orgArgs())

    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/tools/zoho_desk/organizations' }),
      expect.objectContaining({ body: { credential: 'cred-1', workflowId: 'wf-1' } })
    )
    expect(options).toEqual([
      { id: '700123', label: 'Zylker' },
      { id: '700124', label: 'zPad' },
    ])
  })

  it('throws when the credential is missing rather than calling the route', async () => {
    await expect(
      organizations.fetchList?.(orgArgs({ oauthCredential: undefined }))
    ).rejects.toThrow(/Missing credential/)
    expect(mockRequestJson).not.toHaveBeenCalled()
  })
})

describe('zoho_desk.departments selector', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stays disabled until both the credential and the organization are set', () => {
    expect(departments.enabled?.(deptArgs())).toBe(true)
    expect(departments.enabled?.(deptArgs({ orgId: undefined }))).toBe(false)
    expect(departments.enabled?.(deptArgs({ oauthCredential: undefined }))).toBe(false)
  })

  it('keys the query by credential and organization so switching portals refetches', () => {
    expect(departments.getQueryKey(deptArgs())).toEqual([
      'selectors',
      'zoho_desk.departments',
      'cred-1',
      'org-9',
    ])
    expect(departments.getQueryKey(deptArgs({ orgId: undefined }))).toEqual([
      'selectors',
      'zoho_desk.departments',
      'cred-1',
      'none',
    ])
  })

  it('forwards the organization id and maps departments to options', async () => {
    mockRequestJson.mockResolvedValue({
      departments: [{ id: '1892000000082069', name: 'Zylker' }],
    })

    const options = await departments.fetchList?.(deptArgs())

    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/tools/zoho_desk/departments' }),
      expect.objectContaining({
        body: { credential: 'cred-1', orgId: 'org-9', workflowId: 'wf-1' },
      })
    )
    expect(options).toEqual([{ id: '1892000000082069', label: 'Zylker' }])
  })

  it('throws when the organization is missing rather than calling the route unscoped', async () => {
    await expect(departments.fetchList?.(deptArgs({ orgId: undefined }))).rejects.toThrow(
      /Missing organization ID/
    )
    expect(mockRequestJson).not.toHaveBeenCalled()
  })
})

describe('zoho_desk.agents selector', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stays disabled until both the credential and the organization are set', () => {
    expect(agents.enabled?.(agentArgs())).toBe(true)
    expect(agents.enabled?.(agentArgs({ orgId: undefined }))).toBe(false)
    expect(agents.enabled?.(agentArgs({ oauthCredential: undefined }))).toBe(false)
  })

  it('keys the query by credential and organization so switching portals refetches', () => {
    expect(agents.getQueryKey(agentArgs())).toEqual([
      'selectors',
      'zoho_desk.agents',
      'cred-1',
      'org-9',
    ])
    expect(agents.getQueryKey(agentArgs({ orgId: undefined }))).toEqual([
      'selectors',
      'zoho_desk.agents',
      'cred-1',
      'none',
    ])
  })

  it('forwards the organization id and maps agents to options', async () => {
    mockRequestJson.mockResolvedValue({
      agents: [
        { id: '1892000000056007', name: 'zyl case' },
        { id: '1892000000042001', name: 'jade' },
      ],
    })

    const options = await agents.fetchList?.(agentArgs())

    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/tools/zoho_desk/agents' }),
      expect.objectContaining({
        body: { credential: 'cred-1', orgId: 'org-9', workflowId: 'wf-1' },
      })
    )
    expect(options).toEqual([
      { id: '1892000000056007', label: 'zyl case' },
      { id: '1892000000042001', label: 'jade' },
    ])
  })

  it('throws when the organization is missing rather than calling the route unscoped', async () => {
    await expect(agents.fetchList?.(agentArgs({ orgId: undefined }))).rejects.toThrow(
      /Missing organization ID/
    )
    expect(mockRequestJson).not.toHaveBeenCalled()
  })

  it('throws when the credential is missing rather than calling the route', async () => {
    await expect(agents.fetchList?.(agentArgs({ oauthCredential: undefined }))).rejects.toThrow(
      /Missing credential/
    )
    expect(mockRequestJson).not.toHaveBeenCalled()
  })
})
