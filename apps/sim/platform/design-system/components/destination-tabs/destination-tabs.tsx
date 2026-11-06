import Link from 'next/link'
import { ControlRow } from '@/platform/design-system/components/button/control-row'
import styles from '@/platform/design-system/components/destination-tabs/destination-tabs.module.css'
import { ScrollArea } from '@/platform/design-system/components/scroll-area/scroll-area'
import listStyles from '@/platform/design-system/components/tabs/tab-list.shared.module.css'

interface DestinationTabsProps {
  label: string
  destinations: readonly { label: string; href: string }[]
  currentHref: string
}

export function DestinationTabs({ label, destinations, currentHref }: DestinationTabsProps) {
  return (
    <nav aria-label={label} className={styles.destinations}>
      <ScrollArea label={label} axis='horizontal' arrows>
        <div className={listStyles.lane}>
          {destinations.map(({ label: text, href }) => (
            <ControlRow
              key={href}
              label={text}
              render={
                <Link
                  href={href}
                  scroll={false}
                  aria-current={href === currentHref ? 'page' : undefined}
                />
              }
            />
          ))}
        </div>
      </ScrollArea>
    </nav>
  )
}
