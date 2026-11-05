'use client'

import type { ReactElement } from 'react'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import styles from '@/platform/design-system/components/search-field/search-field.module.css'

type MenuSearchFieldProps =
  | { label: string; input?: never }
  | { input: ReactElement; label?: never }

export function MenuSearchField({ input, label }: MenuSearchFieldProps) {
  const queryEdges = useScrollEdges<HTMLInputElement>('horizontal')
  return (
    <div className={styles.menuSearch} data-type='T060'>
      <Icon name='I089' />
      {input ?? <input ref={queryEdges} type='search' aria-label={label} placeholder={label} />}
    </div>
  )
}
