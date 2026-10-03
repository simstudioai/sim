import {
  PERMISSION_GROUP_FIELDS,
  type PermissionGroupCapabilityScope,
  type PermissionGroupConfig,
  type PermissionGroupConfigKey,
} from '@/lib/permission-groups/fields'

export type BooleanPermissionGroupConfigKey = {
  [Key in keyof PermissionGroupConfig]: PermissionGroupConfig[Key] extends boolean ? Key : never
}[keyof PermissionGroupConfig]

export interface PermissionGroupPlatformFeature {
  id: string
  label: string
  category: string
  configKey: BooleanPermissionGroupConfigKey
  hint: string
  /** See {@link PermissionGroupCapabilityScope}. */
  scope: PermissionGroupCapabilityScope
}

/**
 * The note a group editor shows beside an organization-scoped row.
 *
 * One sentence, in one place, so the editor and any other surface that has to
 * explain the row say the same thing.
 */
export const ORGANIZATION_SCOPED_FEATURE_NOTE =
  "Read from the organization's default group, so it applies organization-wide no matter which group sets it."

/**
 * Whether a group editor can decide this key at all.
 *
 * An `organization`-scoped key is read from the organization's default group, so
 * on any other group the checkbox writes a value nothing will ever read. The
 * editor renders those rows inert and every bulk action skips them, both from
 * this one predicate — a second copy is how the row and the "Select All" it sits
 * under would come to disagree.
 */
export function isFeatureInertForGroup(
  feature: PermissionGroupPlatformFeature,
  groupIsDefault: boolean
): boolean {
  return feature.scope === 'organization' && !groupIsDefault
}

export interface ActivePermissionGroupRestriction {
  key: keyof PermissionGroupConfig
  description: string
}

/**
 * Render order for the platform-feature category sections; unlisted ones follow.
 *
 * Named after what a group withholds rather than after the surface the key once
 * hid, for the reason `PlatformFeatureMeta.hint` in `fields.ts` gives at length.
 */
export const PLATFORM_CATEGORY_ORDER: readonly string[] = [
  'Modules',
  'Knowledge Base',
  'Tables',
  'Files',
  'Deployment',
  'Tools',
  'Logs',
  'Collaboration',
  'Credentials & Access',
] as const

const FIELD_ENTRIES = Object.entries(PERMISSION_GROUP_FIELDS) as Array<
  [PermissionGroupConfigKey, (typeof PERMISSION_GROUP_FIELDS)[PermissionGroupConfigKey]]
>

/**
 * The boolean toggles the Access Control editor renders, in registry order.
 *
 * Derived rather than listed, so a boolean key cannot reach the config without
 * reaching the editor — an unrendered key is one an admin can neither set nor
 * see, which is how a restriction ends up applying with nothing to explain it.
 */
export const PLATFORM_FEATURES: readonly PermissionGroupPlatformFeature[] = FIELD_ENTRIES.flatMap(
  ([key, field]) =>
    field.kind === 'boolean-restriction'
      ? [{ ...field.feature, configKey: key as BooleanPermissionGroupConfigKey }]
      : []
)

/**
 * Returns only restrictions that actively constrain the current user.
 *
 * Two passes, allowlists and denylists before booleans, because the resulting
 * prose is what the Copilot context and the group roster read: reordering it
 * would rewrite text that surfaces to users for no reason.
 */
export function getActivePermissionGroupRestrictions(
  config: PermissionGroupConfig | null
): ActivePermissionGroupRestriction[] {
  if (!config) return []

  const restrictions: ActivePermissionGroupRestriction[] = []

  for (const [key, field] of FIELD_ENTRIES) {
    const value = config[key]
    if (field.kind === 'allowlist' && Array.isArray(value)) {
      restrictions.push({
        key,
        description: value.length > 0 ? field.phrasing.limited : field.phrasing.empty,
      })
    } else if (field.kind === 'denylist' && Array.isArray(value) && value.length > 0) {
      restrictions.push({ key, description: field.phrasing })
    }
  }

  for (const feature of PLATFORM_FEATURES) {
    if (config[feature.configKey]) {
      restrictions.push({ key: feature.configKey, description: feature.hint })
    }
  }

  return restrictions
}
