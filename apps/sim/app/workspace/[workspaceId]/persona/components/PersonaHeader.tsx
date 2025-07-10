import Link from 'next/link'
import { UsersIcon } from '@/components/icons'

interface BreadcrumbItem {
  label: string
  href?: string
  id?: string
}

const HEADER_STYLES = {
  container: 'flex items-center justify-between px-6 pt-[14px] pb-6',
  breadcrumbs: 'flex items-center gap-2',
  icon: 'h-[18px] w-[18px] text-muted-foreground transition-colors group-hover:text-muted-foreground/70',
  link: 'group flex items-center gap-2 font-medium text-sm transition-colors hover:text-muted-foreground',
  label: 'font-medium text-sm',
  separator: 'text-muted-foreground',
  actionsContainer: 'flex h-8 w-8 items-center justify-center',
} as const

interface PersonaHeaderProps {
  breadcrumbs: BreadcrumbItem[]
}

export function PersonaHeader({ breadcrumbs }: PersonaHeaderProps) {
  return (
    <div className={HEADER_STYLES.container}>
      <div className={HEADER_STYLES.breadcrumbs}>
        {breadcrumbs.map((breadcrumb, index) => {
          const key = breadcrumb.id || `${breadcrumb.label}-${breadcrumb.href || index}`
          return (
            <div key={key} className='flex items-center gap-2'>
              {index === 0 && <UsersIcon className={HEADER_STYLES.icon} />}
              {breadcrumb.href ? (
                <Link href={breadcrumb.href} prefetch={true} className={HEADER_STYLES.link}>
                  <span>{breadcrumb.label}</span>
                </Link>
              ) : (
                <span className={HEADER_STYLES.label}>{breadcrumb.label}</span>
              )}
              {index < breadcrumbs.length - 1 && <span className={HEADER_STYLES.separator}>/</span>}
            </div>
          )
        })}
      </div>
      <div className={HEADER_STYLES.actionsContainer}>{/* Reserved for future actions */}</div>
    </div>
  )
}
