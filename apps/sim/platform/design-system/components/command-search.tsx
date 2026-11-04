'use client'

import { Autocomplete } from '@base-ui/react/autocomplete'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import styles from '@/platform/design-system/components/command-search.module.css'
import { Icon } from '@/platform/design-system/components/icon'

interface SearchDestination {
  id: string
  label: string
  icon: IconName
  href: string
}

interface CommandSearchProps {
  items: readonly SearchDestination[]
  onSelect: (href: string) => void
}

export function CommandSearch({ items, onSelect }: CommandSearchProps) {
  return (
    <Autocomplete.Root
      items={items}
      inline
      open
      autoHighlight
      itemToStringValue={(item) => item.label}
    >
      <div className={styles.field}>
        <Icon name='I089' />
        <Autocomplete.Input
          aria-label='Search the platform'
          placeholder='Search the platform…'
          data-type='T094'
        />
      </div>
      <Autocomplete.Empty className={styles.empty} data-type='T052'>
        No results found
      </Autocomplete.Empty>
      <Autocomplete.List aria-label='Search results' className={styles.results}>
        {(item: SearchDestination) => (
          <Autocomplete.Item
            key={item.id}
            value={item}
            className={styles.result}
            data-type='T043'
            onClick={() => onSelect(item.href)}
          >
            <Icon name={item.icon} />
            {item.label}
          </Autocomplete.Item>
        )}
      </Autocomplete.List>
    </Autocomplete.Root>
  )
}
