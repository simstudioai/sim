/**
 * Normalizes a user-supplied SSO email domain to a canonical, comparable form.
 *
 * Strips protocol, path, query, port, leading wildcard/`@`, an email local
 * part, surrounding whitespace, and a trailing dot, then lowercases the result.
 * Returns `null` when the input does not look like a registrable domain
 * (`example.com`), which callers should treat as a validation error.
 *
 * Used to compare a requested SSO domain against already-registered providers
 * so a tenant cannot claim a domain another tenant already owns via casing or
 * formatting variants.
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
  if (value.split('.').some((label) => label.length === 0 || label.length > 63)) return null

  return value
}
