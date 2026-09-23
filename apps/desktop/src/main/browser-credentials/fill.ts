import type { BrowserCredentialMetadata } from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import type { BrowserWindow, WebContents } from 'electron'
import { normalizeOrigin } from '@/main/browser-credentials/origin'
import { CredentialPicker } from '@/main/browser-credentials/picker'
import type { CredentialVault } from '@/main/browser-credentials/vault'
import type {
  CredentialFieldBounds,
  CredentialFillResult,
  CredentialFillStatus,
  CredentialFormReport,
} from '@/shared/browser-credentials'

const logger = createLogger('BrowserCredentialFill')
const FILL_TIMEOUT_MS = 2_000

interface FormState extends CredentialFormReport {
  generation: number
}

export interface FillCoordinatorDeps {
  vault: CredentialVault
  getActiveContents: (scopeId?: string) => WebContents | null
  scopeOwnsContents: (scopeId: string, contents: WebContents) => boolean
  onAvailabilityChanged: (available: boolean, contents: WebContents | null) => void
  /** Screen coordinates for the focused field, only while its native page is visible. */
  pickerHost?: (
    contents: WebContents,
    bounds: CredentialFieldBounds
  ) => { window: BrowserWindow; anchor: CredentialFieldBounds } | null
}

interface SelectionAuthorization {
  pickerVersion?: number
  credentialIds: ReadonlySet<string>
  generation: number
  targetId: string
}

interface PendingFill {
  pickerVersion?: number
  requestId: string
  targetId: string
  generation: number
  complete: (status: CredentialFillStatus) => void
}

/** Keeps authorization in main and binds every user selection to a live document and form. */
export class FillCoordinator {
  private readonly states = new WeakMap<WebContents, FormState>()
  private readonly generations = new WeakMap<WebContents, number>()
  private readonly selectionAuthorizations = new WeakMap<WebContents, SelectionAuthorization>()
  private readonly pendingFills = new Map<WebContents, PendingFill>()
  private readonly availabilityRefreshes = new WeakMap<WebContents, number>()
  private availabilityRefreshWithoutContents = 0
  private readonly lastAvailability = new WeakMap<WebContents, boolean>()
  private lastAvailabilityWithoutContents = false
  private picker: { view: CredentialPicker; contents: WebContents; targetId: string } | null = null
  private pickerVersion = 0
  private disposed = false

  constructor(private readonly deps: FillCoordinatorDeps) {}

  private generationFor(contents: WebContents): number {
    return this.generations.get(contents) ?? 0
  }

  noteFormState(contents: WebContents, report: CredentialFormReport): void {
    const previous = this.states.get(contents)
    const origin = normalizeOrigin(report.origin)
    if (previous?.targetId !== report.targetId || previous?.origin !== origin) {
      this.selectionAuthorizations.delete(contents)
      this.pendingFills.get(contents)?.complete('stale-target')
      if (this.picker?.contents === contents) this.dismissPicker()
    }
    if (origin === null || !report.targetId || !report.hasLoginForm) {
      this.states.delete(contents)
    } else {
      this.states.set(contents, { ...report, origin, generation: this.generationFor(contents) })
    }
    if (this.picker?.contents === contents) {
      const host = report.bounds ? this.deps.pickerHost?.(contents, report.bounds) : null
      if (host) this.picker.view.position(host.anchor)
      else this.dismissPicker()
    }
    void this.refreshAvailability()
  }

  noteNavigation(contents: WebContents, sameDocument = false): void {
    this.generations.set(contents, this.generationFor(contents) + 1)
    this.states.delete(contents)
    this.selectionAuthorizations.delete(contents)
    this.pendingFills.get(contents)?.complete('stale-target')
    if (this.picker?.contents === contents) this.dismissPicker()
    if (sameDocument && !contents.isDestroyed()) contents.send('browser-credentials:rescan')
    void this.refreshAvailability()
  }

  forget(contents: WebContents): void {
    this.noteNavigation(contents)
    this.generations.delete(contents)
  }

  dispose(): void {
    this.disposed = true
    this.dismissPicker()
    for (const pending of this.pendingFills.values()) pending.complete('stale-target')
  }

