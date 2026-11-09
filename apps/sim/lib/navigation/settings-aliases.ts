/**
 * The one table of organization Settings sections the legacy surface reached by an older name.
 * Dependency-free so the product's route resolution, the Settings page and the legacy workspace
 * mapping all read it, and a legacy workspace URL lands on the section in one hop.
 */

interface SettingsAlias {
  /** The section that owns the old one now. */
  section: string
  /** The secondary view of `section` the old one opens as, carried in `?view=`. */
  view?: string
}

const ORGANIZATION_SETTINGS_ALIASES: Readonly<Record<string, SettingsAlias>> = {
  preferences: { section: 'general' },
  account: { section: 'general' },
  notifications: { section: 'general' },
  privacy: { section: 'general', view: 'privacy' },
  'authorized-apps': { section: 'general', view: 'authorized-apps' },
  connections: { section: 'connected-accounts' },
  organization: { section: 'members' },
  team: { section: 'members' },
  subscription: { section: 'billing' },
  domains: { section: 'sso' },
  sessions: { section: 'security' },
}

/**
 * Where a legacy Settings path (the segments below `<organization root>/settings/`) lands now, with
 * its query kept and an alias's view added, or `null` when the path is not an alias.
 */
export function settingsAliasHref(
  organizationRoot: string,
  path: readonly string[],
  query: URLSearchParams
): string | null {
  const [key, ...subpath] = path
  if (key === undefined || subpath.length || !Object.hasOwn(ORGANIZATION_SETTINGS_ALIASES, key))
    return null
  const { section, view } = ORGANIZATION_SETTINGS_ALIASES[key]
  const params = new URLSearchParams(query)
  if (view) params.set('view', view)
  const href = `${organizationRoot}/settings/${section}`
  return params.size ? `${href}?${params}` : href
}
