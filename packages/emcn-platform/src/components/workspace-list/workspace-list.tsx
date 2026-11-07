import { ControlRow } from '@sim/emcn/button/control-row'
import { ScrollArea } from '@sim/emcn/scroll-area'
import styles from '#platform/components/workspace-list/workspace-list.module.css'

interface WorkspaceItemsProps {
  label: string
  items: readonly { id: string; name: string }[]
}

interface WorkspaceListProps extends WorkspaceItemsProps {
  onSelect?: (id: string) => void
  target?: 'standard' | 'touch'
}

export function WorkspaceList({ label, items, onSelect, target = 'standard' }: WorkspaceListProps) {
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
                <ControlRow
                  label={item.name}
                  wrap
                  render={
                    onSelect ? <button type='button' onClick={() => onSelect(item.id)} /> : <span />
                  }
                />
              </li>
            ))}
          </ul>
        </ScrollArea>
      </div>
    </section>
  )
}

export function SidebarWorkspaceItems({ label, items }: WorkspaceItemsProps) {
  return (
    <ul className={styles.rows} aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <ControlRow label={item.name} render={<span />} />
        </li>
      ))}
    </ul>
  )
}
