/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/internal/oci/client.server', () => ({ createOciClient: mocks.createClient }))
vi.mock('@/lib/internal/oci-events/operations', () => ({
  executeOciEventsOperation: mocks.execute,
}))
vi.mock('@/blocks/registry', () => ({ getBlock: vi.fn() }))

import { OciClientError } from '@/lib/internal/oci/errors'
import { ociEventsInputSchemas } from '@/lib/internal/oci-events/input'
import {
  buildSelectorContextFromValues,
  getSelectorContextSubBlocks,
} from '@/lib/selectors/context'
import { isSelectorReady } from '@/lib/selectors/manifest'
import { createSelectorProtectedValues } from '@/lib/selectors/server/protected-values'
import { ociEventsSelectorAttachments } from '@/lib/selectors/server/providers/oci-events'
import type { ExecuteServerSelectorArgs } from '@/lib/selectors/server/types'
import { parseDependsOn } from '@/lib/workflows/subblocks/visibility'
import { OciEventsBlock } from '@/blocks/blocks/oci_events'

const client = { bound: true }
const selector = ociEventsSelectorAttachments['oci_events.rules']
const rule = {
  id: 'rule',
  displayName: 'Rule',
  compartmentId: 'compartment',
  lifecycleState: 'ACTIVE',
  isEnabled: false,
}

function args(): ExecuteServerSelectorArgs {
  return {
    selectorKey: 'oci_events.rules',
    context: { oauthCredential: 'requested', compartmentId: 'compartment' },
    request: { kind: 'list' },
    scope: { kind: 'workspace', workspaceId: 'workspace' },
    workspaceId: 'workspace',
    principal: { kind: 'session', userId: 'user', sessionId: 'session' },
    requesterUserId: 'user',
    credential: {
      suppliedId: 'requested',
      access: { ok: true, resolvedCredentialId: 'authorized', credentialType: 'service_account' },
    },
    references: new Map(),
    protectedValues: createSelectorProtectedValues(),
  }
}

