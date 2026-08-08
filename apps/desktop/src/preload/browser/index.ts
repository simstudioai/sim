import { ipcRenderer } from 'electron'

/**
 * The preload for pages inside the built-in browser.
 *
 * It exists for exactly one job: notice that the page has a login form, tell
 * the main process only that fact, and — when the main process says the user
 * chose an account — put the credential into the two fields it already found.
 *
 * It deliberately exposes nothing. There is no `contextBridge` call here, so
 * the page cannot see or call any of this, and the fill can only be initiated
 * by the main process. What travels out is a page origin and two booleans;
 * field names, values, and page content never do.
 *
 * Runs in the top-level frame only (subframe preloads are not enabled), so
 * cross-origin iframe login flows are out of scope for now — filling those
 * needs its own threat review.
 */

const FORM_STATE_CHANNEL = 'browser-credentials:form-state'
const FILL_CHANNEL = 'browser-credentials:fill'
const RESCAN_CHANNEL = 'browser-credentials:rescan'
const RESCAN_DEBOUNCE_MS = 250
const INITIAL_RESCAN_DELAYS_MS = [250, 750, 1_500, 3_000] as const

interface DetectedForm {
  username: HTMLInputElement | null
  /** Absent on an identifier-first step, which asks for the email alone. */
  password: HTMLInputElement | null
}

/** Held only in this isolated world; never serialized to main or the page. */
let detected: DetectedForm | null = null
let lastReported = ''
let rescanTimer: ReturnType<typeof setTimeout> | null = null
let formObserver: MutationObserver | null = null
let initialRescansScheduled = false

function isFillable(field: HTMLInputElement): boolean {
  if (field.disabled || field.readOnly) return false
  const rect = field.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/**
 * The field's `autocomplete` tokens.
 *
 * Token membership, not whole-string equality: the spec allows space-separated
 * detail tokens and WebAuthn recommends `current-password webauthn`. Equality
 * here while the agent guards split tokens would leave fill blind to exactly
 * the fields they protect.
 */
function autocompleteTokens(field: HTMLInputElement): string[] {
  return String(field.getAttribute('autocomplete') || '')
    .toLowerCase()
    .split(/\s+/)
}

/**
 * Matches the same definition the agent guards use: a reveal toggle flips a
 * password field to `type="text"` without making it any less secret, and the
 * autocomplete token is the page's own declaration either way.
 */
function isPasswordField(field: HTMLInputElement): boolean {
  if (String(field.type || '').toLowerCase() === 'password') return true
  const tokens = autocompleteTokens(field)
  return tokens.includes('current-password') || tokens.includes('new-password')
}

function findPasswordField(): HTMLInputElement | null {
  for (const field of document.querySelectorAll('input')) {
    if (isPasswordField(field) && isFillable(field)) return field
  }
  return null
}

/**
 * The username field for a password field: the nearest preceding text-like
 * input in the same form, which is how essentially every login form is built.
 */
function findUsernameField(password: HTMLInputElement): HTMLInputElement | null {
  const scope: ParentNode = password.form ?? document
  const candidates: HTMLInputElement[] = []
  for (const field of scope.querySelectorAll('input')) {
    const type = String(field.type || 'text').toLowerCase()
    if (['text', 'email', 'tel', 'username'].includes(type) && isFillable(field)) {
      candidates.push(field)
    }
  }
  const preceding = candidates.filter(
    (field) => (password.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
  )
  return preceding.at(-1) ?? candidates[0] ?? null
}

/**
 * The identifier field of a sign-in step that has no password field yet.
 *
 * Two-step sign-in — email, Continue, then the password on the next screen —
 * is now the norm at Google, Okta, and most workplace tools. Requiring a
 * password field would mean the key icon never appears on the step where the
 * user actually needs it. Only the page's own declaration counts here: an
 * `autocomplete` token naming a username or email, or an email input. That is
 * narrow enough to leave newsletter boxes and search fields alone.
 */
function findIdentifierField(): HTMLInputElement | null {
  for (const field of document.querySelectorAll('input')) {
    if (!isFillable(field)) continue
    const tokens = autocompleteTokens(field)
    if (tokens.includes('username') || tokens.includes('email')) return field
    if (String(field.type || '').toLowerCase() === 'email') return field
  }
  return null
}

function detectForm(): DetectedForm | null {
  const password = findPasswordField()
  if (password) return { password, username: findUsernameField(password) }
  const username = findIdentifierField()
  return username ? { password: null, username } : null
}

function reportFormState(): void {
  detected = detectForm()

  const origin = window.location.origin
  const hasPasswordField = detected?.password != null
  const fingerprint = `${origin}|${detected !== null}|${hasPasswordField}`
  if (fingerprint === lastReported) return
  lastReported = fingerprint
  ipcRenderer.send(FORM_STATE_CHANNEL, {
    origin,
    hasLoginForm: detected !== null,
    hasPasswordField,
  })
}

function scheduleRescan(): void {
  // Coalesce a mutation burst without letting an animated page postpone the
  // scan forever by continually resetting a trailing-edge debounce.
  if (rescanTimer !== null) return
  rescanTimer = setTimeout(() => {
    rescanTimer = null
    reportFormState()
  }, RESCAN_DEBOUNCE_MS)
}

function observeDocument(): void {
  if (formObserver || !document.documentElement) return
  formObserver = new MutationObserver(scheduleRescan)
  formObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    // Login steps often exist at first paint and become usable only after a
    // framework flips an ancestor's visibility class/style.
    attributeFilter: [
      'type',
      'autocomplete',
      'disabled',
      'readonly',
      'class',
      'style',
      'hidden',
      'aria-hidden',
    ],
  })
}

