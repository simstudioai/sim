'use client'

import type { ReactElement } from 'react'
import { Icon } from '#emcn/components/icon/icon'
import { useScrollEdges } from '#emcn/components/scroll-area/use-scroll-edges'
import styles from '#emcn/components/search-field/search-field.module.css'

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
