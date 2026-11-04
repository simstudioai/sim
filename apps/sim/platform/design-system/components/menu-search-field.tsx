import type { ReactElement } from 'react'
import styles from '@/platform/design-system/components/choices.module.css'
import { Icon } from '@/platform/design-system/components/icon'

type MenuSearchFieldProps =
  | { label: string; input?: never }
  | { input: ReactElement; label?: never }

export function MenuSearchField({ input, label }: MenuSearchFieldProps) {
  return (
    <div className={styles.menuSearch} data-type='T060'>
      <Icon name='I089' />
      {input ?? <input type='search' aria-label={label} placeholder={label} />}
    </div>
  )
}
