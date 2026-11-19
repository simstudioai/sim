import {
  type ComputerUseActivity,
  type ComputerUseAppPermission,
  ComputerUseError,
  type ComputerUsePermission,
  type ComputerUseStatus,
} from '@sim/desktop-bridge'
import {
  type AppCommand,
  type ComputerUseResult,
  type ComputerUseSnapshot,
  type ComputerUseWithAppCommandsInput,
  ComputerUseWithAppCommandsSchema,
} from '@sim/desktop-bridge/computer-use'
import { getErrorMessage } from '@sim/utils/errors'
import { omit } from '@sim/utils/object'
import type { ComputerUseNativeClient } from '@/main/computer-use/native-client'
import type { ConfigStore } from '@/main/config'

interface ComputerUseServiceDeps {
  config: Pick<ConfigStore, 'get' | 'set' | 'flush'>
  supported: boolean
  native: ComputerUseNativeClient
  approveApp: (
    app: ComputerUseAppPermission,
    signal: AbortSignal
  ) => Promise<'once' | 'always' | 'deny'>
  /** Confirms one app-command write. It shows the exact fields, since nothing happens on screen. */
  confirmAppCommand: (
    request: { appName: string; summary: string },
    signal: AbortSignal
  ) => Promise<boolean>
  onActivity: (activity: ComputerUseActivity | null) => void
  setStopShortcutActive?: (active: boolean) => boolean
  openPermissionSettings?: (permission: ComputerUsePermission) => Promise<void>
}

interface ToolWork {
  toolCallId: string
  scopeId: string
  input: ComputerUseWithAppCommandsInput
  controller: AbortController
}

interface SnapshotOwnership {
  scopeId: string
  bundleId: string
  windowId: string
  elementWindows: Map<string, string>
}

/** The app each command writes to; its Computer Use app permission governs the command. */
const APP_COMMAND_APPS: Record<AppCommand['name'], string> = {
  list_reminder_lists: 'com.apple.reminders',
  create_reminder: 'com.apple.reminders',
  list_calendars: 'com.apple.iCal',
  create_event: 'com.apple.iCal',
  list_contact_groups: 'com.apple.AddressBook',
  create_contact_group: 'com.apple.AddressBook',
  create_contact: 'com.apple.AddressBook',
}

const PRIORITY_NAMES: Record<number, string> = { 1: 'High', 5: 'Medium', 9: 'Low' }

/** The app a call operates; an app command operates the app its data belongs to. */
function workBundleId(input: ComputerUseWithAppCommandsInput): string | undefined {
  if (input.action === 'app_command') return APP_COMMAND_APPS[input.command.name]
  return 'bundleId' in input ? input.bundleId : undefined
}

/** The list, calendar or group a write names by id, and the read that lists its kind. */
function chosenDestination(
  command: AppCommand
): { id: string; list: 'list_reminder_lists' | 'list_calendars' | 'list_contact_groups' } | null {
  if (command.name === 'create_reminder' && command.listId)
    return { id: command.listId, list: 'list_reminder_lists' }
  if (command.name === 'create_event' && command.calendarId)
    return { id: command.calendarId, list: 'list_calendars' }
  if (command.name === 'create_contact' && command.groupId)
    return { id: command.groupId, list: 'list_contact_groups' }
  return null
}

/**
 * The exact fields a write will save, for the user to confirm; null for a read, which needs none.
 * `destination` is the chosen list, calendar or group by name, so the user can tell where it goes.
 */
function writeSummary(command: AppCommand, destination: string | undefined): string | null {
  // Trimmed exactly as the helper trims before saving, so the user confirms the saved values.
  const lines = (entries: Array<[string, string | number | undefined]>) =>
    entries
      .map(([label, value]) => [label, typeof value === 'string' ? value.trim() : value] as const)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([label, value]) => `${label}: ${value}`)
      .join('\n')
  switch (command.name) {
    case 'create_reminder':
      return lines([
        ['Reminder', command.title],
        ['Due', command.due],
        ['Priority', command.priority ? PRIORITY_NAMES[command.priority] : undefined],
        ['List', destination ?? 'default'],
        ['Notes', command.notes],
      ])
    case 'create_event':
      return lines([
        ['Event', command.title],
        ['Starts', command.start],
        ['Ends', command.end],
        ['All day', command.allDay ? 'yes' : undefined],
        ['Location', command.location],
        [
          'Alert',
          command.alertMinutesBefore !== undefined
            ? `${command.alertMinutesBefore} minutes before`
            : undefined,
        ],
        ['Calendar', destination ?? 'default'],
        ['Notes', command.notes],
      ])
    case 'create_contact_group':
      return lines([['Contact group', command.title]])
    case 'create_contact':
      return lines([
        ['Contact', [command.givenName, command.familyName].filter(Boolean).join(' ') || undefined],
        ['Organization', command.organization],
        ['Job title', command.jobTitle],
        ['Emails', command.emails?.map((email) => email.trim()).join(', ')],
        ['Phones', command.phones?.map((phone) => phone.trim()).join(', ')],
        ['Group', destination],
      ])
    default:
      return null
  }
}

