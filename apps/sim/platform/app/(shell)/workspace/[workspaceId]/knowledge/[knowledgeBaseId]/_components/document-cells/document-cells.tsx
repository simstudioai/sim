'use client'

import { OverflowText } from '@sim/emcn/overflow-text'
import { Spinner, StatusTag } from '@sim/emcn/status'
import { Tooltip } from '@sim/emcn/tooltip'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/knowledge/[knowledgeBaseId]/_components/document-cells/document-cells.module.css'
import {
  ALL_TAG_SLOTS,
  type DocumentData,
  getDocumentIndexingStatus,
  getFieldTypeForSlot,
  type TagDefinitionData,
} from '@/platform/lib/data/knowledge'
import { calendarDayFormatter, formatCalendarDate, formatTimestamp } from '@/platform/shared/time'

/** Where a document's indexing stands, and whether a finished one is searchable. */
export function DocumentStatus({
  document,
}: {
  document: Pick<
    DocumentData,
    'processingStatus' | 'processingOutcome' | 'processingError' | 'enabled'
  >
}) {
  switch (getDocumentIndexingStatus(document)) {
    case 'pending':
      return <StatusTag label='Pending' />
    case 'processing':
      return <StatusTag label='Processing' intent='info' leading={<Spinner />} />
    case 'skipped':
      return <StatusTag label='Skipped' />
    case 'failed':
      return document.processingError ? (
        <Tooltip label={document.processingError}>
          <span className={styles.explained}>
            <StatusTag label='Failed' intent='danger' />
          </span>
        </Tooltip>
      ) : (
        <StatusTag label='Failed' intent='danger' />
      )
    case 'completed':
      return document.enabled ? (
        <StatusTag label='Enabled' intent='success' />
      ) : (
        <StatusTag label='Disabled' />
      )
    default:
      return <StatusTag label='Unknown' />
  }
}

const viewerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/** The upload day, with the full date and time on hover. */
export function UploadedDate({ instant }: { instant: string }) {
  const time = new Date(instant).getTime()
  if (Number.isNaN(time)) return null
  const day = formatCalendarDate(calendarDayFormatter(viewerZone())(time))
  return (
    <Tooltip label={formatTimestamp(time)}>
      <span className={styles.explained}>{day}</span>
    </Tooltip>
  )
}

interface TagValue {
  slot: string
  name: string
  value: string
}

/** A document's tag values, each read by its definition's type. */
function documentTagValues(
  document: DocumentData,
  definitions: ReadonlyMap<string, TagDefinitionData>
): TagValue[] {
  const values: TagValue[] = []
  for (const slot of ALL_TAG_SLOTS) {
    const raw = document[slot]
    if (raw === null || raw === undefined) continue
    const definition = definitions.get(slot)
    const type = definition?.fieldType || getFieldTypeForSlot(slot) || 'text'
    let value: string
    if (type === 'date') {
      const time = new Date(String(raw)).getTime()
      value = Number.isNaN(time)
        ? String(raw)
        : formatCalendarDate(String(raw).slice(0, 10), 'full')
    } else if (type === 'boolean') value = raw ? 'Yes' : 'No'
    else if (type === 'number' && typeof raw === 'number') value = raw.toLocaleString()
    else value = String(raw)
    if (value) values.push({ slot, name: definition?.displayName || slot, value })
  }
  return values
}

/** The values inline; when they clip, each `name: value` pair on hover. */
export function DocumentTags({
  document,
  definitions,
}: {
  document: DocumentData
  definitions: ReadonlyMap<string, TagDefinitionData>
}) {
  const tags = documentTagValues(document, definitions)
  if (tags.length === 0) return null
  const text = tags.map((tag) => tag.value).join(', ')
  return (
    <span className={styles.tags}>
      <OverflowText
        text={text}
        fullValue={tags.map((tag) => `${tag.name}: ${tag.value}`).join(' · ')}
      >
        {text}
      </OverflowText>
    </span>
  )
}