  private async isFillAvailableFor(contents: WebContents | null): Promise<boolean> {
    if (this.disposed || !contents || contents.isDestroyed()) return false
    const state = this.states.get(contents)
    if (!state?.hasLoginForm || !this.deps.vault.isAvailable()) return false
    return (await this.deps.vault.listForOrigin(state.origin)).length > 0
  }

  isFillAvailable(): Promise<boolean> {
    return this.isFillAvailableFor(this.deps.getActiveContents())
  }

  /** Kept for hosted renderers that still use the previous toolbar chooser. */
  async listFillOptions(
    scopeId?: string,
    pickerVersion?: number
  ): Promise<BrowserCredentialMetadata[]> {
    const contents = this.deps.getActiveContents(scopeId)
    if (!contents || contents.isDestroyed()) return []
    const state = this.states.get(contents)
    if (!state?.targetId || !this.deps.vault.isAvailable()) return []
    const authorization = {
      pickerVersion,
      generation: state.generation,
      targetId: state.targetId,
      credentialIds: new Set<string>(),
    }
    if (!this.isStillAuthorized(contents, authorization, scopeId)) return []
    const matches = await this.deps.vault.listForOrigin(state.origin)
    if (!this.isStillAuthorized(contents, authorization, scopeId)) return []
    authorization.credentialIds = new Set(matches.map((credential) => credential.id))
    this.selectionAuthorizations.set(contents, authorization)
    return matches
  }

  async fillCredential(credentialId: string, scopeId?: string): Promise<boolean> {
    return (await this.fillSelected(credentialId, scopeId)) === 'filled'
  }

  private async fillSelected(
    credentialId: string,
    scopeId?: string,
    expected?: SelectionAuthorization
  ): Promise<CredentialFillStatus> {
    const contents = this.deps.getActiveContents(scopeId)
    if (!contents || contents.isDestroyed()) return 'stale-target'
    const authorization = this.selectionAuthorizations.get(contents)
    this.selectionAuthorizations.delete(contents)
    if (expected && authorization !== expected) return 'stale-target'
    if (!authorization?.credentialIds.has(credentialId)) return 'stale-target'
    if (!this.isStillAuthorized(contents, authorization, scopeId)) return 'stale-target'
    const state = this.states.get(contents)!
    const credential = await this.deps.vault.readForFill(credentialId, state.origin)
    if (!credential) return 'failed'
    if (!this.isStillAuthorized(contents, authorization, scopeId)) return 'stale-target'
    this.pendingFills.get(contents)?.complete('stale-target')
    const requestId = generateId()
    return new Promise<CredentialFillStatus>((resolve) => {
      const complete = (status: CredentialFillStatus) => {
        if (this.pendingFills.get(contents)?.requestId !== requestId) return
        clearTimeout(timeout)
        this.pendingFills.delete(contents)
        if (status === 'filled') logger.info('Filled a user-selected saved credential')
        resolve(status)
      }
      const timeout = setTimeout(() => complete('failed'), FILL_TIMEOUT_MS)
      this.pendingFills.set(contents, { requestId, ...authorization, complete })
      try {
        contents.send('browser-credentials:fill', {
          requestId,
          targetId: authorization.targetId,
          origin: state.origin,
          username: credential.username,
          password: state.hasPasswordField ? credential.password : undefined,
        })
      } catch {
        complete('failed')
      }
    })
  }

  noteFillResult(contents: WebContents, result: CredentialFillResult): void {
    const pending = this.pendingFills.get(contents)
    if (!pending || pending.requestId !== result.requestId) return
    const authorized = this.isStillAuthorized(contents, pending)
    pending.complete(authorized ? result.status : 'stale-target')
  }

  async refreshAvailability(force = false): Promise<void> {
    if (this.disposed) return
    const contents = this.deps.getActiveContents()
    if (this.picker && this.picker.contents !== contents) this.dismissPicker()
    for (const [owner, pending] of this.pendingFills) {
      if (owner !== contents) pending.complete('stale-target')
    }
    const refresh = contents
      ? (this.availabilityRefreshes.get(contents) ?? 0) + 1
      : this.availabilityRefreshWithoutContents + 1
    if (contents) this.availabilityRefreshes.set(contents, refresh)
    else this.availabilityRefreshWithoutContents = refresh
    const available = await this.isFillAvailableFor(contents)
    if (this.disposed || this.deps.getActiveContents() !== contents) return
    if (
      (contents
        ? this.availabilityRefreshes.get(contents)
        : this.availabilityRefreshWithoutContents) !== refresh
    )
      return
    const previous = contents
      ? this.lastAvailability.get(contents)
      : this.lastAvailabilityWithoutContents
    if (!available && this.picker?.contents === contents) this.dismissPicker()
    if (!force && available === previous) return
    if (contents) this.lastAvailability.set(contents, available)
    else this.lastAvailabilityWithoutContents = available
    this.deps.onAvailabilityChanged(available, contents)
  }

