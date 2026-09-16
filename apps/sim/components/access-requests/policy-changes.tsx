'use client'

import { useId, useState } from 'react'
import { Chip, ChipModalField, Expandable, ExpandableContent } from '@sim/emcn'
import type {
  AccessRequestPolicyChange,
  AccessRequestPreviewResponse,
  AccessRequestTarget,
} from '@/lib/api/contracts/access-requests'
import { PERMISSION_GROUP_FIELDS } from '@/lib/permission-groups/fields'

interface PolicyChangesProps {
  changes: AccessRequestPolicyChange[]
  impact: AccessRequestPreviewResponse['impact']
  target: AccessRequestTarget
  targetLabel: string
}

function describePolicyValue(value: AccessRequestPolicyChange['before']): string {
  if (value === null) return 'All allowed'
  if (typeof value === 'boolean') return value ? 'Restricted' : 'Allowed'
  return value.length ? value.join(', ') : 'None'
}

export function describePolicyChange(
  change: AccessRequestPolicyChange,
  target: AccessRequestTarget,
  targetLabel: string
): string {
  const { before, after } = change
  if (typeof after === 'boolean')
    return `${describePolicyValue(before)} → ${describePolicyValue(after)}`
  if (after === null) return 'Allow all'
  const label = (value: string) =>
    target.kind !== 'feature' && value === target.id ? targetLabel : value
  if (before === null)
    return after.length ? `Allow only ${after.map(label).join(', ')}` : 'Allow none'
  if (!Array.isArray(before))
    return `${describePolicyValue(before)} → ${describePolicyValue(after)}`
  const previous = new Set(before)
  const next = new Set(after)
  const added = after.filter((value) => !previous.has(value))
  const removed = before.filter((value) => !next.has(value))
  const denylist = PERMISSION_GROUP_FIELDS[change.configKey].kind === 'denylist'
  return (
    [
      added.length ? `${denylist ? 'Block' : 'Allow'} ${added.map(label).join(', ')}` : '',
      removed.length ? `${denylist ? 'Unblock' : 'Remove'} ${removed.map(label).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ') || 'No membership change'
  )
}

export function PolicyChanges({ changes, impact, target, targetLabel }: PolicyChangesProps) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()

  return (
    <ChipModalField
      type='custom'
      title='Changes'
      titleActions={
        <Chip
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide details' : 'View details'}
        </Chip>
      }
    >
      <ul className='space-y-1 text-sm'>
        {changes.map((change) => (
          <li key={change.configKey} className='break-words text-[var(--text-body)]'>
            <span className='text-[var(--text-muted)]'>{change.label}: </span>
            {describePolicyChange(change, target, targetLabel)}
          </li>
        ))}
      </ul>
      <Expandable expanded={expanded}>
        <ExpandableContent id={detailsId}>
          <div className='flex flex-col gap-4 pt-2'>
            {impact.workspaceNames.length > 0 && (
              <ChipModalField type='custom' title='Workspaces' flush>
                <p className='break-words text-[var(--text-body)] text-sm'>
                  {impact.workspaceNames.join(', ')}
                  {impact.truncated ? ' and more' : ''}
                </p>
              </ChipModalField>
            )}
            {changes.map((change) => (
              <ChipModalField key={change.configKey} type='custom' title={change.label} flush>
                <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm'>
                  <dt className='text-[var(--text-muted)]'>Before</dt>
                  <dd className='whitespace-pre-wrap break-words text-[var(--text-body)]'>
                    {describePolicyValue(change.before)}
                  </dd>
                  <dt className='text-[var(--text-muted)]'>After</dt>
                  <dd className='whitespace-pre-wrap break-words text-[var(--text-body)]'>
                    {describePolicyValue(change.after)}
                  </dd>
                </dl>
              </ChipModalField>
            ))}
          </div>
        </ExpandableContent>
      </Expandable>
    </ChipModalField>
  )
}
