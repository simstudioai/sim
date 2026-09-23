const MAX_NODES = 10_000
const MAX_FIELDS = 256

export interface LoginTarget {
  username: HTMLInputElement | null
  password: HTMLInputElement | null
}

function autocompleteTokens(field: HTMLInputElement): string[] {
  return (field.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/)
}

function parentElementAcrossRoots(element: Element): Element | null {
  const root = element.getRootNode()
  return element.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
}

export function isFillable(field: HTMLInputElement): boolean {
  if (!field.isConnected || field.matches(':disabled') || field.readOnly) return false
  const rect = field.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  for (let node: Element | null = field; node; node = parentElementAcrossRoots(node)) {
    if (node.hasAttribute('inert') || node.hasAttribute('hidden')) return false
    if (node.getAttribute('aria-hidden') === 'true') return false
    const style = getComputedStyle(node)
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false
    if (style.display === 'none' || style.opacity === '0') return false
  }
  return true
}

/** Bounds work on large pages and visits open shadow roots without modifying the page. */
export function collectLoginFields(): { fields: HTMLInputElement[]; roots: ParentNode[] } {
  const fields: HTMLInputElement[] = []
  const roots: ParentNode[] = [document]
  const pending: Element[] = document.documentElement ? [document.documentElement] : []
  let visited = 0
  while (pending.length && visited < MAX_NODES && fields.length < MAX_FIELDS) {
    const node = pending.pop()!
    visited++
    if (node instanceof HTMLInputElement) fields.push(node)
    const appendChildren = (parent: ParentNode) => {
      const remaining = MAX_NODES - visited - pending.length
      for (let index = Math.min(parent.children.length, remaining) - 1; index >= 0; index--) {
        pending.push(parent.children[index])
      }
    }
    appendChildren(node)
    if (node.shadowRoot) {
      roots.push(node.shadowRoot)
      appendChildren(node.shadowRoot)
    }
  }
  return { fields, roots }
}

export function focusedInput(): HTMLInputElement | null {
  let active = document.activeElement
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement
  return active instanceof HTMLInputElement ? active : null
}

function isCurrentPassword(field: HTMLInputElement): boolean {
  const tokens = autocompleteTokens(field)
  if (tokens.includes('new-password') || tokens.includes('one-time-code')) return false
  return field.type === 'password' || (field.type === 'text' && tokens.includes('current-password'))
}

function isUsernameCandidate(field: HTMLInputElement): boolean {
  const tokens = autocompleteTokens(field)
  return (
    ['text', 'email', 'tel'].includes(field.type) &&
    !tokens.some((token) =>
      ['new-password', 'current-password', 'one-time-code'].includes(token)
    ) &&
    !/(?:one.?time|otp|verification.?code)/i.test(`${field.name} ${field.id}`)
  )
}

function sameForm(left: HTMLInputElement, right: HTMLInputElement): boolean {
  return left.form === right.form && left.getRootNode() === right.getRootNode()
}

function usernameFor(
  password: HTMLInputElement,
  fields: HTMLInputElement[]
): HTMLInputElement | null {
  const passwordIndex = fields.indexOf(password)
  let previousPassword = -1
  for (let index = passwordIndex - 1; index >= 0; index--) {
    if (
      fields[index].type === 'password' ||
      autocompleteTokens(fields[index]).some(
        (token) => token === 'current-password' || token === 'new-password'
      )
    ) {
      previousPassword = index
      break
    }
  }
  const candidates = fields.filter(
    (field, index) =>
      sameForm(field, password) &&
      isUsernameCandidate(field) &&
      (password.form !== null || (index > previousPassword && index < passwordIndex))
  )
  const explicit = candidates.find((field) => autocompleteTokens(field).includes('username'))
  if (explicit) return explicit
  const named = candidates.find((field) =>
    /(?:user.?name|email|login)/i.test(`${field.name} ${field.id}`)
  )
  if (named) return named
  const preceding = candidates.filter(
    (field) => (password.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
  )
  return preceding.at(-1) ?? candidates[0] ?? null
}

function isIdentifierStep(field: HTMLInputElement): boolean {
  if (!isUsernameCandidate(field)) return false
  const tokens = autocompleteTokens(field)
  if (tokens.includes('username')) return true
  if (field.type !== 'email' && !tokens.includes('email')) return false
  const scope = field.form ?? field.parentElement
  const text = scope?.textContent ?? ''
  return (
    /\b(sign\s*in|log\s*in|continue|next)\b/i.test(text) &&
    !/\b(subscribe|newsletter)\b/i.test(text)
  )
}

/** Selects the focused login first and keeps account creation and OTP inputs out of saved fills. */
export function findLoginTarget(fields: HTMLInputElement[]): LoginTarget | null {
  const fillable = fields.filter(isFillable)
  const focused = focusedInput()
  const passwords = fillable.filter(isCurrentPassword)
  const focusedPassword =
    passwords.find((field) => field === focused) ??
    (focused
      ? passwords.find(
          (field) =>
            sameForm(field, focused) &&
            (field.form !== null || usernameFor(field, fillable) === focused)
        )
      : undefined)
  if (focused && !focusedPassword && fillable.includes(focused) && isIdentifierStep(focused)) {
    return { username: focused, password: null }
  }
  const password = focusedPassword ?? passwords[0]
  if (password) return { username: usernameFor(password, fillable), password }
  const identifiers = fillable.filter(isIdentifierStep)
  const username = identifiers.find((field) => field === focused) ?? identifiers[0]
  return username ? { username, password: null } : null
}

/** Includes field purpose so changing an existing input invalidates its old authorization. */
export function targetSignature(target: LoginTarget | null): string {
  return [target?.username, target?.password]
    .map((field) => (field ? `${field.type}|${field.autocomplete}|${field.name}|${field.id}` : ''))
    .join('\n')
}

export function sameTarget(left: LoginTarget | null, right: LoginTarget | null): boolean {
  return left?.username === right?.username && left?.password === right?.password
}
