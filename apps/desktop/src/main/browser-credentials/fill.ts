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
 * The chooser is a native menu rather than renderer chrome. That is a security
 * property, not a styling choice: the selection happens in a surface the main
 * process owns and the page (and the Sim renderer) cannot synthesize, which is
 * the main-process-controlled confirmation the design calls for. It also means
 * no credential id has to cross the preload bridge at all.
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
  /** The tab the user is actually looking at. */
  getActiveContents: () => WebContents | null
  /** Push the fill affordance's visibility to the Sim renderer. */
  onAvailabilityChanged: (available: boolean) => void
}

export interface FormStateReport {
  origin: string
  hasLoginForm: boolean
  /** Absent from shells that predate identifier-first support; assumed true. */
  hasPasswordField?: boolean
}

export class FillCoordinator {
  private readonly states = new WeakMap<WebContents, FormState>()
  private readonly generations = new WeakMap<WebContents, number>()
  private lastAvailability = false

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
    const origin = normalizeOrigin(report.origin)
    if (origin === null) {
      this.states.delete(contents)
    } else {
      this.states.set(contents, {
        origin,
        hasLoginForm: report.hasLoginForm,
        hasPasswordField: report.hasPasswordField ?? true,
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
  noteNavigation(contents: WebContents): void {
    this.generations.set(contents, this.generationFor(contents) + 1)
    this.states.delete(contents)
    void this.refreshAvailability()
  }

  forget(contents: WebContents): void {
    this.states.delete(contents)
    this.generations.delete(contents)
    void this.refreshAvailability()
  }

  /** Whether the active tab has a login form with at least one saved match. */
  async isFillAvailable(): Promise<boolean> {
    const contents = this.deps.getActiveContents()
    if (!contents || contents.isDestroyed()) return false
    const state = this.states.get(contents)
    if (!state?.hasLoginForm) return false
    if (!this.deps.vault.isAvailable()) return false
    return (await this.deps.vault.listForOrigin(state.origin)).length > 0
  }

  async refreshAvailability(): Promise<void> {
    const available = await this.isFillAvailable()
    if (available === this.lastAvailability) return
    this.lastAvailability = available
    this.deps.onAvailabilityChanged(available)
  }

  /**
   * Shows the native account chooser near a point in the window.
   *
   * Only usernames are listed; no password is read until the user picks one.
   * The navigation generation is captured here and carried into the fill, so a
   * page that moves while the menu is open invalidates the choice.
   */
  async showChooser(window: BrowserWindow, anchor: { x: number; y: number }): Promise<boolean> {
    const contents = this.deps.getActiveContents()
    if (!contents || contents.isDestroyed()) return false
    const state = this.states.get(contents)
    if (!state?.hasLoginForm) return false

    const matches = await this.deps.vault.listForOrigin(state.origin)
    if (matches.length === 0) return false

    const authorizedGeneration = state.generation
    const menu = Menu.buildFromTemplate(
      matches.map((credential) => ({
        label: credential.username || '(no username)',
        click: () => {
          void this.fill(contents, credential.id, authorizedGeneration).catch(() => {})
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
    authorizedGeneration: number
  ): Promise<void> {
    if (!this.isStillAuthorized(contents, authorizedGeneration)) return
    const state = this.states.get(contents)
    if (!state) return

    // The origin the preload reported must still be the document's real
    // origin. This is the check that stops a fill following a page that
    // navigated to another site.
    if (normalizeOrigin(contents.getURL()) !== state.origin) return

    const credential = await this.deps.vault.readForFill(credentialId, state.origin)
    if (credential === null) return

    if (!this.isStillAuthorized(contents, authorizedGeneration)) return
    if (normalizeOrigin(contents.getURL()) !== state.origin) return

    contents.send('browser-credentials:fill', {
      origin: state.origin,
      username: credential.username,
      // Withheld on an identifier-first step: the page has no password field,
      // so sending it would put plaintext in a document that cannot use it.
      password: state.hasPasswordField ? credential.password : undefined,
    })
    // Counts and outcomes only — never the origin, username, or password.
    logger.info('Filled a saved credential at the user\u2019s request')
  }

  private isStillAuthorized(contents: WebContents, authorizedGeneration: number): boolean {
    if (contents.isDestroyed()) return false
    // A fill must land in the tab the user is looking at. Switching tabs
    // between choosing and filling cancels it.
    if (this.deps.getActiveContents() !== contents) return false
    if (this.generationFor(contents) !== authorizedGeneration) return false
    return this.states.get(contents)?.generation === authorizedGeneration
  }
}
