'use client'

import { useId, useState } from 'react'
import { Chip, ChipModalField, Expandable, ExpandableContent } from '@sim/emcn-legacy'
import type {
  AccessRequestPolicyChange,
  AccessRequestPreviewResponse,
  AccessRequestTarget,
} from '@/lib/api/contracts/access-requests'
import {
  describePolicyChange,
  describePolicyValue,
} from '@/ee/access-requests/lib/policy-description'

interface PolicyChangesProps {
  changes: AccessRequestPolicyChange[]
  impact: AccessRequestPreviewResponse['impact']
  target: AccessRequestTarget
  targetLabel: string
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
      <div>
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
            <div className='flex flex-col gap-4 pt-4'>
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
                      {describePolicyValue(change.before, change.configKey, target, targetLabel)}
                    </dd>
                    <dt className='text-[var(--text-muted)]'>After</dt>
                    <dd className='whitespace-pre-wrap break-words text-[var(--text-body)]'>
                      {describePolicyValue(change.after, change.configKey, target, targetLabel)}
                    </dd>
                  </dl>
                </ChipModalField>
              ))}
            </div>
          </ExpandableContent>
        </Expandable>
      </div>
    </ChipModalField>
  )
}
