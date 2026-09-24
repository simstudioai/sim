import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ComputerUseError } from '@sim/desktop-bridge'
import type { ComputerUseResult } from '@sim/desktop-bridge/computer-use'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComputerUseService } from '@/main/computer-use/service'
import { createConfigStore } from '@/main/config'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function setup(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'sim-computer-use-test-'))
  roots.push(root)
  const config = createConfigStore(join(root, 'settings.json'))
  config.set('computerUseEnabled', enabled)
  let sequence = 0
  const request = vi.fn(async (method: string): Promise<ComputerUseResult> => {
    if (method === 'status' || method === 'request_permission')
      return { kind: 'status', platform: 'darwin', accessibility: true, screenRecording: false }
    if (method === 'list_apps')
      return {
        kind: 'apps',
        apps: [{ bundleId: 'com.example.Fixture', name: 'Fixture', pid: 42, isActive: false }],
      }
    if (method === 'get_app_state')
      return {
        kind: 'state',
        bundleId: 'com.example.Fixture',
        snapshotId: `s${++sequence}`,
        windowId: '1',
        windows: [],
        nodes: [{ elementId: 'e1', role: 'AXTextArea', actions: [], windowId: '1' }],
        truncated: false,
      }
    return {
      kind: 'action',
      action: 'click',
      bundleId: 'com.example.Fixture',
      dispatched: true,
      verified: false,
    }
  })
  const native = { request, stop: vi.fn() }
  const approveApp = vi.fn(async (): Promise<'always' | 'deny' | 'once'> => 'always')
  const onActivity = vi.fn()
  const openPermissionSettings = vi.fn(async () => {})
  const setStopShortcutActive = vi.fn((active: boolean) => active)
  const service = new ComputerUseService({
    config,
    native,
    supported: true,
    approveApp,
    onActivity,
    setStopShortcutActive,
    openPermissionSettings,
  })
  const state = (chat = 'chat') =>
    service.execute(`state-${sequence}`, chat, {
      action: 'get_app_state',
      bundleId: 'com.example.Fixture',
    })
  const click = (snapshotId: string, chat = 'chat', call = 'click') =>
    service.execute(call, chat, {
      action: 'click',
      bundleId: 'com.example.Fixture',
      snapshotId,
      elementId: 'e1',
    })
  return {
    service,
    config,
    native,
    approveApp,
    onActivity,
    setStopShortcutActive,
    openPermissionSettings,
    state,
    click,
  }
}

