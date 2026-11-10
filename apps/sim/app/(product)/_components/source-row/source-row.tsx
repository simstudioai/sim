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
import type { LinkedSourceRow, SourceRowData } from '@/platform/lib/data/models/source-row'

export interface SourceActionsProps {
  row: LinkedSourceRow
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
  onOpen?: (row: LinkedSourceRow) => void
  onSummarize?: (row: SourceRowData) => void
  /** Closes the surface holding the row before an action opens a dialog, which it would cover. */
  onLeave?: () => void
}

export function SourceRow({ row, onOpen, onSummarize, onLeave }: SourceRowProps) {
  const { copy } = useClipboard()
  const LinkActions = useContext(ActionsHost) ?? BaseSourceActions
  const { url } = row
  const title = <OverflowText text={row.title}>{row.title}</OverflowText>
  const summarize: MenuAction[] = onSummarize
    ? [{ id: 'summarize', label: 'Summarize', onSelect: () => onSummarize(row) }]
    : []
  const heading = row.unavailable ? (
    <>
      <span className={styles.unavailable} data-type='T048'>
        {title}
      </span>
      <StatusText label='Unavailable' />
    </>
  ) : url ? (
    <a
      className={styles.title}
      data-type='T048'
      data-source-link=''
      href={url}
      target='_blank'
      rel='noopener noreferrer'
      onClick={(event) => {
        onOpen?.({ ...row, url })
        onExternalLinkClick(event, url)
      }}
    >
      {title}
    </a>
  ) : (
    <span className={styles.title} data-type='T048'>
      {title}
    </span>
  )
  const actions = row.unavailable ? null : url ? (
    <LinkActions
      row={{ ...row, url }}
      onLeave={onLeave}
      actions={[
        ...summarize,
        {
          id: 'copy',
          label: 'Copy link',
          onSelect: () =>
            void copy(url).then((copied) => {
              if (!copied) toast.error('Unable to copy link')
            }),
        },
      ]}
    />
  ) : (
    summarize.length > 0 && <SourceActionsMenu row={row} actions={summarize} />
  )
  return (
    <article className={styles.row}>
      <ActivityBody>
        {heading}
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
      {actions}
    </article>
  )
}
