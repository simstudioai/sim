/**
 * Normalizes a user-supplied SSO email domain to a canonical, comparable form:
 * strips protocol, path, query, port, a leading wildcard/`@`, an email local
 * part, and a trailing dot, then lowercases. Returns `null` for inputs that are
 * not a registrable domain (e.g. `example.com`), which callers treat as invalid.
 */
export function normalizeSSODomain(input: string): string | null {
  if (typeof input !== 'string') return null

  let value = input.trim().toLowerCase()
  if (!value) return null

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  value = value.replace(/^\*\./, '').replace(/^@/, '')
  value = value.split('/')[0]
  value = value.split('?')[0]
  value = value.split('@').pop() ?? value
  value = value.split(':')[0]
  value = value.replace(/\.$/, '')

  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return null

  const labels = value.split('.')
  if (labels.some((label) => label.length === 0 || label.length > 63)) return null
  if (/^\d+$/.test(labels[labels.length - 1])) return null

  return value
}