/** Native snapshots cannot transfer authority between chats or restarted helpers. */
export class ComputerUseService {
  private admissions = new Map<string, AbortController>()
  private active: ToolWork | null = null
  private tail: Promise<void> = Promise.resolve()
  private queued = new Map<string, ToolWork>()
  private snapshots = new Map<string, SnapshotOwnership>()
  private activity: ComputerUseActivity | null = null
  private taskGrants = new Map<string, Map<string, string>>()
  /** App names from the helper's app list, so an unprompted action can name its app without listing apps again. */
  private appNames = new Map<string, string>()

  constructor(private readonly deps: ComputerUseServiceDeps) {}

  isEnabled(): boolean {
    return this.deps.supported && this.deps.config.get('computerUseEnabled') === true
  }

  private asksForApps(): boolean {
    return this.deps.config.get('computerUseAskForApps') === true
  }

  getActivity(): ComputerUseActivity | null {
    return this.activity
  }

  async getStatus(): Promise<ComputerUseStatus> {
    const status: ComputerUseStatus = {
      supported: this.deps.supported,
      enabled: this.isEnabled(),
      permissions: { accessibility: false, screenCapture: false },
      activeAction: this.activity,
      askForApps: this.asksForApps(),
    }
    if (!status.enabled) return status
    const native = await this.deps.native.request('status', {})
    if (native.kind !== 'status') throw new Error('Computer Use permission status is unavailable.')
    status.permissions = {
      accessibility: native.accessibility,
      screenCapture: native.screenRecording,
      reminders: native.reminders === 'granted',
      calendars: native.calendars === 'granted',
      contacts: native.contacts === 'granted',
    }
    status.enabled = this.isEnabled()
    status.activeAction = this.activity
    return status
  }

  async setEnabled(enabled: boolean): Promise<ComputerUseStatus> {
    if (enabled && !this.deps.supported) throw new Error('Computer Use requires macOS 14 or later.')
    this.deps.config.set('computerUseEnabled', enabled)
    if (!enabled) this.cancel()
    if (!this.deps.config.flush()) {
      this.deps.config.set('computerUseEnabled', false)
      this.cancel()
      throw new Error('Could not save Computer Use settings. Computer Use has been switched off.')
    }
    this.deps.onActivity(this.activity)
    return this.getStatus()
  }

  async setAskForApps(ask: boolean): Promise<ComputerUseStatus> {
    const previous = this.asksForApps()
    this.deps.config.set('computerUseAskForApps', ask)
    if (!this.deps.config.flush()) {
      this.deps.config.set('computerUseAskForApps', previous)
      throw new Error('Could not save Computer Use settings.')
    }
    return this.getStatus()
  }

  async requestPermission(permission: ComputerUsePermission): Promise<ComputerUseStatus> {
    if (!this.deps.supported) return this.getStatus()
    await this.deps.native.request('request_permission', { permission })
    await this.deps.openPermissionSettings?.(permission)
    return this.getStatus()
  }

  listAppPermissions(): ComputerUseAppPermission[] {
    return (this.deps.config.get('computerUseAllowedApps') ?? []).map((entry) => ({ ...entry }))
  }

  revokeApp(bundleId: string): void {
    this.deps.config.set(
      'computerUseAllowedApps',
      this.listAppPermissions().filter((app) => app.bundleId !== bundleId)
    )
    const persisted = this.deps.config.flush()
    for (const work of this.queued.values()) {
      if (workBundleId(work.input) === bundleId) this.cancel(work.toolCallId)
    }
    for (const apps of this.taskGrants.values()) apps.delete(bundleId)
    this.invalidateSnapshots()
    if (!persisted) throw new Error('Could not save the revoked app permission.')
  }

