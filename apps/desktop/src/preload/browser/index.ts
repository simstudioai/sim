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
const RESCAN_DEBOUNCE_MS = 250

interface DetectedForm {
  username: HTMLInputElement | null
  password: HTMLInputElement
}

/** Held only in this isolated world; never serialized to main or the page. */
let detected: DetectedForm | null = null
let lastReported = ''
let rescanTimer: ReturnType<typeof setTimeout> | null = null

function isFillable(field: HTMLInputElement): boolean {
  if (field.disabled || field.readOnly) return false
  const rect = field.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/**
 * Matches the same definition the agent guards use: a reveal toggle flips a
 * password field to `type="text"` without making it any less secret, and the
 * autocomplete token is the page's own declaration either way.
 */
function isPasswordField(field: HTMLInputElement): boolean {
  if (String(field.type || '').toLowerCase() === 'password') return true
  const hint = String(field.getAttribute('autocomplete') || '').toLowerCase()
  return hint === 'current-password' || hint === 'new-password'
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

function reportFormState(): void {
  const password = findPasswordField()
  detected = password ? { password, username: findUsernameField(password) } : null

  const origin = window.location.origin
  const fingerprint = `${origin}|${detected !== null}`
  if (fingerprint === lastReported) return
  lastReported = fingerprint
  ipcRenderer.send(FORM_STATE_CHANNEL, { origin, hasLoginForm: detected !== null })
}

function scheduleRescan(): void {
  if (rescanTimer !== null) clearTimeout(rescanTimer)
  rescanTimer = setTimeout(() => {
    rescanTimer = null
    reportFormState()
  }, RESCAN_DEBOUNCE_MS)
}

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
  (_event, payload: { origin: string; username: string; password: string }) => {
    // Last line of defence against a navigation between the user's choice and
    // this message arriving: the main process binds the fill to an origin, and
    // the live document has to still agree.
    if (!payload || payload.origin !== window.location.origin || !detected) return
    if (detected.username && payload.username) {
      setFieldValue(detected.username, payload.username)
    }
    setFieldValue(detected.password, payload.password)
    // Never submitted. Autofill and submission stay separate so the user can
    // confirm the site and the account before anything is sent.
    detected.password.focus()
  }
)

document.addEventListener('DOMContentLoaded', reportFormState)
window.addEventListener('load', reportFormState)
window.addEventListener('pageshow', reportFormState)

// Login forms are routinely rendered after first paint, behind a "Sign in"
// toggle, or swapped in by a single-page router — a one-shot scan would miss
// most of them.
new MutationObserver(scheduleRescan).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['type', 'autocomplete', 'disabled', 'readonly'],
})
