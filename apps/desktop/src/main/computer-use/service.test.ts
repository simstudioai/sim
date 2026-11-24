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

/** `askForApps` defaults on so the approval tests exercise the prompt; the default device mode asks for nothing. */
function setup(enabled = true, askForApps = true) {
  const root = mkdtempSync(join(tmpdir(), 'sim-computer-use-test-'))
  roots.push(root)
  const config = createConfigStore(join(root, 'settings.json'))
  config.set('computerUseEnabled', enabled)
  config.set('computerUseAskForApps', askForApps)
  let sequence = 0
  const request = vi.fn(
    async (method: string, _params?: Record<string, unknown>): Promise<ComputerUseResult> => {
      if (method === 'status' || method === 'request_permission')
        return { kind: 'status', platform: 'darwin', accessibility: true, screenRecording: false }
      if (method === 'list_apps')
        return {
          kind: 'apps',
          apps: [{ bundleId: 'com.example.Fixture', name: 'Fixture', pid: 42, isActive: false }],
        }
      if (method === 'app_command')
        return {
          kind: 'command',
          command: 'create_reminder',
          created: { id: 'r1', title: 'Pay rent', list: 'Reminders' },
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
    }
  )
  const native = { request, stop: vi.fn() }
  const approveApp = vi.fn(async (): Promise<'always' | 'deny' | 'once'> => 'always')
  const confirmAppCommand = vi.fn(
    async (_request: { appName: string; summary: string; change: 'add' | 'update' }) => true
  )
  const onActivity = vi.fn()
  const openPermissionSettings = vi.fn(async () => {})
  const setStopShortcutActive = vi.fn((active: boolean) => active)
  const service = new ComputerUseService({
    config,
    native,
    supported: true,
    approveApp,
    confirmAppCommand,
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
    confirmAppCommand,
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

  it('keeps the helper dormant until device opt-in and stops it when switched off', async () => {
    const { service, native } = setup(false)
    expect(await service.getStatus()).toMatchObject({ enabled: false, activeAction: null })
    expect(native.request).not.toHaveBeenCalled()
    expect(await service.setEnabled(true)).toMatchObject({
      enabled: true,
      permissions: { accessibility: true, screenCapture: false },
    })
    expect(native.request).toHaveBeenCalledOnce()
    native.request.mockClear()
    expect(await service.setEnabled(false)).toMatchObject({ enabled: false })
    expect(native.stop).toHaveBeenCalledOnce()
    expect(native.request).not.toHaveBeenCalled()
  })

  it('does not read app state when the user denies app access', async () => {
    const { state, approveApp, native } = setup()
    approveApp.mockResolvedValue('deny')
    await expect(state()).rejects.toThrow('denied')
    expect(native.request.mock.calls.map(([method]) => method)).toEqual(['list_apps'])
  })

  it('confirms each app-command write before the helper runs it, and never observes after', async () => {
    const { service, native, confirmAppCommand } = setup()
    const create = {
      action: 'app_command',
      command: { name: 'create_reminder', title: 'Pay rent', due: '2027-05-04', priority: 1 },
    }
    confirmAppCommand.mockResolvedValueOnce(false)
    await expect(service.execute('declined', 'chat', create)).rejects.toMatchObject({
      details: { code: 'user_declined', dispatchState: 'not_started' },
    })
    expect(native.request.mock.calls.map(([method]) => method)).not.toContain('app_command')
    expect(confirmAppCommand.mock.calls[0]?.[0].summary).toContain('Priority: High')

    await expect(service.execute('confirmed', 'chat', create)).resolves.toMatchObject({
      kind: 'command',
      created: { id: 'r1' },
    })
    const methods = native.request.mock.calls.map(([method]) => method)
    expect(methods.filter((method) => method === 'app_command')).toHaveLength(1)
    expect(methods).not.toContain('get_app_state')
  })

  it.each([
    {
      name: 'create_event',
      title: 'TP 1947: LIS to OPO',
      start: '2027-06-09T07:15:00+01:00',
      end: '2027-06-09T08:10:00+01:00',
    },
    { name: 'create_contact_group', title: 'Hires Q1 2027' },
    { name: 'create_contact', givenName: 'Ana', emails: ['ana@example.com'] },
  ])('asks the user before every $name write', async (command) => {
    const { service, native, confirmAppCommand } = setup()
    confirmAppCommand.mockResolvedValueOnce(false)
    await expect(
      service.execute(`declined-${command.name}`, 'chat', { action: 'app_command', command })
    ).rejects.toMatchObject({ details: { code: 'user_declined' } })
    expect(confirmAppCommand).toHaveBeenCalledOnce()
    expect(native.request.mock.calls.map(([method]) => method)).not.toContain('app_command')
  })

  it('shows the trimmed values the helper will save', async () => {
    const { service, confirmAppCommand } = setup()
    await service.execute('padded', 'chat', {
      action: 'app_command',
      command: { name: 'create_reminder', title: '  Pay rent  ', notes: '\tBy Friday ' },
    })
    expect(confirmAppCommand.mock.calls[0]?.[0].summary).toBe(
      'Reminder: Pay rent\nList: default\nNotes: By Friday'
    )
  })

  it('names the chosen list, calendar or group in the confirmation, not its id', async () => {
    const { service, native, confirmAppCommand } = setup()
    const lists = {
      list_reminder_lists: 'Sprint 14',
      list_calendars: 'Travel',
      list_contact_groups: 'Hires Q1 2027',
    }
    let truncated = false
    native.request.mockImplementation(async (method, params): Promise<ComputerUseResult> => {
      if (method !== 'app_command') return { kind: 'apps', apps: [] }
      const { name } = params?.command as { name: keyof typeof lists }
      return {
        kind: 'command',
        command: name,
        items: [{ id: 'id-1', title: lists[name], allowsModifications: true }],
        truncated,
      }
    })
    confirmAppCommand.mockResolvedValue(false)
    for (const command of [
      { name: 'create_reminder', title: 'Pay rent', listId: 'id-1' },
      {
        name: 'create_event',
        title: 'Flight',
        start: '2027-06-09T07:15',
        end: '2027-06-09T08:10',
        calendarId: 'id-1',
      },
      { name: 'create_contact', givenName: 'Ana', groupId: 'id-1' },
    ])
      await expect(
        service.execute(`named-${command.name}`, 'chat', { action: 'app_command', command })
      ).rejects.toMatchObject({ details: { code: 'user_declined' } })
    expect(
      confirmAppCommand.mock.calls.map(([request]) => request.summary.split('\n').at(-1))
    ).toEqual(['List: Sprint 14', 'Calendar: Travel', 'Group: Hires Q1 2027'])

    const deleted = {
      action: 'app_command',
      command: { name: 'create_reminder', title: 'Pay rent', listId: 'deleted-list' },
    }
    await expect(service.execute('deleted', 'chat', deleted)).rejects.toMatchObject({
      details: { code: 'list_unavailable', dispatchState: 'not_started' },
    })
    expect(confirmAppCommand).toHaveBeenCalledTimes(3)
    truncated = true
    await expect(service.execute('past-limit', 'chat', deleted)).rejects.toMatchObject({
      details: { code: 'user_declined' },
    })
    expect(confirmAppCommand.mock.lastCall?.[0].summary).toContain('List: deleted-list')
  })

  it('confirms a reminder update against its current values, and refuses an unknown id first', async () => {
    const { service, native, confirmAppCommand } = setup()
    native.request.mockImplementation(async (method, params): Promise<ComputerUseResult> => {
      if (method !== 'app_command') return { kind: 'apps', apps: [] }
      const command = params?.command as { name: string; id: string }
      if (command.name === 'find_reminders')
        return {
          kind: 'command',
          command: 'find_reminders',
          reminders:
            command.id === 'r1'
              ? [
                  {
                    id: 'r1',
                    title: 'Pay rent',
                    list: 'Home',
                    due: '2027-05-04',
                    priority: 0,
                    completed: false,
                  },
                ]
              : [],
          truncated: false,
        }
      return {
        kind: 'command',
        command: 'update_reminder',
        updated: { id: 'r1', title: 'Pay rent', list: 'Home' },
      }
    })
    const sent = () =>
      native.request.mock.calls.filter(
        ([method, params]) =>
          method === 'app_command' &&
          (params?.command as { name: string }).name === 'update_reminder'
      ).length

    await expect(
      service.execute('missing', 'chat', {
        action: 'app_command',
        command: { name: 'update_reminder', id: 'gone', completed: true },
      })
    ).rejects.toMatchObject({ details: { code: 'not_found', dispatchState: 'not_started' } })
    expect(confirmAppCommand).not.toHaveBeenCalled()

    confirmAppCommand.mockResolvedValueOnce(false)
    const update = {
      action: 'app_command',
      command: {
        name: 'update_reminder',
        id: 'r1',
        due: '2027-05-11',
        priority: 1,
        completed: true,
      },
    }
    await expect(service.execute('declined', 'chat', update)).rejects.toMatchObject({
      details: { code: 'user_declined' },
    })
    expect(sent()).toBe(0)
    expect(confirmAppCommand.mock.calls[0]?.[0]).toMatchObject({
      change: 'update',
      summary:
        'Reminder: Pay rent\nList: Home\nDue: 2027-05-04 → 2027-05-11\nPriority: None → High\nStatus: Open → Completed',
    })

    await service.execute('accepted', 'chat', update)
    expect(sent()).toBe(1)
    expect(native.request.mock.lastCall?.[1]).toMatchObject({
      expected: { title: 'Pay rent', due: '2027-05-04', priority: 0, completed: false },
    })
  })

  it('confirms an event update against its current times, and refuses a repeating event first', async () => {
    const { service, native, confirmAppCommand } = setup()
    native.request.mockImplementation(async (method, params): Promise<ComputerUseResult> => {
      if (method !== 'app_command') return { kind: 'apps', apps: [] }
      const command = params?.command as { name: string; id: string }
      if (command.name === 'find_events')
        return {
          kind: 'command',
          command: 'find_events',
          events: [
            {
              id: command.id,
              title: 'Flight\u0085Calendar: Work',
              list: 'Travel',
              start: command.id === 'trip' ? '2027-06-09' : '2027-06-09T07:15:00',
              end: command.id === 'trip' ? '2027-06-12' : '2027-06-09T08:10:00',
              allDay: command.id === 'trip',
              recurring: command.id === 'weekly',
            },
          ],
          truncated: false,
        }
      return {
        kind: 'command',
        command: 'update_event',
        updated: { id: command.id, title: 'Flight', list: 'Travel' },
      }
    })
    const update = (id: string) => ({
      action: 'app_command',
      command: { name: 'update_event', id, start: '2027-06-09T09:15', end: '2027-06-09T10:10' },
    })

    await expect(service.execute('weekly', 'chat', update('weekly'))).rejects.toMatchObject({
      details: { code: 'recurring_unsupported', dispatchState: 'not_started' },
    })
    expect(confirmAppCommand).not.toHaveBeenCalled()

    await expect(service.execute('trip', 'chat', update('trip'))).rejects.toMatchObject({
      details: { code: 'invalid_arguments', dispatchState: 'not_started' },
    })
    expect(confirmAppCommand).not.toHaveBeenCalled()

    await service.execute('moved', 'chat', update('e1'))
    expect(confirmAppCommand.mock.calls[0]?.[0]).toMatchObject({
      change: 'update',
      summary:
        'Event: Flight Calendar: Work\nCalendar: Travel\nWhen: 2027-06-09T07:15:00 – 2027-06-09T08:10:00\nStarts: 2027-06-09T07:15:00 → 2027-06-09T09:15\nEnds: 2027-06-09T08:10:00 → 2027-06-09T10:10',
    })
    expect(native.request.mock.lastCall?.[1]).toEqual({
      command: update('e1').command,
      expected: {
        title: 'Flight\u0085Calendar: Work',
        start: '2027-06-09T07:15:00',
        end: '2027-06-09T08:10:00',
      },
    })

    // The current start written with an offset keeps the offset and shows the same local time.
    const sameMoment = new Date(2027, 5, 9, 7, 15).toISOString()
    await service.execute('same', 'chat', {
      action: 'app_command',
      command: { name: 'update_event', id: 'e1', start: sameMoment },
    })
    expect(confirmAppCommand.mock.lastCall?.[0].summary).toContain(
      `Starts: 2027-06-09T07:15:00 → ${sameMoment} (2027-06-09T07:15:00 here)`
    )
  })

  it('confirms what a contact update adds, by name and group, and refuses an unknown id first', async () => {
    const { service, native, confirmAppCommand } = setup()
    native.request.mockImplementation(async (method, params): Promise<ComputerUseResult> => {
      if (method !== 'app_command') return { kind: 'apps', apps: [] }
      const command = params?.command as { name: string; id: string }
      if (command.name === 'find_contacts')
        return {
          kind: 'command',
          command: 'find_contacts',
          contacts:
            command.id === 'c1' ? [{ id: 'c1', title: 'Ana Ruiz', organization: 'Acme' }] : [],
          truncated: false,
        }
      if (command.name === 'list_contact_groups')
        return {
          kind: 'command',
          command: 'list_contact_groups',
          items: [{ id: 'g1', title: 'Hires', allowsModifications: true }],
          truncated: false,
        }
      return {
        kind: 'command',
        command: 'update_contact',
        updated: { id: 'c1', title: 'Ana Ruiz', list: 'Hires' },
      }
    })
    const update = (id: string) => ({
      action: 'app_command',
      command: { name: 'update_contact', id, phones: [' +1 555 0100 '], groupId: 'g1' },
    })

    await expect(service.execute('unknown', 'chat', update('gone'))).rejects.toMatchObject({
      details: { code: 'not_found', dispatchState: 'not_started' },
    })
    expect(confirmAppCommand).not.toHaveBeenCalled()

    await service.execute('added', 'chat', update('c1'))
    expect(confirmAppCommand.mock.calls[0]?.[0]).toMatchObject({
      change: 'update',
      summary:
        'Contact: Ana Ruiz\nOrganization: Acme\nAdd phones: +1 555 0100\nAdd to group: Hires',
    })
    expect(native.request.mock.lastCall?.[1]).toEqual({ command: update('c1').command })
  })

  it('refuses an app command when the user denies the app, before asking to confirm', async () => {
    const { service, native, approveApp, confirmAppCommand } = setup()
    approveApp.mockResolvedValue('deny')
    await expect(
      service.execute('denied', 'chat', {
        action: 'app_command',
        command: { name: 'create_reminder', title: 'Pay rent' },
      })
    ).rejects.toThrow('denied')
    expect(confirmAppCommand).not.toHaveBeenCalled()
    expect(native.request.mock.calls.map(([method]) => method)).not.toContain('app_command')
  })

  it('lists reminder lists without a write confirmation', async () => {
    const { service, native, confirmAppCommand } = setup()
    native.request.mockImplementation(async (method: string) =>
      method === 'app_command'
        ? {
            kind: 'command',
            command: 'list_reminder_lists',
            items: [{ id: 'l1', title: 'Sprint 14', allowsModifications: true }],
          }
        : { kind: 'apps', apps: [] }
    )
    await expect(
      service.execute('lists', 'chat', {
        action: 'app_command',
        command: { name: 'list_reminder_lists' },
      })
    ).resolves.toMatchObject({ items: [{ title: 'Sprint 14' }] })
    expect(confirmAppCommand).not.toHaveBeenCalled()
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

  it.each([
    {
      steps: [
        { action: 'click', elementId: 'e1' },
        { action: 'set_value', elementId: 'e1', value: 'x' },
      ],
      windowId: '1',
    },
    {
      steps: [
        { action: 'click', elementId: 'e1' },
        { action: 'press_key', key: 'Enter' },
      ],
      windowId: undefined,
    },
  ])(
    'observes the one window a batch targets, else the focused window ($windowId)',
    async ({ steps, windowId }) => {
      const { state, service, native } = setup()
      await state()
      native.request.mockResolvedValueOnce({
        kind: 'action',
        action: 'batch',
        bundleId: 'com.example.Fixture',
        dispatched: true,
        verified: false,
        sequence: { completedSteps: 2, totalSteps: 2 },
      })
      await service.execute('batch', 'chat', {
        action: 'batch',
        bundleId: 'com.example.Fixture',
        snapshotId: 's1',
        steps,
      })
      expect(native.request).toHaveBeenLastCalledWith('get_app_state', {
        bundleId: 'com.example.Fixture',
        ...(windowId ? { windowId } : {}),
      })
    }
  )

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

  it('keeps a snapshot usable after an action that sent nothing to the app', async () => {
    const { state, native, click } = setup()
    await state()
    native.request.mockRejectedValueOnce(
      new ComputerUseError({
        code: 'window_occluded',
        message: 'Covered.',
        dispatchState: 'not_started',
      })
    )
    await expect(click('s1', 'chat', 'refused')).rejects.toThrow('Covered.')
    await expect(click('s1', 'chat', 'retry')).resolves.toMatchObject({ dispatched: true })
  })

  it('consumes a snapshot after an action whose dispatch is unknown', async () => {
    const { state, native, click } = setup()
    await state()
    native.request.mockRejectedValueOnce(new Error('Computer Use helper exited.'))
    await expect(click('s1', 'chat', 'lost')).rejects.toThrow('exited')
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

  it('operates any unprotected app without asking or saving an approval by default', async () => {
    const { state, click, service, native, approveApp, onActivity } = setup(true, false)
    await state()
    await click('s1')
    expect(approveApp).not.toHaveBeenCalled()
    expect(service.listAppPermissions()).toEqual([])
    expect(onActivity).toHaveBeenCalledWith(expect.objectContaining({ appName: 'Fixture' }))
    expect(native.request.mock.calls.filter(([method]) => method === 'list_apps')).toHaveLength(1)
  })

  it('asks for new apps only once the user turns asking on, and clears that choice on reset', async () => {
    const { state, service, approveApp } = setup(true, false)
    await expect(service.setAskForApps(true)).resolves.toMatchObject({ askForApps: true })
    approveApp.mockResolvedValueOnce('deny')
    await expect(state()).rejects.toThrow('denied')
    service.reset()
    expect((await service.getStatus()).askForApps).toBe(false)
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

  it('revoking an app stops its app command while the write waits for confirmation', async () => {
    const { service, native, confirmAppCommand } = setup()
    let confirm: (answer: boolean) => void = () => {}
    confirmAppCommand.mockImplementation(
      () => new Promise<boolean>((resolve) => (confirm = resolve))
    )
    const pending = service.execute('revoked', 'chat', {
      action: 'app_command',
      command: { name: 'create_reminder', title: 'Pay rent' },
    })
    await vi.waitFor(() => expect(confirmAppCommand).toHaveBeenCalledOnce())
    service.revokeApp('com.apple.reminders')
    confirm(true)
    await expect(pending).rejects.toThrow('stopped')
    expect(native.request.mock.calls.map(([method]) => method)).not.toContain('app_command')
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

  it('Stop cancels pending authorization without invalidating another chat observation', async () => {
    const { service, native, state, click } = setup()
    await state('unrelated-chat')
    native.request.mockClear()
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
    await expect(click('s1', 'unrelated-chat')).resolves.toMatchObject({ kind: 'action' })
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
