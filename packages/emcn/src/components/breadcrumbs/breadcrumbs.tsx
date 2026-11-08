'use client'

import { type DragEvent, Fragment, useState } from 'react'
import Link from 'next/link'
import styles from '#emcn/components/breadcrumbs/breadcrumbs.module.css'
import { Button } from '#emcn/components/button/button'
import { Icon } from '#emcn/components/icon/icon'
import { ActionMenu, type MenuAction } from '#emcn/components/menu/action-menu'
import { OverflowText } from '#emcn/components/overflow-text/overflow-text'

export interface BreadcrumbItem {
  id: string
  label: string
  /** Where an ancestor leads. The last item is the current location and never links. */
  href?: string
  /** Commands on the current location, such as Rename or Delete, offered from its crumb. */
  actions?: readonly MenuAction[]
  /** Lets dragged items land on this location, such as rows moved into a folder. */
  drop?: {
    accepts: (event: DragEvent<HTMLElement>) => boolean
    onDrop: (event: DragEvent<HTMLElement>) => void
  }
}

interface BreadcrumbsProps {
  /** Names the trail for assistive technology, such as "Location". */
  label: string
  items: readonly BreadcrumbItem[]
}

/** Ancestors kept beside the current location before the middle of a deep path collapses. */
const TRAILING_ANCESTORS = 1

type TrailEntry =
  | { kind: 'item'; item: BreadcrumbItem }
  | { kind: 'more'; hidden: BreadcrumbItem[] }

/**
 * Keeps the first location and the last two in view. Anything between them moves into one "…"
 * menu, so a path of any depth fits the trail on one line.
 */
function trailEntries(items: readonly BreadcrumbItem[]): TrailEntry[] {
  const keep = TRAILING_ANCESTORS + 2
  if (items.length <= keep + 1) return items.map((item) => ({ kind: 'item', item }))
  const [first, ...rest] = items
  const tail = rest.slice(rest.length - (keep - 1))
  const hidden = rest.slice(0, rest.length - tail.length)
  return [
    { kind: 'item', item: first },
    { kind: 'more', hidden },
    ...tail.map((item): TrailEntry => ({ kind: 'item', item })),
  ]
}

/**
 * Where the reader is and the way back up: each ancestor is a compact quiet button, the current
 * location reads in place or opens its commands, and a deep path folds its middle into a menu.
 */
export function Breadcrumbs({ label, items }: BreadcrumbsProps) {
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const last = items.at(-1)
  return (
    <nav aria-label={label} className={styles.trail}>
      <ol className={styles.list}>
        {trailEntries(items).map((entry, index) => {
          const key = entry.kind === 'more' ? 'more' : entry.item.id
          const current = entry.kind === 'item' && entry.item === last
          const drop = entry.kind === 'item' ? entry.item.drop : undefined
          return (
            <li
              key={key}
              className={styles.item}
              data-current={current || undefined}
              aria-current={current ? 'page' : undefined}
            >
              {index > 0 && (
                <span className={styles.separator} data-type='T060' aria-hidden='true'>
                  <Icon name='I032' />
                </span>
              )}
              <span
                className={styles.crumb}
                data-drop-target={(drop && dropTarget === key) || undefined}
                onDragOver={
                  drop &&
                  ((event) => {
                    if (!drop.accepts(event)) return
                    event.preventDefault()
                    setDropTarget(key)
                  })
                }
                onDragLeave={drop && (() => setDropTarget(null))}
                onDrop={
                  drop &&
                  ((event) => {
                    setDropTarget(null)
                    if (!drop.accepts(event)) return
                    event.preventDefault()
                    drop.onDrop(event)
                  })
                }
              >
                <Fragment>
                  {entry.kind === 'more' ? (
                    <ActionMenu
                      label={`${entry.hidden.length} more locations`}
                      triggerText='…'
                      actions={entry.hidden.map((item) => ({
                        id: item.id,
                        label: item.label,
                        href: item.href,
                      }))}
                    />
                  ) : current && entry.item.actions?.length ? (
                    <ActionMenu
                      label={`${entry.item.label} options`}
                      triggerText={entry.item.label}
                      actions={entry.item.actions}
                    />
                  ) : current || !entry.item.href ? (
                    <span className={styles.current} data-type='T060'>
                      <OverflowText text={entry.item.label}>{entry.item.label}</OverflowText>
                    </span>
                  ) : (
                    <Button variant='quiet' size='compact' render={<Link href={entry.item.href} />}>
                      {entry.item.label}
                    </Button>
                  )}
                </Fragment>
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
