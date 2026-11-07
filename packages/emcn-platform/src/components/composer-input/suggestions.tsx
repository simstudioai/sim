'use client'

import { Fragment, type RefObject, useEffect, useRef } from 'react'
import { Popover } from '@base-ui/react/popover'
import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import { Icon } from '@sim/emcn/icon'
import popup from '@sim/emcn/menu/popup.shared.module.css'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import styles from '#platform/components/composer-input/suggestions.module.css'

interface SuggestionItem {
  name: string
  group: string
  icon: IconName
  providerId?: string
  workspaceName?: string
}

interface ComposerSuggestionsProps {
  label: string
  empty: string
  id: string
  items: readonly SuggestionItem[]
  active: number
  onHighlight: (index: number) => void
  onSelect: (index: number) => void
  onDismiss: () => void
  anchor: RefObject<HTMLSpanElement | null>
  input: RefObject<HTMLTextAreaElement | null>
  grouped: boolean
}

/** A listbox controlled from a still-focused, multiline editor. */
export function ComposerSuggestions({
  label,
  empty,
  id,
  items,
  active,
  onHighlight,
  onSelect,
  onDismiss,
  anchor,
  input,
  grouped,
}: ComposerSuggestionsProps) {
  const list = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges('vertical', { viewport: list })
  const current = items[active]
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, current])
  const container = input.current?.closest<HTMLElement>('dialog, [data-platform-ui]')
  if (!container) return null
  return (
    <Popover.Root
      open
      modal={false}
      onOpenChange={(open, details) => {
        if (!open && details.event.target !== input.current) onDismiss()
      }}
    >
      <Popover.Portal container={container}>
        <Popover.Positioner
          className={popup.positioner}
          anchor={anchor}
          align='start'
          side='top'
          sideOffset={8}
          collisionPadding={8}
          positionMethod='fixed'
        >
          <Popover.Popup
            className={styles.popup}
            role='presentation'
            initialFocus={false}
            finalFocus={false}
            data-material='floating'
            data-elevation='menu'
          >
            <div ref={edges} className={popup.list} id={id} role='listbox' aria-label={label}>
              {items.map((item, index) => (
                <Fragment key={`${item.group}:${item.workspaceName ?? ''}:${item.name}:${index}`}>
                  {grouped && item.group !== items[index - 1]?.group && (
                    <div className={popup.heading} role='presentation' data-type='T052'>
                      {item.group}
                    </div>
                  )}
                  <div
                    role='option'
                    id={`${id}-${index}`}
                    className={popup.item}
                    aria-selected={active === index}
                    data-highlighted={active === index ? '' : undefined}
                    data-type='T060'
                    onMouseDown={(event) => event.preventDefault()}
                    onPointerMove={() => onHighlight(index)}
                    onClick={() => onSelect(index)}
                  >
                    {item.providerId ? (
                      <Icon providerId={item.providerId} />
                    ) : (
                      <Icon name={item.icon} />
                    )}
                    <span className={popup.label}>{item.name}</span>
                    {item.workspaceName && (
                      <span className={styles.detail} data-type='T052'>
                        {item.workspaceName}
                      </span>
                    )}
                  </div>
                </Fragment>
              ))}
              {!items.length && (
                <div role='status' className={styles.empty} data-type='T052'>
                  {empty}
                </div>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