describe('native computer use authority and lifecycle', () => {
  it('rejects execution while switched off before touching the helper', async () => {
    const { service, native } = setup(false)
    await expect(service.execute('call', 'chat', { action: 'list_apps' })).rejects.toThrow(
      'switched off'
    )
    expect(native.request).not.toHaveBeenCalled()
  })

  it('reports native permissions separately from the opt-in switch', async () => {
    const { service } = setup(false)
    expect(await service.getStatus()).toEqual({
      supported: true,
      enabled: false,
      permissions: { accessibility: true, screenCapture: false },
      activeAction: null,
    })
  })

  it('does not read app state when the user denies app access', async () => {
    const { state, approveApp, native } = setup()
    approveApp.mockResolvedValue('deny')
    await expect(state()).rejects.toThrow('denied')
    expect(native.request.mock.calls.map(([method]) => method)).toEqual(['list_apps'])
  })

  it('binds observed elements to their originating chat', async () => {
    const { state, click, native } = setup()
    await state('owner')
    await expect(click('s1', 'another-chat')).rejects.toThrow('another chat')
    expect(native.request.mock.calls.map(([method]) => method)).not.toContain('click')
  })

  it('consumes an observation even when the dispatched action is unverified', async () => {
    const { state, click, native } = setup()
    await state()
    expect(await click('s1')).toMatchObject({
      dispatched: true,
      verified: false,
      observation: { snapshotId: 's2', windowId: '1' },
    })
    expect(native.request).toHaveBeenLastCalledWith('get_app_state', {
      bundleId: 'com.example.Fixture',
      windowId: '1',
    })
    await expect(click('s1', 'chat', 'replay')).rejects.toThrow('stale')
    expect(native.request.mock.calls.filter(([method]) => method === 'click')).toHaveLength(1)
  })

  it('returns fresh state after activation without an observation option or old window binding', async () => {
    const { state, service, native, click } = setup()
    await state()
    native.request.mockResolvedValueOnce({
      kind: 'action',
      action: 'activate_app',
      bundleId: 'com.example.Fixture',
      dispatched: true,
      verified: false,
    })
    await expect(
      service.execute('activate', 'chat', {
        action: 'activate_app',
        bundleId: 'com.example.Fixture',
      })
    ).resolves.toMatchObject({
      action: 'activate_app',
      dispatched: true,
      observation: { snapshotId: 's2' },
    })
    expect(native.request).toHaveBeenLastCalledWith('get_app_state', {
      bundleId: 'com.example.Fixture',
    })
    await expect(click('s1', 'chat', 'old')).rejects.toThrow('stale')
    await expect(click('s2', 'other-chat', 'foreign')).rejects.toThrow('another chat')
    expect(native.request.mock.calls.filter(([method]) => method === 'activate_app')).toHaveLength(
      1
    )
  })

  it('returns a fresh scoped snapshot after one input batch under the same admission', async () => {
    const { state, service, native, click, approveApp } = setup()
    await state()
    const authorize = vi.fn(async () => ({
      scopeId: 'chat',
      input: {
        action: 'input_sequence',
        activateFirst: true,
        bundleId: 'com.example.Fixture',
        snapshotId: 's1',
        elementId: 'e1',
        steps: [
          { action: 'press_key', key: 'Cmd+A' },
          { action: 'type_text', text: 'fixture nonce' },
          { action: 'press_key', key: 'Enter' },
        ],
        observeAfter: { includeScreenshot: true },
      },
    }))
    native.request.mockResolvedValueOnce({
      kind: 'action',
      action: 'input_sequence',
      bundleId: 'com.example.Fixture',
      dispatched: true,
      verified: false,
      sequence: { completedSteps: 3, totalSteps: 3 },
    })
    const result = await service.executeAuthorized('sequence', authorize)
    expect(authorize).toHaveBeenCalledOnce()
    expect(approveApp).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      kind: 'action',
      verified: false,
      sequence: { completedSteps: 3, totalSteps: 3 },
      observation: { snapshotId: 's2', windowId: '1' },
    })
    expect(native.request).toHaveBeenLastCalledWith('get_app_state', {
      bundleId: 'com.example.Fixture',
      windowId: '1',
      includeScreenshot: true,
    })
    expect(
      native.request.mock.calls.filter(([method]) => method === 'input_sequence')
    ).toHaveLength(1)
    const sequenceArgs = native.request.mock.calls.find(([method]) => method === 'input_sequence')
    expect(sequenceArgs).toEqual([
      'input_sequence',
      {
        activateFirst: true,
        bundleId: 'com.example.Fixture',
        snapshotId: 's1',
        elementId: 'e1',
        steps: [
          { action: 'press_key', key: 'Cmd+A' },
          { action: 'type_text', text: 'fixture nonce' },
          { action: 'press_key', key: 'Enter' },
        ],
      },
    ])
    await expect(click('s1', 'chat', 'old')).rejects.toThrow('stale')
    await expect(click('s2', 'other-chat', 'foreign')).rejects.toThrow('another chat')
    await expect(click('s2', 'chat', 'next')).resolves.toMatchObject({ dispatched: true })
  })

  it('observes a partial sequence without retrying any input', async () => {
    const { state, service, native } = setup()
    await state()
    native.request.mockResolvedValueOnce({
      kind: 'action',
      action: 'input_sequence',
      bundleId: 'com.example.Fixture',
      dispatched: true,
      verified: false,
      sequence: { completedSteps: 1, totalSteps: 2, error: 'Editor focus changed.' },
    })
    const result = await service.execute('sequence-partial', 'chat', {
      action: 'input_sequence',
      bundleId: 'com.example.Fixture',
      snapshotId: 's1',
      elementId: 'e1',
      steps: [
        { action: 'press_key', key: 'Tab' },
        { action: 'type_text', text: 'must not type' },
      ],
    })
    expect(result).toMatchObject({
      sequence: { completedSteps: 1, error: 'Editor focus changed.' },
      observation: { snapshotId: 's2' },
    })
    expect(
      native.request.mock.calls.filter(([method]) => method === 'input_sequence')
    ).toHaveLength(1)
  })

  it.each([
    new Error('Window closed.'),
    new ComputerUseError({
      code: 'activation_required',
      message: 'Window closed.',
      dispatchState: 'not_started',
    }),
  ])('preserves successful dispatch when the follow-up read fails', async (readError) => {
    const { state, service, native, click } = setup()
    await state()
    native.request
      .mockResolvedValueOnce({
        kind: 'action',
        action: 'click',
        bundleId: 'com.example.Fixture',
        dispatched: true,
        verified: false,
      })
      .mockRejectedValueOnce(readError)
    await expect(
      service.execute('observe-failed', 'chat', {
        action: 'click',
        bundleId: 'com.example.Fixture',
        snapshotId: 's1',
        elementId: 'e1',
      })
    ).resolves.toMatchObject({
      dispatched: true,
      verified: false,
      observationError: 'Window closed.',
    })
    expect(native.request.mock.calls.filter(([method]) => method === 'click')).toHaveLength(1)
    await expect(click('s1', 'chat', 'repeat')).rejects.toThrow('stale')
  })

  it.each(['app', 'window'])('rejects a follow-up snapshot from a different %s', async (target) => {
    const { state, service, native, click } = setup()
    await state()
    native.request
      .mockResolvedValueOnce({
        kind: 'action',
        action: 'click',
        bundleId: 'com.example.Fixture',
        dispatched: true,
        verified: false,
      })
      .mockResolvedValueOnce({
        kind: 'state',
        bundleId: target === 'app' ? 'com.example.Other' : 'com.example.Fixture',
        snapshotId: 'foreign',
        windowId: target === 'window' ? '2' : '1',
        windows: [],
        nodes: [],
        truncated: false,
      })
    await expect(
      service.execute('observe-wrong', 'chat', {
        action: 'click',
        bundleId: 'com.example.Fixture',
        snapshotId: 's1',
        elementId: 'e1',
      })
    ).resolves.toMatchObject({
      dispatched: true,
      observationError: expect.stringContaining(`different ${target}`),
    })
    await expect(click('foreign')).rejects.toThrow('stale')
  })

  it('Stop during the follow-up observation does not restore usable references', async () => {
    const { state, service, native, click } = setup()
    await state()
    let finish: ((value: ComputerUseResult) => void) | undefined
    let observed: (() => void) | undefined
    const observing = new Promise<void>((resolve) => {
      observed = resolve
    })
    native.request
      .mockResolvedValueOnce({
        kind: 'action',
        action: 'click',
        bundleId: 'com.example.Fixture',
        dispatched: true,
        verified: false,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
            observed?.()
          })
      )
    const execution = service.execute('stop-observation', 'chat', {
      action: 'click',
      bundleId: 'com.example.Fixture',
      snapshotId: 's1',
      elementId: 'e1',
    })
    await observing
    service.cancel('stop-observation')
    finish?.({
      kind: 'state',
      bundleId: 'com.example.Fixture',
      snapshotId: 's2',
      windowId: '1',
      windows: [],
      nodes: [],
      truncated: false,
    })
    await expect(execution).rejects.toThrow('stopped')
    await expect(click('s2')).rejects.toThrow('stale')
    expect(native.request.mock.calls.filter(([method]) => method === 'click')).toHaveLength(1)
  })

  it('invalidates previous references after a fresh observation of the app', async () => {
    const { state, click } = setup()
    await state()
    await state()
    await expect(click('s1')).rejects.toThrow('stale')
    await expect(click('s2')).resolves.toMatchObject({ kind: 'action' })
  })

  it('requires fresh observations after a helper restart', async () => {
    const { state, click, service } = setup()
    await state()
    service.invalidateSnapshots()
    await expect(click('s1')).rejects.toThrow('stale')
  })

  it('clears grants and opt-in on account reset', async () => {
    const { state, service, native } = setup()
    await state()
    expect(service.listAppPermissions()).toHaveLength(1)
    service.reset()
    expect(service.isEnabled()).toBe(false)
    expect(service.listAppPermissions()).toEqual([])
    expect(native.stop).toHaveBeenCalledOnce()
  })

  it('revoking app access invalidates its cached observation', async () => {
    const { state, service, click } = setup()
    await state()
    service.revokeApp('com.example.Fixture')
    expect(service.listAppPermissions()).toEqual([])
    await expect(click('s1')).rejects.toThrow('stale')
  })

  it('blocks self-automation before showing an approval', async () => {
    const { service, approveApp, native } = setup()
    await expect(
      service.execute('self', 'chat', { action: 'get_app_state', bundleId: 'ai.sim.desktop' })
    ).rejects.toThrow('own permission')
    expect(approveApp).not.toHaveBeenCalled()
    expect(native.request).not.toHaveBeenCalled()
  })

  it('stops work waiting for app approval and does not persist that approval', async () => {
    const { service, approveApp, state, native } = setup()
    let resolveApproval: (answer: 'always') => void = () => {}
    approveApp.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApproval = resolve
        })
    )
    const pending = state()
    const rejection = expect(pending).rejects.toThrow('stopped')
    await vi.waitFor(() => expect(approveApp).toHaveBeenCalledOnce())
    service.cancel()
    resolveApproval('always')
    await rejection
    expect(service.listAppPermissions()).toEqual([])
    expect(native.request.mock.calls.map(([method]) => method)).not.toContain('get_app_state')
  })

  it('turning off cancels pending and queued work', async () => {
    const { service, approveApp, state } = setup()
    let resolveApproval: (answer: 'once') => void = () => {}
    approveApp.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApproval = resolve
        })
    )
    const pending = state()
    const rejection = expect(pending).rejects.toThrow('stopped')
    const queued = service.execute('queued', 'chat', { action: 'list_apps' })
    const queuedRejection = expect(queued).rejects.toThrow('stopped')
    await vi.waitFor(() => expect(approveApp).toHaveBeenCalledOnce())
    await service.setEnabled(false)
    resolveApproval('once')
    await rejection
    await queuedRejection
  })

  it('keeps temporary app approval in one task and clears it on Stop', async () => {
    const { state, approveApp, service } = setup()
    approveApp.mockResolvedValue('once')
    await state('first-task')
    await state('first-task')
    expect(approveApp).toHaveBeenCalledTimes(1)
    expect(service.listAppPermissions()).toEqual([])
    await state('second-task')
    expect(approveApp).toHaveBeenCalledTimes(2)
    service.cancel()
    await state('first-task')
    expect(approveApp).toHaveBeenCalledTimes(3)
  })

  it('Stop cancels a tool still waiting on server authorization', async () => {
    const { service, native } = setup()
    let finish: (value: { scopeId: string; input: unknown }) => void = () => {}
    const authorize = vi.fn(
      () =>
        new Promise<{ scopeId: string; input: unknown }>((resolve) => {
          finish = resolve
        })
    )
    const pending = service.executeAuthorized('pending-authorization', authorize)
    const rejected = expect(pending).rejects.toThrow('stopped')
    service.cancel('pending-authorization')
    finish({ scopeId: 'chat', input: { action: 'list_apps' } })
    await rejected
    expect(native.request).not.toHaveBeenCalled()
  })

  it('rejects concurrent duplicate claims before contacting the server again', async () => {
    const { service } = setup()
    let finish: (value: { scopeId: string; input: unknown }) => void = () => {}
    const pending = service.executeAuthorized(
      'same-call',
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const secondAuthorization = vi.fn()
    await expect(service.executeAuthorized('same-call', secondAuthorization)).rejects.toThrow(
      'already running'
    )
    expect(secondAuthorization).not.toHaveBeenCalled()
    finish({ scopeId: 'chat', input: { action: 'list_apps' } })
    await expect(pending).resolves.toMatchObject({ kind: 'apps' })
  })

  it('offers the global Stop shortcut only while a native action is active', async () => {
    const { state, onActivity, setStopShortcutActive } = setup()
    await state()
    expect(setStopShortcutActive.mock.calls).toEqual([[true], [false]])
    expect(onActivity.mock.calls[0][0]).toMatchObject({ stopShortcutAvailable: true })
    expect(onActivity.mock.calls.at(-1)).toEqual([null])
  })

  it('clears the global Stop shortcut and activity after helper failure', async () => {
    const { state, native, onActivity, setStopShortcutActive } = setup()
    native.request.mockRejectedValueOnce(new Error('Helper disconnected'))
    await expect(state()).rejects.toThrow('Helper disconnected')
    expect(setStopShortcutActive.mock.calls).toEqual([[true], [false]])
    expect(onActivity.mock.calls.at(-1)).toEqual([null])
  })

  it('does not return an outdated enabled state after a pending permission read', async () => {
    const { service, native } = setup()
    let finish: (value: ComputerUseResult) => void = () => {}
    native.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = service.getStatus()
    await service.setEnabled(false)
    finish({ kind: 'status', platform: 'darwin', accessibility: true, screenRecording: false })
    expect(await pending).toMatchObject({ enabled: false, activeAction: null })
  })

  it('fails closed if device opt-in cannot be persisted', async () => {
    const { service, config, native } = setup(false)
    vi.spyOn(config, 'flush').mockReturnValue(false)
    await expect(service.setEnabled(true)).rejects.toThrow('Could not save')
    expect(service.isEnabled()).toBe(false)
    expect(native.request).not.toHaveBeenCalled()
  })

  it('reports failed grant erasure so account teardown retains its recovery marker', async () => {
    const { service, config, state } = setup()
    await state()
    vi.spyOn(config, 'flush').mockReturnValue(false)
    expect(() => service.reset()).toThrow('Could not clear')
    expect(service.isEnabled()).toBe(false)
    expect(service.listAppPermissions()).toEqual([])
  })

  it('does not operate an app if persistent approval cannot be saved', async () => {
    const { config, state, native, service } = setup()
    vi.spyOn(config, 'flush').mockReturnValue(false)
    await expect(state()).rejects.toThrow('Could not save the app permission')
    expect(native.request.mock.calls.map(([method]) => method)).toEqual(['list_apps'])
    expect(service.listAppPermissions()).toEqual([])
  })

  it('opens the requested permission settings even when access is already denied', async () => {
    const { service, openPermissionSettings } = setup()
    const result = await service.requestPermission('screenCapture')
    expect(openPermissionSettings).toHaveBeenCalledWith('screenCapture')
    expect(result.permissions.screenCapture).toBe(false)
  })
})
