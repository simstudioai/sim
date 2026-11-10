'use client'

import { type ComponentProps, Fragment, type RefObject, useEffect, useRef } from 'react'
import { Popover } from '@base-ui/react/popover'
import { Icon, type IconName } from '@sim/emcn/icon'
import popup from '@sim/emcn/menu/popup.shared.module.css'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import styles from '#platform/components/composer-input/suggestions.module.css'

interface SuggestionItem {
  name: string
  group: string
  icon?: IconName
  providerId?: string
  workspaceName?: string
  /** A keyboard shortcut, shown at the row's end as a menu shows one. */
  shortcut?: string
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
  /** Where the trigger sits: an element in the field, or a virtual rect such as an editor caret's. */
  anchor: ComponentProps<typeof Popover.Positioner>['anchor']
  /** The still-focused field driving the list: a textarea, or a rich text editor's root. */
  input: RefObject<HTMLElement | null>
  grouped: boolean
  /** Opens above the anchor, as a composer at the window's foot does, or below it inline. */
  side?: 'top' | 'bottom'
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
  side = 'top',
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
        const target = details.event.target
        if (!open && !(target instanceof Node && input.current?.contains(target))) onDismiss()
      }}
    >
      <Popover.Portal container={container}>
        <Popover.Positioner
          className={popup.positioner}
          anchor={anchor}
          align='start'
          side={side}
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
                      item.icon && <Icon name={item.icon} />
                    )}
                    <span className={popup.label}>{item.name}</span>
                    {item.workspaceName && (
                      <span className={styles.detail} data-type='T052'>
                        {item.workspaceName}
                      </span>
                    )}
                    {item.shortcut && (
                      <kbd className={styles.detail} data-type='T052'>
                        {item.shortcut}
                      </kbd>
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
