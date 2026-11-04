import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import styles from '@/platform/design-system/components/collections.module.css'
import { Icon } from '@/platform/design-system/components/icon'
import { ScrollArea } from '@/platform/design-system/components/scroll-area'

export interface RecentItem {
  id: string
  label: string
  icon: IconName
}

interface RecentItemsProps {
  label: string
  title?: string
  items: readonly RecentItem[]
}

export function RecentItems({ label, title = label, items }: RecentItemsProps) {
  return (
    <section className={styles.recents}>
      <h3 className={styles.heading} data-type='T067'>
        {title}
      </h3>
      <ScrollArea axis='horizontal' arrows label={label}>
        <ul className={styles.recentLane} aria-label={label}>
          {items.map((item) => (
            <li key={item.id} className={styles.recentItem} data-type='T067'>
              <Icon name={item.icon} />
              {item.label}
            </li>
          ))}
        </ul>
      </ScrollArea>
    </section>
  )
}
