'use client'

import { useMemo, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { isRecordLike, toRecord } from '@sim/utils/object'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/compare-versions/compare-versions.module.css'
import {
  diffOrderedRows,
  maskSecretsDeep,
  type StructuredValuePresentation,
} from '@/platform/lib/data/workflow-deploy'
import type { SubBlockConfig } from '@/platform/lib/data/workflows'

const ROWS_PER_PAGE = 30
const DIFF_SIGN = { added: '+', removed: '−' } as const

/** A nested value with every property and item, and no JSON syntax. */
function ReadableValue({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return value.length ? (
      <ol className={styles.readableList}>
        {value.map((item, index) => (
          <li key={index}>
            <ReadableValue value={item} />
          </li>
        ))}
      </ol>
    ) : (
      <span className={styles.muted}>No items</span>
    )
  if (isRecordLike(value)) {
    const entries = Object.entries(value)
    return entries.length ? (
      <dl className={styles.readableFields}>
        {entries.map(([key, entry]) => (
          <div key={key} className={styles.readableField}>
            <dt className={styles.muted} data-type='T052'>
              {key}
            </dt>
            <dd>
              <ReadableValue value={entry} />
            </dd>
          </div>
        ))}
      </dl>
    ) : (
      <span className={styles.muted}>No fields</span>
    )
  }
  if (value === undefined || value === null || value === '')
    return (
      <span className={styles.muted} data-type='T052'>
        {value === undefined ? 'Unset' : value === null ? 'Null' : 'Empty'}
      </span>
    )
  if (typeof value !== 'string')
    return (
      <span className={styles.chip} data-type='T009'>
        {String(value)}
      </span>
    )
  return <span className={styles.prose}>{value}</span>
}

interface StructuredValueDiffProps {
  before: StructuredValuePresentation
  after: StructuredValuePresentation
  config?: SubBlockConfig
  label: string
}

/** Declared columns and ordered rows, masking only after the comparison. */
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
    <div className={styles.structured}>
      {representationChanged && (
        <span className={styles.muted} data-type='T060'>
          {before.encoding === 'json-text' && after.encoding === 'json-text'
            ? 'Formatting changed'
            : 'Value type changed'}
        </span>
      )}
      <table className={styles.table} aria-label={`${label} changes`} data-type='T060'>
        {tabular && (
          <thead>
            <tr>
              <th className={styles.signCell}>
                <span data-visually-hidden=''>Change</span>
              </th>
              {columns.map((column) => (
                <th key={column} data-type='T052'>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.slice(0, visibleCount).map((row, index) => {
            const cells = toRecord(toRecord(maskSecretsDeep({ cells: row.value.cells })).cells)
            const sign = row.kind === 'context' ? null : row.kind
            return (
              <tr key={index} data-kind={sign ?? undefined}>
                <td className={styles.signCell}>
                  {sign && (
                    <>
                      <span data-visually-hidden=''>{sign === 'added' ? 'Added' : 'Removed'}</span>
                      <span aria-hidden='true'>{DIFF_SIGN[sign]}</span>
                    </>
                  )}
                </td>
                {tabular ? (
                  columns.map((column) => {
                    const value = cells[column]
                    const concealed =
                      maskTableValues && column !== keyColumn && value != null && value !== ''
                    return (
                      <td key={column}>
                        <ReadableValue value={concealed ? '•••' : value} />
                      </td>
                    )
                  })
                ) : (
                  <td>
                    <ReadableValue value={cells} />
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {visibleCount < rows.length && (
        <Button
          variant='quiet'
          size='compact'
          onClick={() => setVisibleCount((count) => count + ROWS_PER_PAGE)}
        >
          Show more rows
        </Button>
      )}
    </div>
  )
}
