'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Input } from '@sim/emcn/field/inputs'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import styles from '@/app/(product)/_components/workspace/workflows/search-replace/workflow-search-replace.module.css'
import type { WorkflowSearchReplacementOption } from '@/platform/lib/data/workflows'

interface ReplacementControlsProps {
  replacement: string
  compatibleResourceOptions: WorkflowSearchReplacementOption[]
  usesResourceReplacement: boolean
  eligibleCount: number
  disabled?: boolean
  isApplying?: boolean
  canReplaceActive: boolean
  canReplaceAll: boolean
  onReplacementChange: (replacement: string) => void
  /** Hears what is typed in the resource picker, which file options are searched by. */
  onReplacementSearchChange: (query: string) => void
  onReplaceActive: () => void
  onReplaceAll: () => void
}

/**
 * The replace row of the search panel: a resource picker when the current match is a constrained
 * resource (credential, file, table, …), otherwise a text field, then the replaceable count and
 * the Replace / Replace All actions.
 */
export function ReplacementControls({
  replacement,
  compatibleResourceOptions,
  usesResourceReplacement,
  eligibleCount,
  disabled,
  isApplying,
  canReplaceActive,
  canReplaceAll,
  onReplacementChange,
  onReplacementSearchChange,
  onReplaceActive,
  onReplaceAll,
}: ReplacementControlsProps) {
  /* The legacy picker filtered its options by label while also telling the caller the query, so
     files could be searched on the server; the picker's server search mode does the telling and
     this list does the filtering. */
  const [resourceQuery, setResourceQuery] = useState('')
  const normalizedQuery = resourceQuery.toLowerCase()
  const visibleResourceOptions = compatibleResourceOptions
    .filter((option) => !normalizedQuery || option.label.toLowerCase().includes(normalizedQuery))
    .map((option) => ({ label: option.label, value: option.value }))
  const selectedResource = compatibleResourceOptions.find((option) => option.value === replacement)

  return (
    <div className={styles.replacement}>
      {usesResourceReplacement ? (
        <SearchableSelect
          label='Replacement'
          labelHidden
          options={visibleResourceOptions}
          value={replacement || null}
          selectedLabel={selectedResource?.label}
          onValueChange={(next) => onReplacementChange(next ?? '')}
          placeholder='Choose replacement…'
          searchLabel='Search resources…'
          search={{
            query: resourceQuery,
            onQueryChange: (query) => {
              if (query === resourceQuery) return
              setResourceQuery(query)
              onReplacementSearchChange(query)
            },
            emptyMessage: 'No valid replacements available',
          }}
          disabled={disabled || compatibleResourceOptions.length === 0}
        />
      ) : (
        <Input
          label='Replace'
          value={replacement}
          placeholder='Replace'
          disabled={disabled}
          onChange={onReplacementChange}
        />
      )}

      <div className={styles.replaceActions}>
        <span className={styles.count} data-type='T052'>
          {eligibleCount} replaceable match{eligibleCount === 1 ? '' : 'es'}
        </span>
        <div className={styles.replaceButtons}>
          <Button
            variant='secondary'
            size='compact'
            disabled={disabled || isApplying || !canReplaceActive}
            onClick={onReplaceActive}
          >
            Replace
          </Button>
          <Button
            variant='primary'
            size='compact'
            disabled={disabled || isApplying || !canReplaceAll}
            onClick={onReplaceAll}
          >
            {isApplying ? 'Replacing…' : 'Replace all'}
          </Button>
        </div>
      </div>
    </div>
  )
}
