'use client'

import { Autocomplete } from '@base-ui/react/autocomplete'
import styles from '#emcn/components/command-palette/command-palette.module.css'
import type { IconName } from '#emcn/components/icon/icon'
import { Icon } from '#emcn/components/icon/icon'
import popup from '#emcn/components/menu/popup.shared.module.css'
import { useScrollEdges } from '#emcn/components/scroll-area/use-scroll-edges'

interface Command {
  id: string
  label: string
  icon?: IconName
  value: string
}

interface CommandGroup {
  label?: string
  items: readonly Command[]
}

interface CommandPaletteProps {
  groups: readonly CommandGroup[]
  label: string
  onSelect: (value: string) => void
}

export function CommandPalette({ groups, label, onSelect }: CommandPaletteProps) {
  const scrollEdges = useScrollEdges<HTMLDivElement>()
  const queryEdges = useScrollEdges<HTMLInputElement>('horizontal')
  return (
    <Autocomplete.Root
      items={groups.filter((group) => group.items.length > 0)}
      inline
      open
      autoHighlight='always'
      itemToStringValue={(item) => item.label}
    >
      <div className={styles.field} data-type='T094'>
        <Icon name='I089' />
        <Autocomplete.Input ref={queryEdges} aria-label={label} placeholder={`${label}…`} />
      </div>
      <Autocomplete.Empty className={styles.empty} data-type='T052'>
        No results
      </Autocomplete.Empty>
      <Autocomplete.List ref={scrollEdges} aria-label='Search results' className={styles.results}>
        {(group: CommandGroup) => (
          <Autocomplete.Group key={group.label ?? ''} items={group.items} className={styles.group}>
            {group.label && (
              <Autocomplete.GroupLabel className={popup.heading} data-type='T052'>
                {group.label}
              </Autocomplete.GroupLabel>
            )}
            <Autocomplete.Collection>
              {(item: Command) => (
                <Autocomplete.Item
                  key={item.id}
                  value={item}
                  className={popup.item}
                  data-type='T060'
                  onClick={() => onSelect(item.value)}
                >
                  {item.icon && <Icon name={item.icon} />}
                  <span className={popup.label}>{item.label}</span>
                </Autocomplete.Item>
              )}
            </Autocomplete.Collection>
          </Autocomplete.Group>
        )}
      </Autocomplete.List>
      <footer className={styles.footer} data-type='T052'>
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Navigate
        </span>
        <span>
          <kbd>esc</kbd> Close
        </span>
        <span>
          <kbd>↵</kbd> Select
        </span>
      </footer>
    </Autocomplete.Root>
  )
}
