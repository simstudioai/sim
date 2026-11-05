import type {
  AccessRequestPolicyChange,
  AccessRequestTarget,
} from '@/lib/api/contracts/access-requests'
import { BLOCK_NAMES } from '@/lib/block-metadata/names.generated'
import { PERMISSION_GROUP_FIELDS } from '@/lib/permission-groups/fields'
import { resolveAccessControlBlockType } from '@/lib/permission-groups/integration-allowlist'

function describePolicyItems(
  values: string[],
  configKey: AccessRequestPolicyChange['configKey'],
  target: AccessRequestTarget,
  targetLabel: string
): ReadonlyMap<string, string> {
  const items = new Map<string, string>()
  const integrationTarget =
    target.kind === 'integration'
      ? resolveAccessControlBlockType(target.id.toLowerCase()).toLowerCase()
      : null
  for (const value of values) {
    if (configKey === 'allowedIntegrations') {
      const canonical = resolveAccessControlBlockType(value.toLowerCase()).toLowerCase()
      const label = Object.hasOwn(BLOCK_NAMES, canonical)
        ? BLOCK_NAMES[canonical]!
        : canonical === integrationTarget
          ? targetLabel
          : value
      items.set(canonical, label)
    } else {
      items.set(value, target.kind !== 'feature' && value === target.id ? targetLabel : value)
    }
  }
  return items
}

export function describePolicyValue(
  value: AccessRequestPolicyChange['before'],
  configKey: AccessRequestPolicyChange['configKey'],
  target: AccessRequestTarget,
  targetLabel: string
): string {
  if (value === null) return 'All allowed'
  if (typeof value === 'boolean') return value ? 'Restricted' : 'Allowed'
  return value.length
    ? [...describePolicyItems(value, configKey, target, targetLabel).values()].join(', ')
    : 'None'
}

export function describePolicyChange(
  change: AccessRequestPolicyChange,
  target: AccessRequestTarget,
  targetLabel: string
): string {
  const { before, after } = change
  const describe = (value: AccessRequestPolicyChange['before']) =>
    describePolicyValue(value, change.configKey, target, targetLabel)
  if (typeof after === 'boolean') return `${describe(before)} → ${describe(after)}`
  if (after === null) return 'Allow all'
  const next = describePolicyItems(after, change.configKey, target, targetLabel)
  if (before === null)
    return next.size ? `Allow only ${[...next.values()].join(', ')}` : 'Allow none'
  if (!Array.isArray(before)) return `${describe(before)} → ${describe(after)}`
  const previous = describePolicyItems(before, change.configKey, target, targetLabel)
  const added = [...next].filter(([id]) => !previous.has(id)).map(([, label]) => label)
  const removed = [...previous].filter(([id]) => !next.has(id)).map(([, label]) => label)
  const denylist = PERMISSION_GROUP_FIELDS[change.configKey].kind === 'denylist'
  return (
    [
      added.length ? `${denylist ? 'Block' : 'Allow'} ${added.join(', ')}` : '',
      removed.length ? `${denylist ? 'Unblock' : 'Remove'} ${removed.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ') || 'No membership change'
  )
}
