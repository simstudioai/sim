'use client'

import { useMemo, useState } from 'react'
import {
  Button,
  cn,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@sim/emcn'
import { toRecord } from '@sim/utils/object'
import {
  DIFF_SIGN,
  DIFF_SIGN_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/diff-signs'
import { diffOrderedRows } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/ordered-row-diff'
import { ReadableValue } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/readable-value'
import type { StructuredValuePresentation } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/components/change-list/value-presentation'
import { maskSecretsDeep } from '@/app/workspace/[workspaceId]/w/components/workflow-diff/utils'
import type { SubBlockConfig } from '@/blocks/types'

const ROWS_PER_PAGE = 30

interface StructuredValueDiffProps {
  before: StructuredValuePresentation
  after: StructuredValuePresentation
  config?: SubBlockConfig
  label: string
}

/** Declared columns and ordered rows, with masking applied only after the comparison. */
export function StructuredValueDiff({ before, after, config, label }: StructuredValueDiffProps) {
  const rows = useMemo(() => diffOrderedRows(before.rows, after.rows), [before, after])
  const columns = [...new Set([...after.columns, ...before.columns])]
  const [visibleCount, setVisibleCount] = useState(ROWS_PER_PAGE)
  const tabular = config?.type === 'table'
  const maskTableValues = tabular && config.password
  const keyColumn = config?.columns?.[0]
  const representationChanged =
    before.sourceKey !== after.sourceKey && rows.every((row) => row.kind === 'context')

  return (
    <div className='min-w-0'>
      {representationChanged && (
        <span className='text-[var(--text-muted)] text-small'>
          {before.encoding === 'json-text' && after.encoding === 'json-text'
            ? 'Formatting changed'
            : 'Value type changed'}
        </span>
      )}
      <Table aria-label={`${label} changes`} className='table-fixed'>
        <colgroup>
          <col className='w-10' />
          <col span={tabular ? columns.length : 1} />
        </colgroup>
        {tabular && (
          <TableHeader>
            <TableRow>
              <TableHead className='w-10'>
                <span className='sr-only'>Change</span>
              </TableHead>
              {columns.map((column) => (
                <TableHead key={column}>{column}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
        )}
        <TableBody>
          {rows.slice(0, visibleCount).map((row, index) => {
            const masked = toRecord(maskSecretsDeep({ cells: row.value.cells }))
            const cells = toRecord(masked.cells)
            const sign = row.kind === 'context' ? null : row.kind
            return (
              <TableRow
                key={index}
                className={cn(
                  row.kind === 'added' && 'bg-[var(--badge-success-bg)]',
                  row.kind === 'removed' && 'bg-[var(--badge-error-bg)]'
                )}
              >
                <TableCell className='w-10 align-top'>
                  {sign && (
                    <span className={cn('font-mono', DIFF_SIGN_CLASS[sign])}>
                      <span className='sr-only'>{sign === 'added' ? 'Added' : 'Removed'}</span>
                      <span aria-hidden='true'>{DIFF_SIGN[sign]}</span>
                    </span>
                  )}
                </TableCell>
                {tabular ? (
                  columns.map((column) => {
                    const value = cells[column]
                    const concealed =
                      maskTableValues && column !== keyColumn && value != null && value !== ''
                    return (
                      <TableCell key={column} className='align-top'>
                        <ReadableValue value={concealed ? '•••' : value} />
                      </TableCell>
                    )
                  })
                ) : (
                  <TableCell className='align-top'>
                    <ReadableValue value={cells} />
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {visibleCount < rows.length && (
        <Button
          variant='quiet'
          size='sm'
          onClick={() => setVisibleCount((count) => count + ROWS_PER_PAGE)}
        >
          Show more rows
        </Button>
      )}
    </div>
  )
}
