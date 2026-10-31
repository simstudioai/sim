/**
 * Sign-in and app-launch decisions a browser tab's page waits on: HTTP
 * authentication, passkey account choice, client certificates, and links to
 * other apps. Sim's renderer shows each one for the exact tab that asked; only
 * a user-activated renderer response answers it, and every request is refused
 * when the renderer cannot show it, does not answer in time, or the page moves
 * on to another document.
 */
import type {
  BrowserAppLaunchNotice,
  BrowserPagePrompt,
  BrowserPagePromptResponse,
  BrowserPanelAction,
} from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import type {
  AuthenticationResponseDetails,
  AuthInfo,
  Certificate,
  Session,
  WebAuthnAccount,
  WebContents,
  WebFrameMain,
} from 'electron'
import { app, webContents as electronWebContents } from 'electron'
import { isAgentWebContents } from '@/main/browser-agent/registry'
import { appLinkTarget, openExternalSafe, parseHttpUrl } from '@/main/navigation'

const logger = createLogger('BrowserPagePrompts')

/** Long enough to type a password; a request never waits on a renderer beyond it. */
const PAGE_PROMPT_TIMEOUT_MS = 120_000
const APP_LAUNCH_NOTICE_TIMEOUT_MS = 60_000
/** Prompts per tab and origin per window, across reloads as well as rejected attempts. */
const MAX_HTTP_AUTH_PROMPTS = 3
const HTTP_AUTH_PROMPT_WINDOW_MS = 60_000
const MAX_CREDENTIAL_LENGTH = 1_024
const MAX_DISPLAY_TEXT_LENGTH = 120
const MAX_PROMPT_CHOICES = 50
const LAUNCH_RATE_WINDOW_MS = 20_000
const MAX_LAUNCHES_PER_WINDOW = 2
const MAX_REMEMBERED_DECISIONS = 200
/** Controls and bidi overrides that let untrusted text break or reorder a line. */
const UNTRUSTED_TEXT_CONTROLS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g

interface PageTabContext {
  scopeId: string
  /** The chat's renderer declared that it shows page prompts. */
  promptsEnabled: boolean
  /** The visible page of the visible chat. */
  onScreen: boolean
  /** The user's real click or keypress reached this document moments ago, after any agent input. */
  userActivated: boolean
  /** The agent's input is being delivered, or was the latest input in this tab. */
  agentActedLast: boolean
  /** The agent drives this tab and the user has not claimed it. */
  agentDrives: boolean
}

/** The session's side of a tab; injected to keep the dependency one-way. */
interface PagePromptHost {
  tabContext(contents: WebContents): PageTabContext | null
  publish(contents: WebContents): void
  focus(contents: WebContents): void
  noticeForAgent(contents: WebContents, notice: string): void
}

type RequestKind = BrowserPagePrompt['kind'] | 'app-launch-notice'
/** `null` is a cancellation: timeout, navigation, or an answer the user could not have given. */
type RequestAnswer = (response: BrowserPagePromptResponse | null) => void
type WithoutRequestId<View> = View extends unknown ? Omit<View, 'requestId'> : never

interface PendingRequest {
  id: string
  contents: WebContents
  kind: RequestKind
  view: BrowserPagePrompt | BrowserAppLaunchNotice
  key: string
  answers: RequestAnswer[]
  timer: ReturnType<typeof setTimeout>
}

interface TabRequests {
  prompt?: PendingRequest
  notice?: PendingRequest
}

let host: PagePromptHost | null = null
const pendingById = new Map<string, PendingRequest>()
const pendingByContents = new WeakMap<WebContents, TabRequests>()
const mainFrameNavigations = new WeakMap<WebContents, string>()
const recentAttemptsByContents = new WeakMap<WebContents, Map<string, number[]>>()
/** `null` remembers an explicit "no certificate" for that host. */
let certificateDecisions = new WeakMap<Session, Map<string, string | null>>()
const alwaysAllowedLaunches = new Map<string, true>()

export function setPagePromptHost(next: PagePromptHost | null): void {
  host = next
  if (next) return
  for (const entry of [...pendingById.values()]) settle(entry, null)
}

/** Forgets remembered certificate and app-launch choices, as a sign-out or data wipe must. */
export function resetPagePromptDecisions(): void {
  certificateDecisions = new WeakMap()
  alwaysAllowedLaunches.clear()
}

function withinWindow(at: number, windowMs: number): boolean {
  const elapsed = Date.now() - at
  return elapsed >= 0 && elapsed < windowMs
}

