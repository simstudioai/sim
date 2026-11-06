const ACCOUNT_SCOPES = new Set([
  'openid',
  'userinfo.email',
  'userinfo.profile',
  'read:me',
  'offline_access',
  'refresh_token',
])

const GOOGLE_WRITE_SCOPES = new Set([
  'gmail.send',
  'gmail.modify',
  'gmail.labels',
  'calendar',
  'drive',
  'drive.file',
  'meetings.space.created',
])

export const SCOPE_GROUPS = [
  'Account and sign-in',
  'Read and search',
  'Write and manage',
  'Provider access',
] as const

export function scopeGroup(id: string): (typeof SCOPE_GROUPS)[number] {
  const scope = id.replace(/^https:\/\/www\.googleapis\.com\/auth\//, '')
  if (ACCOUNT_SCOPES.has(scope)) return 'Account and sign-in'
  if (GOOGLE_WRITE_SCOPES.has(scope) || /^(write|delete|manage)(:|$)/.test(scope))
    return 'Write and manage'
  if (/^(read|search)(:|$)|:(read|history)([.:]|$)|\.readonly$/.test(scope))
    return 'Read and search'
  return 'Provider access'
}