  invalidateSnapshots(): void {
    this.snapshots.clear()
  }

  reset(): void {
    this.cancel()
    this.appNames.clear()
    this.deps.config.set('computerUseEnabled', false)
    this.deps.config.set('computerUseAskForApps', false)
    this.deps.config.set('computerUseAllowedApps', [])
    if (!this.deps.config.flush())
      throw new Error('Could not clear saved Computer Use permissions.')
  }

  cancel(toolCallId?: string): void {
    for (const [id, controller] of this.admissions) {
      if (!toolCallId || id === toolCallId) controller.abort()
    }
    if (!toolCallId) this.taskGrants.clear()
    else {
      const work = this.queued.get(toolCallId)
      if (work) this.taskGrants.delete(work.scopeId)
    }
    for (const work of this.queued.values()) {
      if (!toolCallId || work.toolCallId === toolCallId) work.controller.abort()
    }
    if (!toolCallId || this.active?.toolCallId === toolCallId) {
      this.deps.native.stop()
      this.invalidateSnapshots()
    }
  }

  /** Register Stop before awaiting the server's one-shot tool authorization. */
  async executeAuthorized(
    toolCallId: string,
    authorize: () => Promise<{ scopeId: string; input: unknown }>
  ): Promise<ComputerUseResult> {
    if (!this.isEnabled()) throw new Error('Computer Use is switched off on this Mac.')
    if (this.admissions.size + this.queued.size >= 16)
      throw new Error('Computer Use has too many queued actions.')
    if (this.admissions.has(toolCallId) || this.queued.has(toolCallId))
      throw new Error('This Computer Use action is already running.')
    const controller = new AbortController()
    this.admissions.set(toolCallId, controller)
    try {
      const authorized = await authorize()
      if (controller.signal.aborted || !this.isEnabled()) throw new Error('Computer Use stopped.')
      this.admissions.delete(toolCallId)
      return await this.execute(toolCallId, authorized.scopeId, authorized.input)
    } finally {
      this.admissions.delete(toolCallId)
    }
  }

  execute(toolCallId: string, scopeId: string, raw: unknown): Promise<ComputerUseResult> {
    if (!this.isEnabled())
      return Promise.reject(new Error('Computer Use is switched off on this Mac.'))
    if (this.admissions.size + this.queued.size >= 16)
      return Promise.reject(new Error('Computer Use has too many queued actions.'))
    if (this.queued.has(toolCallId))
      return Promise.reject(new Error('This Computer Use action is already running.'))
    // A newer server can send arguments this build predates; nothing has been queued yet.
    const parsed = ComputerUseWithAppCommandsSchema.safeParse(raw)
    if (!parsed.success)
      return Promise.reject(
        new ComputerUseError({
          code: 'invalid_arguments',
          message:
            'This desktop app does not support these Computer Use arguments; update Sim Desktop.',
          dispatchState: 'not_started',
        })
      )
    const input = parsed.data
    const work: ToolWork = { toolCallId, scopeId, input, controller: new AbortController() }
    this.queued.set(toolCallId, work)
    const result = this.tail.then(() => this.run(work))
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result.finally(() => this.queued.delete(toolCallId))
  }

  private check(work: ToolWork): void {
    if (work.controller.signal.aborted || !this.isEnabled())
      throw new Error('Computer Use stopped.')
  }