function reportInitialFormState(): void {
  observeDocument()
  reportFormState()
  if (initialRescansScheduled) return
  initialRescansScheduled = true
  // Stylesheets, hydration, and password-step transitions can settle without
  // a useful child mutation. A short bounded tail covers that first-load
  // window without leaving a permanent poller behind.
  for (const delay of INITIAL_RESCAN_DELAYS_MS) {
    setTimeout(reportFormState, delay)
  }
}

ipcRenderer.on(RESCAN_CHANNEL, () => {
  // Same-document navigation does not recreate this preload. Main invalidates
  // its old form state for safety, so bypass the unchanged fingerprint once
  // and republish the live form after the SPA route has committed.
  lastReported = ''
  scheduleRescan()
})

/**
 * Writes through the native value setter so frameworks that track their own
 * input state (React and friends) see the change instead of reverting it on
 * the next render.
 */
function setFieldValue(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter) {
    setter.call(field, value)
  } else {
    field.value = value
  }
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.dispatchEvent(new Event('change', { bubbles: true }))
}

ipcRenderer.on(
  FILL_CHANNEL,
  (_event, payload: { origin: string; username: string; password?: string }) => {
    // Last line of defence against a navigation between the user's choice and
    // this message arriving: the main process binds the fill to an origin, and
    // the live document has to still agree.
    if (!payload || payload.origin !== window.location.origin || !detected) return
    if (detected.username && payload.username) {
      setFieldValue(detected.username, payload.username)
    }
    if (detected.password && payload.password) {
      setFieldValue(detected.password, payload.password)
    }
    // Never submitted. Autofill and submission stay separate so the user can
    // confirm the site and the account before anything is sent. Focus lands on
    // whichever field the user still has to deal with.
    ;(detected.password ?? detected.username)?.focus()
  }
)

// Electron preloads can run before `<html>` exists. Never pass that null root
// to MutationObserver: the exception would permanently disable dynamic-form
// detection for this document.
observeDocument()
document.addEventListener('readystatechange', observeDocument)
document.addEventListener('DOMContentLoaded', reportInitialFormState)
window.addEventListener('load', reportInitialFormState)
window.addEventListener('pageshow', reportInitialFormState)

// Login forms are routinely rendered after first paint, behind a "Sign in"
// toggle, or swapped in by a single-page router. The observer is installed by
// `observeDocument` as soon as a real document root exists.
