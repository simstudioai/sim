import { IconButton } from '@sim/emcn/button'
import { ControlRow } from '@sim/emcn/button/control-row'
import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import { ScrollArea } from '@sim/emcn/scroll-area'
import Link from 'next/link'
import styles from '#platform/components/recent-items/recent-items.module.css'

export interface RecentItem {
  id: string
  label: string
  icon?: IconName
  /** An external link opens independently of the current workspace. */
  href?: string
}

interface RecentItemsProps {
  label: string
  title?: string
  onSelect?: (id: string) => void
  onRemove?: (id: string) => void
  items: readonly RecentItem[]
}

export function RecentItems({ label, title = label, items, onSelect, onRemove }: RecentItemsProps) {
  return (
    <section className={styles.recents}>
      <h3 className={styles.heading} data-type='T067'>
        {title}
      </h3>
      <ScrollArea axis='horizontal' arrows label={label}>
        <ul className={styles.recentLane} aria-label={label}>
          {items.map((item) => (
            <li key={item.id}>
              <ControlRow
                label={item.label}
                icon={item.icon}
                actionSide={item.icon ? 'start' : 'end'}
                render={
                  item.href ? (
                    <Link href={item.href} target='_blank' rel='noopener noreferrer' />
                  ) : onSelect ? (
                    <button type='button' onClick={() => onSelect(item.id)} />
                  ) : (
                    <span />
                  )
                }
                action={
                  onRemove && (
                    <IconButton
                      icon='I105'
                      size='compact'
                      label={`Remove ${item.label} from recents`}
                      onClick={() => onRemove(item.id)}
                    />
                  )
                }
              />
            </li>
          ))}
        </ul>
      </ScrollArea>
    </section>
  )
}