  private async run(work: ToolWork): Promise<ComputerUseResult> {
    this.check(work)
    this.active = work
    const { input } = work
    try {
      this.activity = {
        toolCallId: work.toolCallId,
        scopeId: work.scopeId,
        action: input.action,
        ...('bundleId' in input ? { bundleId: input.bundleId } : {}),
        startedAt: Date.now(),
        stopShortcutAvailable: this.deps.setStopShortcutActive?.(true) ?? false,
      }
      this.deps.onActivity(this.activity)
      if (input.action === 'app_command') return await this.runAppCommand(input.command, work)
      if ('bundleId' in input) {
        if (/^ai\.sim\.desktop(?:\.|$)/.test(input.bundleId)) {
          throw new Error('Computer Use cannot operate Sim or its own permission controls.')
        }
        if ('snapshotId' in input) {
          const owner = this.snapshots.get(input.snapshotId)
          if (owner?.scopeId !== work.scopeId || owner.bundleId !== input.bundleId) {
            throw new Error(
              'This snapshot is stale or belongs to another chat. Observe the app again.'
            )
          }
        }
        const appName = await this.authorizeApp(input.bundleId, work)
        this.activity = { ...this.activity, appName }
        this.deps.onActivity(this.activity)
      }
      this.check(work)
      const owner = 'snapshotId' in input ? this.snapshots.get(input.snapshotId) : undefined
      /**
       * Element and coordinate calls observe the window they acted on. An untargeted key keeps the
       * focused-window default, so a key that closes the window still returns fresh state.
       */
      const targetWindow = (target: { windowId?: string; elementId?: string; x?: number }) =>
        target.windowId ??
        (target.elementId
          ? (owner?.elementWindows.get(target.elementId) ?? owner?.windowId)
          : target.x !== undefined
            ? owner?.windowId
            : undefined)
      /** A batch observes the one window all of its steps target; any untargeted step keeps the focused default. */
      const batchWindows =
        input.action === 'batch' ? new Set(input.steps.map(targetWindow)) : undefined
      const windowId = batchWindows
        ? batchWindows.size === 1
          ? [...batchWindows][0]
          : undefined
        : targetWindow({
            windowId: 'windowId' in input ? input.windowId : undefined,
            elementId: 'elementId' in input ? input.elementId : undefined,
            x: 'x' in input ? input.x : undefined,
          })
      if ('snapshotId' in input) this.snapshots.delete(input.snapshotId)
      /** Mutations accept includeScreenshot as shorthand for observeAfter.includeScreenshot. */
      const isMutation = input.action !== 'get_app_state'
      const observeAfter = {
        ...('observeAfter' in input ? input.observeAfter : {}),
        ...(isMutation && 'includeScreenshot' in input && input.includeScreenshot !== undefined
          ? { includeScreenshot: input.includeScreenshot }
          : {}),
      }
      const fields: Record<string, unknown> = input
      const params = isMutation
        ? omit(fields, ['action', 'observeAfter', 'includeScreenshot'])
        : omit(fields, ['action'])
      let result: ComputerUseResult
      try {
        result = await this.deps.native.request(input.action, params)
      } catch (error) {
        /** The helper keeps a snapshot nothing was sent through, so its ownership stays too. */
        if (
          owner &&
          'snapshotId' in input &&
          error instanceof ComputerUseError &&
          error.details.dispatchState === 'not_started'
        )
          this.snapshots.set(input.snapshotId, owner)
        throw error
      }
      this.check(work)
      if (result.kind === 'state') this.rememberSnapshot(work, result, windowId)
      if (result.kind === 'action') {
        if (
          !('bundleId' in input) ||
          result.bundleId !== input.bundleId ||
          result.action !== input.action
        )
          throw new Error('Computer Use returned an action for a different target.')
        try {
          const observation = await this.deps.native.request('get_app_state', {
            bundleId: input.bundleId,
            ...(windowId ? { windowId } : {}),
            ...observeAfter,
          })
          this.check(work)
          if (observation.kind !== 'state')
            throw new Error('Computer Use did not return fresh app state.')
          this.rememberSnapshot(work, observation, windowId)
          return { ...result, observation }
        } catch (error) {
          this.check(work)
          /** Dispatch already happened; a failed read must never replay the mutation. */
          return {
            ...result,
            observationError: getErrorMessage(
              error,
              'Could not observe the app after input.'
            ).slice(0, 2000),
          }
        }
      }
      return result
    } finally {
      this.deps.setStopShortcutActive?.(false)
      this.active = null
      this.activity = null
      this.deps.onActivity(null)
    }
  }

  /**
   * A typed write through the OS's data frameworks leaves nothing on screen to watch, so each one
   * needs the app's usual Computer Use permission and its own confirmation of the exact fields.
   */
  private async runAppCommand(command: AppCommand, work: ToolWork): Promise<ComputerUseResult> {
    const appName = await this.authorizeApp(APP_COMMAND_APPS[command.name], work)
    if (this.activity) {
      this.activity = { ...this.activity, appName }
      this.deps.onActivity(this.activity)
    }
    const summary = writeSummary(command, await this.destinationName(command, work))
    if (summary !== null) {
      const confirmed = await this.deps.confirmAppCommand(
        { appName, summary },
        work.controller.signal
      )
      this.check(work)
      if (!confirmed)
        throw new ComputerUseError({
          code: 'user_declined',
          message: 'The user declined to add this item. Do not retry it.',
          dispatchState: 'not_started',
        })
    }
    this.check(work)
    return await this.appCommand(command)
  }

