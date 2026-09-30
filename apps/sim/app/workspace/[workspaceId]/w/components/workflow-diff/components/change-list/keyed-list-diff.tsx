'use client'

import { cn } from '@sim/emcn'
import {
  DIFF_SIGN,
  DIFF_SIGN_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/diff-signs'
import { TextDiff } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/text-diff'
import {
  describeListItems,
  isPositionalListField,
  pairListItems,
  toItemList,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/utils'

interface KeyedListDiffProps {
  blockType: string
  field: string
  oldValue: unknown
  newValue: unknown
}

/**
 * Item-by-item diff for list fields (tools, conditions, routes, input fields):
 * one row per item that was added, removed or changed, with the item's body
 * diffed as text when it changed. Unchanged items stay out of the way.
 */
export function KeyedListDiff({ blockType, field, oldValue, newValue }: KeyedListDiffProps) {
  const oldItems = describeListItems(blockType, field, toItemList(oldValue) ?? [])
  const newItems = describeListItems(blockType, field, toItemList(newValue) ?? [])
  const rows = pairListItems(oldItems, newItems, isPositionalListField(blockType, field))

  return (
    <div className='flex flex-col gap-1.5'>
      {rows.length === 0 && (
        <span className='text-[var(--text-tertiary)] text-small'>Order changed</span>
      )}
      {rows.map((row, index) => (
        <div key={`${row.kind}-${row.label}-${index}`} className='flex items-start gap-2'>
          <span
            className={cn(
              'w-3 shrink-0 text-center font-mono text-small leading-5',
              DIFF_SIGN_CLASS[row.kind]
            )}
          >
            {DIFF_SIGN[row.kind]}
          </span>
          <div className='flex min-w-0 flex-1 flex-col gap-1'>
            <span
              className={cn(
                'text-small leading-5',
                row.kind === 'removed'
                  ? 'text-[var(--text-tertiary)]'
                  : 'text-[var(--text-primary)]'
              )}
            >
              {row.label}
              {row.oldLabel && (
                <span className='text-[var(--text-muted)]'> (was {row.oldLabel})</span>
              )}
              {row.secretChanged && (
                <span className='text-[var(--text-muted)]'> (a masked value changed)</span>
              )}
            </span>
            {row.kind === 'changed' && row.oldText !== row.newText ? (
              <TextDiff oldText={row.oldText} newText={row.newText} />
            ) : (
              (row.newText || row.oldText) && (
                <span
                  className={cn(
                    'whitespace-pre-wrap break-words text-caption',
                    row.kind === 'removed'
                      ? 'text-[var(--text-placeholder)]'
                      : 'text-[var(--text-tertiary)]'
                  )}
                >
                  {row.newText || row.oldText}
                </span>
              )
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
