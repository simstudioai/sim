import { ComponentRecipe } from '@/platform/design-system/catalog/component-recipe'
import styles from '@/platform/design-system/components/collections.module.css'
import { ScrollArea } from '@/platform/design-system/components/scroll-area'

interface WorkspaceItemsProps {
  label: string
  items: readonly { id: string; name: string }[]
  theme: 'light' | 'dark'
}

interface WorkspaceListProps extends WorkspaceItemsProps {
  target?: 'standard' | 'touch'
}

export function WorkspaceList({ label, items, theme, target = 'standard' }: WorkspaceListProps) {
  return (
    <section className={styles.workspaces} data-target={target}>
      <h3 className={styles.heading} data-type='T067'>
        {label}
      </h3>
      <div className={styles.workspaceViewport}>
        <ScrollArea label={label}>
          <ul className={styles.rows} aria-label={label}>
            {items.map((item) => (
              <li className={styles.workspaceRow} key={item.id}>
                <ComponentRecipe
                  recipe={theme === 'light' ? 'C1282' : 'C1281'}
                  slots={{ label: item.name }}
                />
              </li>
            ))}
          </ul>
        </ScrollArea>
      </div>
    </section>
  )
}

export function SidebarWorkspaceItems({ label, items, theme }: WorkspaceItemsProps) {
  return (
    <ul className={styles.rows} aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <ComponentRecipe
            recipe={theme === 'light' ? 'C1056' : 'C1051'}
            slots={{ label: item.name }}
          />
        </li>
      ))}
    </ul>
  )
}
