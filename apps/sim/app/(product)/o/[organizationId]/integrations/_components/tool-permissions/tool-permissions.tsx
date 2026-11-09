import { EmptyState } from '@sim/emcn/empty-state'
import { CountedLabel } from '@sim/emcn/overflow-text/counted-label'
import { SearchField } from '@sim/emcn/search-field'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import styles from '@/app/(product)/o/[organizationId]/integrations/_components/tool-permissions/tool-permissions.module.css'
import type {
  ToolPermissionChange,
  ToolPermissionsModel,
  ToolPolicy,
} from '@/platform/shared/integrations'

const POLICY_LABELS: Record<ToolPolicy, string> = { allow: 'Allow', ask: 'Ask', block: 'Block' }
const POLICIES = ['allow', 'ask', 'block'] as const
const GROUPS = [
  { kind: 'read', label: 'Read-only tools' },
  { kind: 'write', label: 'Write tools' },
] as const
const MIXED = 'mixed'

interface ToolPermissionsProps {
  permissions: ToolPermissionsModel
  query: string
  onQueryChange: (query: string) => void
  pending: boolean
  onChange: (change: ToolPermissionChange) => void
}

export function ToolPermissions({
  permissions,
  query,
  onQueryChange,
  pending,
  onChange,
}: ToolPermissionsProps) {
  const canAllow = permissions.canAutoApprove && permissions.accountActive
  const choices = POLICIES.map((value) => ({
    value,
    label: POLICY_LABELS[value],
    disabled: pending || (value === 'allow' && !canAllow),
  }))
  const filter = query.trim().toLowerCase()
  const matches = permissions.tools.filter((tool) =>
    `${tool.label} ${tool.description}`.toLowerCase().includes(filter)
  )

  return (
    <section className={styles.section} aria-label='Tool permissions'>
      <div className={styles.intro}>
        <h2 data-type='T093'>Tool permissions</h2>
        {!permissions.canAutoApprove && (
          <p className={styles.detail} data-type='T060'>
            Your organization requires approval before tools run.
          </p>
        )}
        {!permissions.accountActive && (
          <p className={styles.detail} data-type='T060'>
            This account is disconnected or paused. Reconnect it before allowing tools
            automatically.
          </p>
        )}
      </div>
      {permissions.tools.length > 0 && (
        <ControlBar
          search={
            <SearchField
              variant='quiet'
              label='Search tools'
              placeholder='Search tools…'
              value={query}
              onValueChange={onQueryChange}
            />
          }
        />
      )}
      {GROUPS.map(({ kind, label }) => {
        const matching = matches.filter((tool) => tool.kind === kind)
        if (!matching.length) return null
        const tools = permissions.tools.filter((item) => item.kind === kind)
        const defaultLabel = POLICY_LABELS[permissions[kind]]
        const groupValue = tools.every((tool) => tool.policy === tools[0].policy)
          ? tools[0].policy
          : MIXED
        return (
          <section key={kind} className={styles.group} aria-label={label}>
            <div className={styles.tool}>
              <h3 data-type='T059'>
                <CountedLabel label={label} count={tools.length} />
              </h3>
              <div className={styles.actions}>
                {groupValue === MIXED && (
                  <span className={styles.detail} data-type='T060'>
                    Mixed
                  </span>
                )}
                <SegmentedControl<ToolPolicy | typeof MIXED>
                  label={`${label} permission`}
                  options={choices}
                  value={groupValue}
                  onSelect={(policy) => {
                    if (policy !== MIXED) onChange({ kind: 'group', effect: kind, policy })
                  }}
                />
              </div>
            </div>
            <ul className={styles.list}>
              {matching.map((tool) => (
                <li className={styles.tool} key={tool.id}>
                  <div className={styles.copy}>
                    <span data-type='T059'>{tool.label}</span>
                    {tool.description && (
                      <span className={styles.detail} data-type='T060'>
                        {tool.description}
                      </span>
                    )}
                  </div>
                  <div className={styles.actions}>
                    <SegmentedControl<ToolPolicy>
                      label={`${tool.label} permission`}
                      description={
                        tool.inherited
                          ? `Inherits ${defaultLabel} from ${label.toLowerCase()}.`
                          : undefined
                      }
                      options={choices}
                      value={tool.policy}
                      onSelect={(policy) => onChange({ kind: 'tool', toolId: tool.id, policy })}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {!matches.length && (
        <EmptyState
          title={filter ? 'No matching tools' : 'No Assistant tools are available for this account'}
        />
      )}
    </section>
  )
}
