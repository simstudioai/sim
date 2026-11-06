'use client'

import { memo, type ReactNode, useState } from 'react'
import { toast } from '@sim/emcn'
import {
  useOpenSimLinkForm,
  useSimLinkOrganizationId,
} from '@/app/o/[organizationId]/links/sim-link-organization-provider'
import { useExistingSimLink } from '@/app/o/[organizationId]/links/sim-link-shortcut'
import {
  highlightTerms,
  sourceMeta,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card/source-card'
import {
  SourceIcon,
  sourceLabel,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-chip'
import { useSourceNavigation } from '@/app/workspace/[workspaceId]/home/components/message-content/components/source-history-context'
import type { SourceTagData } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags'
import { useHydrated } from '@/hooks/use-hydrated'
import { useClipboard } from '@/platform/design-system/components/feedback/use-clipboard'
import { ActionMenu, type MenuAction } from '@/platform/design-system/components/menu/action-menu'
import { OverflowText } from '@/platform/design-system/components/overflow-text/overflow-text'
import styles from '@/platform/embedded/app/(shell)/_components/search/search.module.css'

/**
 * The Sim link entry of a source's menu: copies the link that already opens this address, or offers
 * to create one. It looks up only while the menu is open, and fails closed: a failed lookup offers
 * nothing rather than risk a duplicate. The form opens at the layout root, outside the menu.
 */
function useSimLinkAction(source: SourceTagData, menuOpen: boolean): MenuAction | null {
  const organizationId = useSimLinkOrganizationId()
  const openForm = useOpenSimLinkForm()
  const { existing, isPending, isError, copyExisting } = useExistingSimLink(
    organizationId ?? '',
    source.url,
    menuOpen
  )
  if (!organizationId || isError) return null
  if (existing) {
    return {
      id: 'sim-link',
      label: `Copy sim/${existing.name}`,
      icon: 'I006',
      onSelect: async () => {
        if (await copyExisting()) toast.success(`Copied sim/${existing.name}`)
      },
    }
  }
  return {
    id: 'sim-link',
    label: 'Create link',
    icon: 'I074',
    disabled: isPending,
    onSelect: () => openForm(source.url, sourceLabel(source)),
  }
}

interface SourceActionsProps {
  source: SourceTagData
  onSummarize?: (source: SourceTagData) => void
}

function SourceActions({ source, onSummarize }: SourceActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { copied, copy } = useClipboard()
  const simLinkAction = useSimLinkAction(source, menuOpen)
  return (
    <ActionMenu
      label={copied ? 'Link copied' : `Actions for ${sourceLabel(source)}`}
      icon={copied ? 'I072' : 'I108'}
      align='end'
      tooltip={false}
      open={menuOpen}
      onOpenChange={setMenuOpen}
      actions={[
        ...(onSummarize
          ? [
              {
                id: 'summarize',
                label: 'Summarize',
                icon: 'I075',
                onSelect: () => onSummarize(source),
              } as const,
            ]
          : []),
        {
          id: 'copy-link',
          label: 'Copy link',
          icon: 'I006',
          onSelect: async () => {
            if (!(await copy(source.url))) toast.error('Unable to copy link')
          },
        },
        ...(simLinkAction ? [simLinkAction] : []),
      ]}
    />
  )
}

interface SourceLinkProps {
  source: SourceTagData
  /** One line, for recent activity. */
  compact?: boolean
  children: ReactNode
}

/** Opens the document in a new tab and records the view; arrow keys move between these links. */
function SourceLink({ source, compact, children }: SourceLinkProps) {
  const navigate = useSourceNavigation(source)
  return (
    <a
      className={compact ? styles.compactTitle : styles.title}
      data-type={compact ? 'T060' : 'T048'}
      data-source-link=''
      href={source.url}
      target='_blank'
      rel='noopener noreferrer'
      onClick={navigate}
      onAuxClick={navigate}
    >
      {children}
    </a>
  )
}

function SourceMark({ source }: { source: SourceTagData }) {
  return (
    <span className={styles.mark}>
      <SourceIcon source={source} />
    </span>
  )
}

interface SourceRowProps {
  source: SourceTagData
  /** The query the document was found for; its terms are bolded in the snippet. */
  query?: string
  onSummarize?: (source: SourceTagData) => void
}

/** One search result: where it lives, why it matched, and what can be done with it. */
export function SourceRow({ source, query, onSummarize }: SourceRowProps) {
  const meta = sourceMeta(source)
  return (
    <div className={styles.row}>
      <SourceMark source={source} />
      <div className={styles.rowBody}>
        <SourceLink source={source}>{sourceLabel(source)}</SourceLink>
        <span className={styles.meta} data-type='T052'>
          <OverflowText text={meta}>{meta}</OverflowText>
        </span>
        {source.snippet && (
          <p className={styles.snippet} data-type='T060'>
            {highlightTerms(source.snippet, query, styles.term)}
          </p>
        )}
      </div>
      <SourceActions source={source} onSummarize={onSummarize} />
    </div>
  )
}

/**
 * A source as one line, for recent activity. Memoized because the field's draft lives above it, so
 * every keystroke would otherwise re-render each row's menu and overflow measurement.
 */
export const CompactSourceRow = memo(function CompactSourceRow({
  source,
}: {
  source: SourceTagData
}) {
  const label = sourceLabel(source)
  // Its date is in the viewer's zone, which the server cannot render.
  const meta = sourceMeta(useHydrated() ? source : { ...source, updatedAt: undefined })
  return (
    <div className={styles.compactRow}>
      <SourceMark source={source} />
      <SourceLink source={source} compact>
        <OverflowText text={label}>{label}</OverflowText>
      </SourceLink>
      <span className={styles.compactMeta} data-type='T052'>
        <OverflowText text={meta}>{meta}</OverflowText>
      </span>
      <SourceActions source={source} />
    </div>
  )
})