describe('OCI Events rule selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClient.mockResolvedValue(client)
  })

  it('uses the authorized credential, defaults the region, and projects safe options', async () => {
    mocks.execute.mockResolvedValue({
      success: true,
      output: { rules: [{ ...rule, unexpected: 'private' }] },
    })
    await expect(selector.execute(args())).resolves.toEqual({
      kind: 'list',
      items: [{ id: 'rule', label: 'Rule', meta: { lifecycleState: 'ACTIVE', isEnabled: false } }],
    })
    expect(mocks.createClient).toHaveBeenCalledWith({
      credentialId: 'authorized',
      workspaceId: 'workspace',
      serviceId: 'oci_events',
      region: undefined,
    })
    expect(mocks.execute).toHaveBeenCalledWith(
      client,
      'list_rules',
      {
        oauthCredential: 'authorized',
        compartmentId: 'compartment',
        limit: 50,
      },
      undefined
    )
  })

  it('forwards empty-page cursors without loading additional pages', async () => {
    mocks.execute.mockResolvedValue({ success: true, output: { rules: [], nextPage: 'next+/=' } })
    const call = args()
    call.request = { kind: 'list', cursor: 'previous+/=' }
    await expect(selector.execute(call, client)).resolves.toEqual({
      kind: 'list',
      items: [],
      nextCursor: 'next+/=',
    })
    expect(mocks.execute.mock.calls[0][2].page).toBe('previous+/=')
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('hydrates selected rules and rejects selections from a different compartment', async () => {
    const call = args()
    call.request = { kind: 'detail', id: 'rule' }
    mocks.execute.mockResolvedValueOnce({ success: true, output: { rule } })
    await expect(selector.execute(call, client)).resolves.toMatchObject({
      kind: 'detail',
      item: { id: 'rule', label: 'Rule' },
    })
    expect(mocks.execute.mock.calls[0][1]).toBe('get_rule')
    mocks.execute.mockResolvedValueOnce({
      success: true,
      output: { rule: { ...rule, compartmentId: 'other' } },
    })
    await expect(selector.execute(call, client)).resolves.toEqual({ kind: 'detail', item: null })
  })

  it('returns null for a deleted selection but does not hide list failures', async () => {
    const call = args()
    call.request = { kind: 'detail', id: 'missing' }
    mocks.execute.mockRejectedValueOnce(new OciClientError('request_failed', { status: 404 }))
    await expect(selector.execute(call, client)).resolves.toEqual({ kind: 'detail', item: null })
    call.request = { kind: 'list' }
    mocks.execute.mockRejectedValueOnce(new Error('provider-private-data'))
    await expect(selector.execute(call, client)).rejects.not.toThrow('provider-private-data')
  })

  it('preserves cancellation and never starts a cancelled request', async () => {
    const call = args()
    const controller = new AbortController()
    call.signal = controller.signal
    controller.abort()
    await expect(selector.execute(call, client)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('builds ready basic context without requiring a region override', () => {
    const values = { credential: 'credential', compartmentId: 'compartment', operation: 'get_rule' }
    const config = OciEventsBlock.subBlocks.find(
      (field) => field.selectorKey === 'oci_events.rules'
    )!
    const dependsOn = parseDependsOn(config.dependsOn)
    const context = buildSelectorContextFromValues({
      selectorKey: 'oci_events.rules',
      values,
      contextConfigs: getSelectorContextSubBlocks(OciEventsBlock.subBlocks, values, false),
      dependsOn: dependsOn.allDependsOnFields,
    })
    expect(context).toEqual({ oauthCredential: 'credential', compartmentId: 'compartment' })
    expect(isSelectorReady('oci_events.rules', context)).toBe(true)
  })

  it('offers only valid create enabled states and preserves the update-only keep choice', () => {
    const options = OciEventsBlock.subBlocks.find((field) => field.id === 'isEnabled')!.options
    if (typeof options !== 'function') throw new Error('Expected operation-dependent options')
    const createOptions = options({ values: { operation: 'create_rule' } })
    for (const option of createOptions) {
      const raw = {
        operation: 'create_rule',
        oauthCredential: 'credential',
        compartmentId: 'compartment',
        displayName: 'Rule',
        condition: {},
        actions: [{ actionType: 'ONS', isEnabled: true, topicId: 'topic' }],
        isEnabled: option.id,
      }
      const normalized = OciEventsBlock.tools.config!.params!(raw)
      expect(ociEventsInputSchemas.create_rule.safeParse(normalized).success).toBe(true)
    }
    expect(createOptions.map((option) => option.id)).toEqual(['true', 'false'])
    const updateOptions = options({ values: { operation: 'update_rule' } })
    expect(updateOptions.map((option) => option.id)).toEqual(['', 'true', 'false'])
  })

  it('normalizes canonical update inputs without dropping false or explicit clears', () => {
    const raw = {
      operation: 'update_rule',
      oauthCredential: 'credential',
      ruleId: 'rule',
      isEnabled: 'false',
      description: '',
      actions: '',
      condition: '',
      freeformTags: {},
      definedTags: '{}',
      region: null,
      ifMatch: null,
    }
    const normalized = { ...raw, ...OciEventsBlock.tools.config!.params!(raw) }
    expect(ociEventsInputSchemas.update_rule.parse(normalized)).toMatchObject({
      ruleId: 'rule',
      isEnabled: false,
      description: '',
      freeformTags: {},
      definedTags: {},
    })
    expect(normalized.actions).toBeUndefined()
    expect(normalized.region).toBeUndefined()
    const untouched = {
      ...raw,
      isEnabled: '',
      description: null,
      freeformTags: null,
      definedTags: null,
    }
    const empty = { ...untouched, ...OciEventsBlock.tools.config!.params!(untouched) }
    expect(ociEventsInputSchemas.update_rule.safeParse(empty).success).toBe(false)
  })

  it('keeps manual rule IDs sufficient for advanced operations without a picker compartment', () => {
    const raw = { operation: 'get_rule', oauthCredential: 'credential', ruleId: 'rule' }
    const normalized = OciEventsBlock.tools.config!.params!(raw)
    expect(ociEventsInputSchemas.get_rule.parse(normalized)).toEqual({
      oauthCredential: 'credential',
      ruleId: 'rule',
    })
    expect(OciEventsBlock.inputs).toHaveProperty('ruleId')
    expect(OciEventsBlock.inputs).not.toHaveProperty('ruleIdInput')
  })
})