function rememberBounded<Value>(map: Map<string, Value>, key: string, value: Value): void {
  map.delete(key)
  map.set(key, value)
  while (map.size > MAX_REMEMBERED_DECISIONS) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

/** The live list of this tab's recent attempts under `key`, pruned to the window. */
function recentAttempts(contents: WebContents, key: string, windowMs: number): number[] {
  const byKey = recentAttemptsByContents.get(contents) ?? new Map<string, number[]>()
  recentAttemptsByContents.set(contents, byKey)
  const recent = (byKey.get(key) ?? []).filter((at) => withinWindow(at, windowMs))
  rememberBounded(byKey, key, recent)
  return recent
}

/** Untrusted page or server text, reduced to one bounded display line. */
function displayText(value: unknown, maxLength = MAX_DISPLAY_TEXT_LENGTH): string {
  if (typeof value !== 'string') return ''
  return truncate(
    value.replace(UNTRUSTED_TEXT_CONTROLS, ' ').replace(/\s+/g, ' ').trim(),
    maxLength
  )
}

/** Distinct, bounded choices keyed by a non-empty string id. */
function uniqueChoices<Item, Choice>(
  items: readonly Item[],
  idOf: (item: Item) => unknown,
  toChoice: (id: string, item: Item) => Choice
): Choice[] {
  const seen = new Set<string>()
  const choices: Choice[] = []
  for (const item of items) {
    const id = idOf(item)
    if (typeof id !== 'string' || !id || id.length > MAX_CREDENTIAL_LENGTH || seen.has(id)) continue
    seen.add(id)
    choices.push(toChoice(id, item))
    if (choices.length >= MAX_PROMPT_CHOICES) break
  }
  return choices
}

/**
 * Answers Electron exactly once. `ask` returns true once it owns the answer;
 * otherwise, and on any error, the request is refused.
 */
function withPrompt<Args extends unknown[]>(
  label: string,
  callback: (...args: Args | []) => void,
  ask: (answer: (...args: Args | []) => void) => boolean
): void {
  let answered = false
  const answer = (...args: Args | []) => {
    if (answered) return
    answered = true
    try {
      callback(...args)
    } catch (error) {
      logger.warn(`Could not answer ${label}`, { error: getErrorMessage(error) })
    }
  }
  let owned = false
  try {
    owned = ask(answer)
  } catch (error) {
    logger.warn(`Could not ask about ${label}`, { error: getErrorMessage(error) })
  } finally {
    if (!owned) answer()
  }
}

/**
 * Holds a request for the user. A tab shows one prompt and one notice at a
 * time: a new notice replaces the old one, and a prompt only joins an identical
 * pending challenge when `joinable`. False when it cannot be shown.
 */
function hold(
  contents: WebContents,
  kind: RequestKind,
  view: WithoutRequestId<BrowserPagePrompt> | WithoutRequestId<BrowserAppLaunchNotice>,
  key: string,
  answer: RequestAnswer,
  { joinable = false, focus = false }: { joinable?: boolean; focus?: boolean } = {}
): 'held' | 'joined' | false {
  if (!host || contents.isDestroyed() || !host.tabContext(contents)?.promptsEnabled) return false
  const requests = pendingByContents.get(contents) ?? {}
  pendingByContents.set(contents, requests)
  const slot = kind === 'app-launch-notice' ? 'notice' : 'prompt'
  const existing = requests[slot]
  if (existing && slot === 'prompt') {
    if (!joinable || existing.key !== key) return false
    existing.answers.push(answer)
    return 'joined'
  }
  if (existing) settle(existing, null)
  const id = generateId()
  const entry: PendingRequest = {
    id,
    contents,
    kind,
    view: { ...view, requestId: id } as BrowserPagePrompt | BrowserAppLaunchNotice,
    key,
    answers: [answer],
    timer: setTimeout(
      () => settle(entry, null),
      slot === 'notice' ? APP_LAUNCH_NOTICE_TIMEOUT_MS : PAGE_PROMPT_TIMEOUT_MS
    ),
  }
  pendingById.set(id, entry)
  requests[slot] = entry
  host.publish(contents)
  if (focus) host.focus(contents)
  return 'held'
}

function settle(entry: PendingRequest, response: BrowserPagePromptResponse | null): void {
  if (pendingById.get(entry.id) !== entry) return
  pendingById.delete(entry.id)
  const requests = pendingByContents.get(entry.contents)
  if (requests?.prompt === entry) requests.prompt = undefined
  if (requests?.notice === entry) requests.notice = undefined
  clearTimeout(entry.timer)
  if (!entry.contents.isDestroyed()) host?.publish(entry.contents)
  for (const answer of entry.answers) {
    try {
      answer(response)
    } catch (error) {
      logger.warn('Browser page prompt answer failed', { error: getErrorMessage(error) })
    }
  }
}

/** The decision this tab's page waits on, for its page state. */
export function pagePromptForContents(contents: WebContents): BrowserPagePrompt | undefined {
  return pendingByContents.get(contents)?.prompt?.view as BrowserPagePrompt | undefined
}

export function appLaunchNoticeForContents(
  contents: WebContents
): BrowserAppLaunchNotice | undefined {
  return pendingByContents.get(contents)?.notice?.view as BrowserAppLaunchNotice | undefined
}

/** Refuses what the previous document asked for: the tab moved on, crashed, or closed. */
export function cancelPagePrompts(contents: WebContents): void {
  const requests = pendingByContents.get(contents)
  if (requests?.prompt) settle(requests.prompt, null)
  if (requests?.notice) settle(requests.notice, null)
}

/**
 * Tracks the URL the tab's top-level navigation is requesting (null once it
 * commits or fails), so HTTP authentication can tell its own challenge from a
 * frame's.
 */
export function noteMainFrameNavigation(contents: WebContents, url: string | null): void {
  if (url) mainFrameNavigations.set(contents, url)
  else mainFrameNavigations.delete(contents)
}

/** The renderer's answer for chat `scopeId`; only an on-screen answer of the request's own kind accepts. */
export function respondToPagePrompt(scopeId: string, action: BrowserPanelAction): void {
  const entry = typeof action.requestId === 'string' ? pendingById.get(action.requestId) : undefined
  if (!entry || entry.contents.isDestroyed()) return
  const context = host?.tabContext(entry.contents)
  if (!context || context.scopeId !== scopeId) return
  const { response } = action
  if (response?.allowed === false) {
    settle(entry, response)
    return
  }
  const accepted = response?.allowed === true && response.kind === entry.kind && context.onScreen
  settle(entry, accepted ? response : null)
}

/**
 * A challenge worth asking the user about, or null to cancel it: only the
 * tab's own top-level navigation, challenged by the host and port it
 * requested, or a proxy. Frames, subresources, and cross-origin challenges
 * never get a prompt.
 */
export function httpAuthChallenge(
  details: Pick<AuthenticationResponseDetails, 'url' | 'isRequestForNavigation'>,
  authInfo: Pick<AuthInfo, 'isProxy' | 'host' | 'port'>,
  mainFrameUrl: string | undefined
): { origin: string; proxy: boolean; insecure: boolean } | null {
  const challengedHost = authInfo.host.toLowerCase().replace(/^\[|\]$/g, '')
  if (!challengedHost || !Number.isInteger(authInfo.port) || authInfo.port <= 0) return null
  if (authInfo.isProxy) {
    const hostLabel = challengedHost.includes(':') ? `[${challengedHost}]` : challengedHost
    return { origin: `${hostLabel}:${authInfo.port}`, proxy: true, insecure: false }
  }
  if (!details.isRequestForNavigation || details.url !== mainFrameUrl) return null
  const url = parseHttpUrl(details.url)
  if (!url) return null
  const requestedPort = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  const requestedHost = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (requestedHost !== challengedHost || requestedPort !== authInfo.port) return null
  return { origin: url.origin, proxy: false, insecure: url.protocol === 'http:' }
}

/**
 * `app.on('login')` for agent browser tabs. Other contents keep Electron's
 * default, which cancels: the main window's proxy prompt needs a shell form.
 * The prompt never takes focus, since a page can trigger it on its own.
 */
export function handleBrowserLogin(
  event: { preventDefault(): void },
  contents: WebContents | null,
  details: AuthenticationResponseDetails,
  authInfo: AuthInfo,
  callback: (username?: string, password?: string) => void
): void {
  if (!contents || contents.isDestroyed() || !isAgentWebContents(contents)) return
  event.preventDefault()
  withPrompt('HTTP sign-in', callback, (answer) => {
    const challenge = httpAuthChallenge(details, authInfo, mainFrameNavigations.get(contents))
    if (!challenge) return false
    const prompts = recentAttempts(
      contents,
      `http-auth|${challenge.origin}`,
      HTTP_AUTH_PROMPT_WINDOW_MS
    )
    if (prompts.length >= MAX_HTTP_AUTH_PROMPTS) return false
    const held = hold(
      contents,
      'http-auth',
      { kind: 'http-auth', ...challenge, retry: !details.firstAuthAttempt },
      `http-auth|${challenge.proxy}|${challenge.origin}|${authInfo.scheme}`,
      (response) => {
        if (
          response?.allowed === true &&
          response.kind === 'http-auth' &&
          response.username.length <= MAX_CREDENTIAL_LENGTH &&
          response.password.length <= MAX_CREDENTIAL_LENGTH
        ) {
          answer(response.username, response.password)
        } else {
          answer()
        }
      },
      { joinable: true }
    )
    if (held === 'held') {
      prompts.push(Date.now())
      if (host?.tabContext(contents)?.agentDrives) {
        host.noticeForAgent(
          contents,
          `${challenge.origin} asked for a username and password. The user was asked to sign in in the browser panel; wait for them instead of retrying or entering credentials.`
        )
      }
    }
    return Boolean(held)
  })
}

/**
 * `select-webauthn-account` for every session a browser tab uses, the borrowed
 * app session included. Without a listener Electron cancels every discoverable
 * passkey sign-in; requests from any non-browser contents still cancel. The
 * prompt never takes focus: a page can ask without the user's involvement.
 */
export function handleSelectPasskeyAccount(
  _event: unknown,
  details: { relyingPartyId: string; accounts: WebAuthnAccount[]; frame: WebFrameMain | null },
  callback: (credentialId?: string | null) => void
): void {
  withPrompt('a passkey account choice', callback, (answer) => {
    const contents = details.frame ? electronWebContents.fromFrame(details.frame) : undefined
    if (!contents || contents.isDestroyed() || !isAgentWebContents(contents)) return false
    const relyingPartyId = displayText(details.relyingPartyId, 253)
    const accounts = uniqueChoices(
      details.accounts ?? [],
      (account) => account?.credentialId,
      (id, account) => ({
        id,
        name: displayText(account.name),
        displayName: displayText(account.displayName),
      })
    )
    if (accounts.length === 0 || !relyingPartyId) return false
    const held = hold(
      contents,
      'passkey-account',
      { kind: 'passkey-account', relyingPartyId, accounts },
      `passkey|${relyingPartyId}|${accounts.map((account) => account.id).join(',')}`,
      (response) => {
        const chosen =
          response?.allowed === true && response.kind === 'passkey-account'
            ? accounts.find((account) => account.id === response.choiceId)
            : undefined
        if (chosen) answer(chosen.id)
        else answer()
      },
      { joinable: true }
    )
    return Boolean(held)
  })
}

/**
 * `app.on('select-client-certificate')` for agent browser tabs. Electron's
 * default sends the first certificate to any site that asks; a browser tab
 * sends one only after the user picks it, and the prompt never takes focus,
 * since a subresource can ask. The main window keeps the default.
 */
export function handleSelectClientCertificate(
  event: { preventDefault(): void },
  contents: WebContents | null,
  url: string,
  certificates: Certificate[],
  callback: (certificate?: Certificate) => void
): void {
  if (!contents || contents.isDestroyed() || !isAgentWebContents(contents)) return
  event.preventDefault()
  withPrompt('a client certificate choice', callback, (answer) => {
    const requestUrl = parseHttpUrl(url)
    const requestHost = requestUrl?.protocol === 'https:' ? requestUrl.host.toLowerCase() : null
    const choices = uniqueChoices(
      certificates,
      (certificate) => certificate?.fingerprint,
      (id, certificate) => ({
        id,
        subject: displayText(certificate.subjectName || certificate.subject?.commonName),
        issuer: displayText(certificate.issuerName || certificate.issuer?.commonName),
        expiresAt: Number.isFinite(certificate.validExpiry) ? certificate.validExpiry * 1000 : 0,
      })
    )
    if (!requestHost || choices.length === 0) return false
    const decisions = certificateDecisions.get(contents.session) ?? new Map<string, string | null>()
    certificateDecisions.set(contents.session, decisions)
    const remembered = decisions.get(requestHost)
    if (remembered === null) return false
    const rememberedCertificate = certificates.find(
      (certificate) => certificate.fingerprint === remembered
    )
    if (rememberedCertificate) {
      answer(rememberedCertificate)
      return true
    }
    const held = hold(
      contents,
      'client-certificate',
      { kind: 'client-certificate', host: requestHost, certificates: choices },
      `client-certificate|${requestHost}`,
      (response) => {
        if (response?.allowed === false) {
          rememberBounded(decisions, requestHost, null)
          answer()
          return
        }
        const certificate =
          response?.allowed === true && response.kind === 'client-certificate'
            ? certificates.find((candidate) => candidate.fingerprint === response.choiceId)
            : undefined
        if (!certificate) {
          answer()
          return
        }
        rememberBounded(decisions, requestHost, certificate.fingerprint)
        answer(certificate)
      },
      { joinable: true }
    )
    return Boolean(held)
  })
}

/** The tab's own top-level document asked, not a frame inside it. */
function isTopDocument(
  contents: WebContents,
  frame: WebFrameMain | null | undefined,
  origin: string
): boolean {
  try {
    return Boolean(
      frame &&
        frame.parent === null &&
        frame.frameTreeNodeId === contents.mainFrame.frameTreeNodeId &&
        frame.origin === origin
    )
  } catch {
    return false
  }
}

function launchAppLink(url: string): void {
  void openExternalSafe(url, false, { appLink: true })
}

/**
 * A browser tab's navigation to a non-web URL, with the frame that initiated
 * it. Agent input never launches anything, and neither do frames; `window.open`
 * never reaches here, since it names no initiating frame. The top document's
 * request right after the user's own click asks them to confirm the app (mail
 * links open directly); one without that click only gets a passive notice the
 * user can act on. Nothing launches without a renderer that shows prompts, and
 * a pending launch prompt refuses further requests.
 */
export function requestExternalLaunch(
  contents: WebContents,
  rawUrl: string,
  initiator: WebFrameMain | null | undefined
): void {
  if (!host || contents.isDestroyed() || !isAgentWebContents(contents)) return
  const target = appLinkTarget(rawUrl)
  if (!target) {
    logger.warn('Denied external app link in agent browser', {
      scheme: displayText(rawUrl.split(':', 1)[0], 32),
    })
    return
  }
  let appName = ''
  try {
    appName = displayText(app.getApplicationNameForProtocol(target.url), 80)
  } catch {}
  const context = host.tabContext(contents)
  if (!appName || !context?.promptsEnabled) return
  if (context.agentActedLast) {
    host.noticeForAgent(
      contents,
      `The page tried to open ${appName}. Links to other apps never open from agent actions; ask the user to open it themselves if the task needs it.`
    )
    return
  }
  const origin = parseHttpUrl(contents.getURL())?.origin
  if (!origin) return
  if (!isTopDocument(contents, initiator, origin)) {
    logger.warn('Denied an app link from a frame in agent browser', { scheme: target.scheme })
    return
  }
  const attempts = recentAttempts(contents, 'app-launch', LAUNCH_RATE_WINDOW_MS)
  if (attempts.length >= MAX_LAUNCHES_PER_WINDOW) return
  const launchKey = `${origin}|${target.scheme}`
  if (context.userActivated && !context.agentDrives) {
    if (target.scheme === 'mailto' || alwaysAllowedLaunches.has(launchKey)) {
      attempts.push(Date.now())
      launchAppLink(target.url)
      return
    }
    const canAlwaysAllow = origin.startsWith('https:')
    const held = hold(
      contents,
      'external-app',
      { kind: 'external-app', origin, appName, canAlwaysAllow },
      `external-app|${launchKey}`,
      (response) => {
        if (response?.allowed !== true || response.kind !== 'external-app') return
        if (response.alwaysAllow && canAlwaysAllow) {
          rememberBounded(alwaysAllowedLaunches, launchKey, true)
        }
        launchAppLink(target.url)
      },
      // The prompt answers the user's own click in the page, so it takes the focus that click had.
      { focus: true }
    )
    if (held) attempts.push(Date.now())
    return
  }
  const held = hold(
    contents,
    'app-launch-notice',
    { origin, appName },
    `app-launch-notice|${launchKey}`,
    (response) => {
      if (response?.allowed === true && response.kind === 'app-launch-notice') {
        launchAppLink(target.url)
      }
    }
  )
  if (!held) return
  attempts.push(Date.now())
  if (context.agentDrives) {
    host.noticeForAgent(
      contents,
      `The page offered to open ${appName}. Only the user can open it, from the notice in the browser panel.`
    )
  }
}
