import type { BrowserCredentialMetadata } from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import type { BrowserWindow, WebContents } from 'electron'
import { Menu } from 'electron'
import { normalizeOrigin } from '@/main/browser-credentials/origin'
import type { CredentialVault } from '@/main/browser-credentials/vault'

const logger = createLogger('BrowserCredentialFill')

/**
 * Decides when a credential may be filled, and does the filling.
 *
 * The page can navigate at any point between "this page has a login form",
 * "the user opened the chooser", and "the user picked an account" — and a fill
 * aimed at the wrong document means a password handed to the wrong site. So
 * every authorization is bound to a specific tab and a specific navigation
 * generation, and that binding is revalidated immediately before plaintext
 * leaves the vault, not just when the chooser opened.
 *
 * Renderer-owned chrome receives only password-free metadata. The main
 * process keeps the corresponding one-shot authorization, and the password
 * travels only from the vault to the browser page after every binding is
 * revalidated.
 */

interface FormState {
  origin: string
  hasLoginForm: boolean
  /**
   * Whether the page currently has somewhere to put a password.
   *
   * False on the first step of an identifier-first sign-in, which asks for an
   * email and only reveals the password field after it is submitted. Those
   * steps are still worth filling — the username is what they want — so the
   * password simply is not sent to a page that has nowhere to put it.
   */
  hasPasswordField: boolean
  /** Bumped on every navigation, so a stale authorization cannot be replayed. */
  generation: number
}

export interface FillCoordinatorDeps {
  vault: CredentialVault
  /** The tab the user is actually looking at, optionally constrained to one chat scope. */
  getActiveContents: (scopeId?: string) => WebContents | null
  /** Whether a live tab belongs to the renderer-requested chat scope. */
  scopeOwnsContents: (scopeId: string, contents: WebContents) => boolean
  /** Push the fill affordance's visibility to the Sim renderer. */
  onAvailabilityChanged: (available: boolean, contents: WebContents | null) => void
}

export interface FormStateReport {
  origin: string
  hasLoginForm: boolean
  hasPasswordField: boolean
}

export class FillCoordinator {
  private readonly states = new WeakMap<WebContents, FormState>()
  private readonly generations = new WeakMap<WebContents, number>()
  private readonly selectionAuthorizations = new WeakMap<
    WebContents,
    { credentialIds: ReadonlySet<string>; generation: number }
  >()
  private readonly availabilityRefreshes = new WeakMap<WebContents, number>()
  private availabilityRefreshWithoutContents = 0
  private readonly lastAvailability = new WeakMap<WebContents, boolean>()
  private lastAvailabilityWithoutContents = false

  constructor(private readonly deps: FillCoordinatorDeps) {}

  private generationFor(contents: WebContents): number {
    return this.generations.get(contents) ?? 0
  }

  /**
   * Records what the browser preload observed. The report is trusted only as
   * far as it goes: it can claim a form exists, but the origin it names is
   * checked against the live URL before any fill.
   */
  noteFormState(contents: WebContents, report: FormStateReport): void {
    this.selectionAuthorizations.delete(contents)
    const origin = normalizeOrigin(report.origin)
    if (origin === null) {
      this.states.delete(contents)
    } else {
      this.states.set(contents, {
        origin,
        hasLoginForm: report.hasLoginForm,
        hasPasswordField: report.hasPasswordField,
        generation: this.generationFor(contents),
      })
    }
    void this.refreshAvailability()
  }

  /**
   * Invalidates everything known about a tab's page. Called on every
   * navigation, including in-page ones — a single-page app can swap a login
   * form for a different site's UI without a document load.
   */
  noteNavigation(contents: WebContents, sameDocument = false): void {
    this.generations.set(contents, this.generationFor(contents) + 1)
    this.states.delete(contents)
    this.selectionAuthorizations.delete(contents)
    // A same-document navigation keeps the preload and its report fingerprint
    // alive. Ask it to report again after clearing main-process state, or an
    // unchanged login form remains invisible until a full page reload.
    // Literal channel name: the IPC contract audit resolves constants only on
    // the preload side, so main-process sends must inline the channel.
    if (sameDocument && !contents.isDestroyed()) contents.send('browser-credentials:rescan')
    void this.refreshAvailability()
  }

  forget(contents: WebContents): void {
    this.states.delete(contents)
    this.generations.delete(contents)
    this.selectionAuthorizations.delete(contents)
    void this.refreshAvailability()
  }

  /** Whether one tab has a login form with at least one saved match. */
  private async isFillAvailableFor(contents: WebContents | null): Promise<boolean> {
    if (!contents || contents.isDestroyed()) return false
    const state = this.states.get(contents)
    if (!state?.hasLoginForm) return false
    if (!this.deps.vault.isAvailable()) return false
    return (await this.deps.vault.listForOrigin(state.origin)).length > 0
  }

  /** Whether the active tab can currently be filled. */
  isFillAvailable(): Promise<boolean> {
    return this.isFillAvailableFor(this.deps.getActiveContents())
  }

