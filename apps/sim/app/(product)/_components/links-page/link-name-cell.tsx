'use client'

import { TableLabel } from '@sim/emcn/data-display'
import { Icon } from '@sim/emcn/icon'
import { OverflowText } from '@sim/emcn/overflow-text'
import { Favicon } from '@/components/favicon/favicon'
import styles from '@/app/(product)/_components/links-page/links-page.module.css'
import { type LinkRecord, linkHost } from '@/platform/lib/data/links'

/** How the link is shared beyond the default: open to everyone and editable by any member. */
export function accessLabel(link: LinkRecord): string | null {
  const limits = [link.unlisted && 'Unlisted', link.restrictEdit && 'Restricted'].filter(Boolean)
  return limits.length ? limits.join(', ') : null
}

interface LinkSummaryProps {
  link: LinkRecord
  updated: string
}

/**
 * What the table's hidden columns would say, under the name, so a narrow table loses nothing. Access
 * leads its line, where truncation cannot take it.
 */
function LinkSummary({ link, updated }: LinkSummaryProps) {
  const facts = [accessLabel(link), link.createdBy?.name, updated].filter(Boolean).join(' · ')
  return (
    <span className={styles.summary} data-type='T052'>
      <span className={styles.summaryDestination}>
        <OverflowText text={link.url}>{link.url}</OverflowText>
      </span>
      {link.description && <OverflowText text={link.description}>{link.description}</OverflowText>}
      <OverflowText text={facts}>{facts}</OverflowText>
    </span>
  )
}

interface LinkNameCellProps {
  link: LinkRecord
  /** The relative time the Updated column shows, repeated in the summary. */
  updated: string
}

/** The Name column: the link's favicon and name, with the summary narrow widths fold into it. */
export function LinkNameCell({ link, updated }: LinkNameCellProps) {
  return (
    <TableLabel leading={<Favicon host={linkHost(link)} fallback={<Icon name='I041' />} />}>
      <span className={styles.nameCell}>
        <OverflowText text={link.name}>{link.name}</OverflowText>
        <LinkSummary link={link} updated={updated} />
      </span>
    </TableLabel>
  )
}
