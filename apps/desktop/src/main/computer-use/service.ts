import type {
  ComputerUseActivity,
  ComputerUseAppPermission,
  ComputerUseStatus,
} from '@sim/desktop-bridge'
import {
  type ComputerUseInput,
  type ComputerUseResult,
  ComputerUseSchema,
} from '@sim/desktop-bridge/computer-use'
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
  onActivity: (activity: ComputerUseActivity | null) => void
  setStopShortcutActive?: (active: boolean) => boolean
  openPermissionSettings?: (permission: 'accessibility' | 'screenCapture') => Promise<void>
}

interface ToolWork {
  toolCallId: string
  scopeId: string
  input: ComputerUseInput
  controller: AbortController
}

/** Native snapshots cannot transfer authority between chats or restarted helpers. */
export class ComputerUseService {
  private admissions = new Map<string, AbortController>()
  private active: ToolWork | null = null
  private tail: Promise<void> = Promise.resolve()
  private queued = new Map<string, ToolWork>()
  private snapshots = new Map<string, { scopeId: string; bundleId: string }>()
  private activity: ComputerUseActivity | null = null
  private taskGrants = new Map<string, Map<string, string>>()

  constructor(private readonly deps: ComputerUseServiceDeps) {}

  isEnabled(): boolean {
    return this.deps.supported && this.deps.config.get('computerUseEnabled') === true
  }

  async getStatus(): Promise<ComputerUseStatus> {
    const status: ComputerUseStatus = {
      supported: this.deps.supported,
      enabled: this.isEnabled(),
      permissions: { accessibility: false, screenCapture: false },
      activeAction: this.activity,
    }
    if (!status.supported) return status
    const native = await this.deps.native.request('status', {})
    if (native.kind !== 'status') throw new Error('Computer Use permission status is unavailable.')
    status.permissions = {
      accessibility: native.accessibility,
      screenCapture: native.screenRecording,
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

  async requestPermission(
    permission: 'accessibility' | 'screenCapture'
  ): Promise<ComputerUseStatus> {
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
      if ('bundleId' in work.input && work.input.bundleId === bundleId) this.cancel(work.toolCallId)
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
    this.deps.config.set('computerUseEnabled', false)
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
    if (!toolCallId || this.active?.toolCallId === toolCallId) this.deps.native.stop()
    this.invalidateSnapshots()
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
    const input = ComputerUseSchema.parse(raw)
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
      if ('snapshotId' in input) this.snapshots.delete(input.snapshotId)
      const result = await this.deps.native.request(input.action, omit(input, ['action']))
      this.check(work)
      if (result.kind === 'state') {
        if (!('bundleId' in input) || result.bundleId !== input.bundleId) {
          throw new Error('Computer Use returned state for a different app.')
        }
        for (const [id, owner] of this.snapshots) {
          if (owner.bundleId === result.bundleId) this.snapshots.delete(id)
        }
        if (this.snapshots.size >= 16) this.snapshots.clear()
        this.snapshots.set(result.snapshotId, { scopeId: work.scopeId, bundleId: result.bundleId })
      }
      return result
    } finally {
      this.deps.setStopShortcutActive?.(false)
      this.active = null
      this.activity = null
      this.deps.onActivity(null)
    }
  }

  private async authorizeApp(bundleId: string, work: ToolWork): Promise<string> {
    const approved = this.listAppPermissions().find((app) => app.bundleId === bundleId)
    if (approved) return approved.displayName
    const taskName = this.taskGrants.get(work.scopeId)?.get(bundleId)
    if (taskName) return taskName
    const apps = await this.deps.native.request('list_apps', {})
    this.check(work)
    const app =
      apps.kind === 'apps' ? apps.apps.find((app) => app.bundleId === bundleId) : undefined
    const target = { bundleId, displayName: app?.name ?? bundleId }
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
}
