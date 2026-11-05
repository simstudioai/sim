'use client'

import { Autocomplete } from '@base-ui/react/autocomplete'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import styles from '@/platform/design-system/components/command-palette/command-palette.module.css'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

interface Command {
  id: string
  label: string
  icon: IconName
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
        No results found
      </Autocomplete.Empty>
      <Autocomplete.List ref={scrollEdges} aria-label='Search results' className={styles.results}>
        {(group: CommandGroup) => (
          <Autocomplete.Group key={group.label ?? ''} items={group.items} className={styles.group}>
            {group.label && (
              <Autocomplete.GroupLabel className={styles.heading} data-type='T052'>
                {group.label}
              </Autocomplete.GroupLabel>
            )}
            <Autocomplete.Collection>
              {(item: Command) => (
                <Autocomplete.Item
                  key={item.id}
                  value={item}
                  className={styles.result}
                  data-type='T043'
                  onClick={() => onSelect(item.value)}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
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
