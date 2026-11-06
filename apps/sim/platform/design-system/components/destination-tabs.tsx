import Link from 'next/link'
import { ScrollArea } from '@/platform/design-system/components/scroll-area'
import styles from '@/platform/design-system/components/workspace.module.css'

interface DestinationTabsProps {
  label: string
  destinations: readonly { label: string; href: string }[]
  currentHref: string
}

export function DestinationTabs({ label, destinations, currentHref }: DestinationTabsProps) {
  return (
    <nav aria-label={label} className={styles.destinations}>
      <ScrollArea label={label} axis='horizontal' arrows>
        <div className={styles.lane}>
          {destinations.map(({ label: text, href }) => (
            <Link
              key={href}
              href={href}
              scroll={false}
              className={styles.destination}
              aria-current={href === currentHref ? 'page' : undefined}
              data-type='T043'
            >
              {text}
            </Link>
          ))}
        </div>
      </ScrollArea>
    </nav>
  )
}