  /** Real input in the active page opens or focuses the trusted account picker. */
  async requestPicker(contents: WebContents, action: 'open' | 'focus' | 'dismiss'): Promise<void> {
    if (this.deps.getActiveContents() !== contents) return
    if (action === 'dismiss') {
      this.dismissPicker()
      return
    }
    const state = this.states.get(contents)
    if (!state?.bounds) return
    const host = this.deps.pickerHost?.(contents, state.bounds)
    if (!host) return
    if (!this.picker || this.picker.targetId !== state.targetId)
      await this.openPicker(contents, host.window, host.anchor)
    if (action === 'focus') this.picker?.view.focus()
  }

  /** Older hosted clients retain a functional chooser during independent desktop/web rollouts. */
  async showChooser(
    window: BrowserWindow,
    anchor: { x: number; y: number },
    scopeId?: string
  ): Promise<boolean> {
    const contents = this.deps.getActiveContents(scopeId)
    if (!contents) return false
    const state = this.states.get(contents)
    const host = state?.bounds ? this.deps.pickerHost?.(contents, state.bounds) : null
    const bounds = window.getContentBounds()
    const opened = await this.openPicker(
      contents,
      host?.window ?? window,
      host?.anchor ?? { x: bounds.x + anchor.x, y: bounds.y + anchor.y, width: 1, height: 1 },
      scopeId
    )
    if (opened) this.picker?.view.focus()
    return opened
  }

  private async openPicker(
    contents: WebContents,
    window: BrowserWindow,
    anchor: CredentialFieldBounds,
    scopeId?: string
  ): Promise<boolean> {
    this.dismissPicker()
    const version = this.pickerVersion
    const matches = await this.listFillOptions(scopeId, version)
    if (
      version !== this.pickerVersion ||
      this.deps.getActiveContents(scopeId) !== contents ||
      contents.isDestroyed() ||
      window.isDestroyed()
    )
      return false
    const state = this.states.get(contents)
    const authorization = this.selectionAuthorizations.get(contents)
    if (
      !state?.targetId ||
      !authorization ||
      !this.isStillAuthorized(contents, authorization, scopeId)
    )
      return false
    if (!matches.length) return false
    const view = new CredentialPicker({
      parent: window,
      anchor,
      configuration: {
        origin: state.origin,
        accounts: matches.map(({ id, username }) => ({ id, username })),
      },
      select: (id) => this.fillSelected(id, scopeId, authorization),
      closed: () => {
        if (this.picker?.view === view) this.dismissPicker()
        if (this.selectionAuthorizations.get(contents) === authorization)
          this.selectionAuthorizations.delete(contents)
      },
    })
    this.picker = { view, contents, targetId: state.targetId }
    return true
  }

  dismissPicker(): void {
    this.pickerVersion++
    for (const pending of this.pendingFills.values()) {
      if (pending.pickerVersion !== undefined) pending.complete('stale-target')
    }
    const picker = this.picker
    this.picker = null
    picker?.view.close()
  }

  private isStillAuthorized(
    contents: WebContents,
    authorization: { generation: number; targetId: string; pickerVersion?: number },
    scopeId?: string
  ): boolean {
    if (
      this.disposed ||
      (authorization.pickerVersion !== undefined &&
        authorization.pickerVersion !== this.pickerVersion)
    )
      return false
    if (contents.isDestroyed() || this.deps.getActiveContents(scopeId) !== contents) return false
    if (scopeId && !this.deps.scopeOwnsContents(scopeId, contents)) return false
    const state = this.states.get(contents)
    return Boolean(
      state?.hasLoginForm &&
        state.targetId === authorization.targetId &&
        this.generationFor(contents) === authorization.generation &&
        state.generation === authorization.generation &&
        normalizeOrigin(contents.getURL()) === state.origin
    )
  }
}