  /** Runs one app command in the helper and checks the reply is for that command. */
  private async appCommand(
    command: AppCommand
  ): Promise<Extract<ComputerUseResult, { kind: 'command' }>> {
    const result = await this.deps.native.request('app_command', { command })
    if (result.kind !== 'command' || result.command !== command.name)
      throw new Error('Computer Use returned a result for a different command.')
    return result
  }

  /**
   * The name of the list, calendar or group a write chose by id, read when it is confirmed so the
   * name is current. An id missing from a complete read is refused before the user is asked; past
   * the read's limit the id itself is shown, and the helper checks it before saving.
   */
  private async destinationName(command: AppCommand, work: ToolWork): Promise<string | undefined> {
    const destination = chosenDestination(command)
    if (!destination) return undefined
    const lists = await this.appCommand({ name: destination.list })
    this.check(work)
    const chosen = lists.items?.find((item) => item.id === destination.id)
    if (chosen) return chosen.title
    if (lists.truncated) return destination.id
    throw new ComputerUseError({
      code: 'list_unavailable',
      message: `No list, calendar or group has this id; call ${destination.list}.`,
      dispatchState: 'not_started',
    })
  }

  private rememberSnapshot(work: ToolWork, snapshot: ComputerUseSnapshot, windowId?: string): void {
    if (!('bundleId' in work.input) || snapshot.bundleId !== work.input.bundleId)
      throw new Error('Computer Use returned state for a different app.')
    if (windowId && snapshot.windowId !== windowId)
      throw new Error('Computer Use returned state for a different window.')
    for (const [id, owner] of this.snapshots) {
      if (owner.bundleId === snapshot.bundleId) this.snapshots.delete(id)
    }
    if (this.snapshots.size >= 16) this.snapshots.clear()
    this.snapshots.set(snapshot.snapshotId, {
      scopeId: work.scopeId,
      bundleId: snapshot.bundleId,
      windowId: snapshot.windowId,
      elementWindows: new Map(
        snapshot.nodes.flatMap((node) => (node.windowId ? [[node.elementId, node.windowId]] : []))
      ),
    })
  }

  /** Every unprotected app is allowed unless the user chose to approve each app's first use. */
  private async authorizeApp(bundleId: string, work: ToolWork): Promise<string> {
    const approved = this.listAppPermissions().find((app) => app.bundleId === bundleId)
    if (approved) return approved.displayName
    const taskName = this.taskGrants.get(work.scopeId)?.get(bundleId)
    if (taskName) return taskName
    const target = { bundleId, displayName: await this.appName(bundleId, work) }
    if (!this.asksForApps()) return target.displayName
    const answer = await this.deps.approveApp(target, work.controller.signal)
    this.check(work)
    if (answer === 'deny')
      throw new Error(`Computer Use access to ${target.displayName} was denied.`)
    if (answer === 'once') {
      if (this.taskGrants.size >= 64 && !this.taskGrants.has(work.scopeId)) {
        const oldest = this.taskGrants.keys().next().value
        if (oldest) this.taskGrants.delete(oldest)
      }
      const apps = this.taskGrants.get(work.scopeId) ?? new Map<string, string>()
      apps.set(bundleId, target.displayName)
      this.taskGrants.set(work.scopeId, apps)
    }
    if (answer === 'always') {
      const previous = this.listAppPermissions()
      this.deps.config.set('computerUseAllowedApps', [...previous, target])
      if (!this.deps.config.flush()) {
        this.deps.config.set('computerUseAllowedApps', previous)
        throw new Error('Could not save the app permission. Computer Use did not run this action.')
      }
    }
    return target.displayName
  }

  private async appName(bundleId: string, work: ToolWork): Promise<string> {
    const known = this.appNames.get(bundleId)
    if (known) return known
    const apps = await this.deps.native.request('list_apps', {})
    this.check(work)
    if (apps.kind === 'apps') {
      this.appNames.clear()
      for (const app of apps.apps) this.appNames.set(app.bundleId, app.name)
    }
    /** An app outside the scanned folders keeps its bundle ID, so it is not rescanned on every action. */
    if (!this.appNames.has(bundleId)) this.appNames.set(bundleId, bundleId)
    return this.appNames.get(bundleId) ?? bundleId
  }
}