  /**
   * Lists only password-safe metadata matching the active scoped login form.
   *
   * The result also establishes a one-shot selection authorization bound to
   * the current tab and navigation generation. A renderer-owned menu can then
   * ask to fill one of these ids without letting a stale menu follow a
   * navigation into a replacement document.
   */
  async listFillOptions(scopeId?: string): Promise<BrowserCredentialMetadata[]> {
    const contents = this.deps.getActiveContents(scopeId)
    if (!contents || contents.isDestroyed()) return []
    if (scopeId && !this.deps.scopeOwnsContents(scopeId, contents)) return []

    const state = this.states.get(contents)
    if (!state?.hasLoginForm || !this.deps.vault.isAvailable()) return []
    const authorizedGeneration = state.generation
    if (!this.isStillAuthorized(contents, authorizedGeneration, scopeId)) return []
    if (normalizeOrigin(contents.getURL()) !== state.origin) return []

    const matches = await this.deps.vault.listForOrigin(state.origin)
    if (!this.isStillAuthorized(contents, authorizedGeneration, scopeId)) return []
    if (normalizeOrigin(contents.getURL()) !== state.origin) return []

    this.selectionAuthorizations.set(contents, {
      credentialIds: new Set(matches.map((credential) => credential.id)),
      generation: authorizedGeneration,
    })
    return matches
  }

  /** Fills one option from the latest scoped list without returning its password. */
  async fillCredential(credentialId: string, scopeId?: string): Promise<boolean> {
    const contents = this.deps.getActiveContents(scopeId)
    if (!contents || contents.isDestroyed()) return false
    if (scopeId && !this.deps.scopeOwnsContents(scopeId, contents)) return false

    const authorization = this.selectionAuthorizations.get(contents)
    this.selectionAuthorizations.delete(contents)
    if (!authorization?.credentialIds.has(credentialId)) return false

    return this.fill(contents, credentialId, authorization.generation, scopeId)
  }

  /**
   * Publishes the active tab's current state. Activation forces a replay so a
   * newly mounted chat receives its value even when the previous chat happened
   * to have the same boolean availability.
   */
  async refreshAvailability(force = false): Promise<void> {
    const contents = this.deps.getActiveContents()
    const refresh = contents
      ? (this.availabilityRefreshes.get(contents) ?? 0) + 1
      : this.availabilityRefreshWithoutContents + 1
    if (contents) {
      this.availabilityRefreshes.set(contents, refresh)
    } else {
      this.availabilityRefreshWithoutContents = refresh
    }
    const available = await this.isFillAvailableFor(contents)
    if (this.deps.getActiveContents() !== contents) return
    if (
      contents
        ? this.availabilityRefreshes.get(contents) !== refresh
        : this.availabilityRefreshWithoutContents !== refresh
    ) {
      return
    }
    const previous = contents
      ? this.lastAvailability.get(contents)
      : this.lastAvailabilityWithoutContents
    if (!force && available === previous) return
    if (contents) {
      this.lastAvailability.set(contents, available)
    } else {
      this.lastAvailabilityWithoutContents = available
    }
    this.deps.onAvailabilityChanged(available, contents)
  }

  /**
   * Shows the native account chooser near a point in the window.
   *
   * Only usernames are listed; no password is read until the user picks one.
   * The navigation generation is captured here and carried into the fill, so a
   * page that moves while the menu is open invalidates the choice.
   */
  async showChooser(
    window: BrowserWindow,
    anchor: { x: number; y: number },
    scopeId?: string
  ): Promise<boolean> {
    const contents = this.deps.getActiveContents(scopeId)
    if (!contents || contents.isDestroyed()) return false
    if (scopeId && !this.deps.scopeOwnsContents(scopeId, contents)) return false
    const state = this.states.get(contents)
    if (!state?.hasLoginForm) return false

    const matches = await this.deps.vault.listForOrigin(state.origin)
    if (matches.length === 0) return false

    const authorizedGeneration = state.generation
    const menu = Menu.buildFromTemplate(
      matches.map((credential) => ({
        label: credential.username || '(no username)',
        click: () => {
          void this.fill(contents, credential.id, authorizedGeneration, scopeId).catch(() => {})
        },
      }))
    )
    menu.popup({ window, x: Math.round(anchor.x), y: Math.round(anchor.y) })
    return true
  }

  /**
   * Performs one authorized fill.
   *
   * Every precondition is checked again here rather than trusted from when the
   * chooser opened, and once more after the vault read, because that read is
   * asynchronous and the page can navigate inside it.
   */
  private async fill(
    contents: WebContents,
    credentialId: string,
    authorizedGeneration: number,
    scopeId?: string
  ): Promise<boolean> {
    if (!this.isStillAuthorized(contents, authorizedGeneration, scopeId)) return false
    const state = this.states.get(contents)
    if (!state) return false

    // The origin the preload reported must still be the document's real
    // origin. This is the check that stops a fill following a page that
    // navigated to another site.
    if (normalizeOrigin(contents.getURL()) !== state.origin) return false

    const credential = await this.deps.vault.readForFill(credentialId, state.origin)
    if (credential === null) return false

    if (!this.isStillAuthorized(contents, authorizedGeneration, scopeId)) return false
    if (normalizeOrigin(contents.getURL()) !== state.origin) return false

    contents.send('browser-credentials:fill', {
      origin: state.origin,
      username: credential.username,
      // Withheld on an identifier-first step: the page has no password field,
      // so sending it would put plaintext in a document that cannot use it.
      password: state.hasPasswordField ? credential.password : undefined,
    })
    // Counts and outcomes only — never the origin, username, or password.
    logger.info('Filled a saved credential at the user\u2019s request')
    return true
  }

  private isStillAuthorized(
    contents: WebContents,
    authorizedGeneration: number,
    scopeId?: string
  ): boolean {
    if (contents.isDestroyed()) return false
    // A fill must land in the tab the user is looking at. Switching tabs
    // between choosing and filling cancels it.
    if (this.deps.getActiveContents(scopeId) !== contents) return false
    if (scopeId && !this.deps.scopeOwnsContents(scopeId, contents)) return false
    if (this.generationFor(contents) !== authorizedGeneration) return false
    return this.states.get(contents)?.generation === authorizedGeneration
  }
}
