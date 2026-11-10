'use client'

import { type ComponentType, createContext, useContext } from 'react'
import { ActivityBody } from '@sim/emcn/activity-row/activity-body'
import { useClipboard } from '@sim/emcn/feedback/use-clipboard'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { OverflowText } from '@sim/emcn/overflow-text'
import { StatusText } from '@sim/emcn/status'
import { toast } from '@/lib/toast/sink'
import styles from '@/app/(product)/_components/source-row/source-row.module.css'
import { onExternalLinkClick } from '@/platform/lib/data/external-link'

/** One document a search found or an answer cited. */
export interface SourceRowData {
  id: string
  url: string
  title: string
  meta?: string
  snippet?: string
  /** The document no longer opens for this reader, as when it was deleted after it was cited. */
  unavailable?: boolean
}

export interface SourceActionsProps {
  row: SourceRowData
  actions: readonly MenuAction[]
  onLeave?: () => void
}

interface SourceActionsMenuProps {
  row: SourceRowData
  actions: readonly MenuAction[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function SourceActionsMenu({ row, actions, open, onOpenChange }: SourceActionsMenuProps) {
  return (
    <ActionMenu
      label={`Actions for ${row.title}`}
      icon='I108'
      actions={actions}
      open={open}
      onOpenChange={onOpenChange}
    />
  )
}

function BaseSourceActions({ row, actions }: SourceActionsProps) {
  return <SourceActionsMenu row={row} actions={actions} />
}

const ActionsHost = createContext<ComponentType<SourceActionsProps> | null>(null)
/** Live sessions add the actions that need real data, such as a Sim link; fixtures add none. */
export const SourceActionsProvider = ActionsHost.Provider

interface SourceRowProps {
  row: SourceRowData
  onOpen?: (row: SourceRowData) => void
  onSummarize?: (row: SourceRowData) => void
  /** Closes the surface holding the row before an action opens a dialog, which it would cover. */
  onLeave?: () => void
}

export function SourceRow({ row, onOpen, onSummarize, onLeave }: SourceRowProps) {
  const { copy } = useClipboard()
  const Actions = useContext(ActionsHost) ?? BaseSourceActions
  return (
    <article className={styles.row}>
      <ActivityBody>
        {row.unavailable ? (
          <span className={styles.unavailable} data-type='T048'>
            <OverflowText text={row.title}>{row.title}</OverflowText>
          </span>
        ) : (
          <a
            className={styles.title}
            data-type='T048'
            data-source-link=''
            href={row.url}
            target='_blank'
            rel='noopener noreferrer'
            onClick={(event) => {
              onOpen?.(row)
              onExternalLinkClick(event, row.url)
            }}
          >
            <OverflowText text={row.title}>{row.title}</OverflowText>
          </a>
        )}
        {row.unavailable && <StatusText label='Unavailable' />}
        {row.meta && (
          <span className={styles.quiet} data-type='T052'>
            {row.meta}
          </span>
        )}
        {row.snippet && (
          <span className={styles.snippet} data-type='T052'>
            {row.snippet}
          </span>
        )}
      </ActivityBody>
      {!row.unavailable && (
        <Actions
          row={row}
          onLeave={onLeave}
          actions={[
            ...(onSummarize
              ? [{ id: 'summarize', label: 'Summarize', onSelect: () => onSummarize(row) }]
              : []),
            {
              id: 'copy',
              label: 'Copy link',
              onSelect: () =>
                void copy(row.url).then((copied) => {
                  if (!copied) toast.error('Unable to copy link')
                }),
            },
          ]}
        />
      )}
    </article>
  )
}
