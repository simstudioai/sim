'use client'

import type { ReactElement, ReactNode } from 'react'
import { useRender } from '@base-ui/react/use-render'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { Icon } from '@/platform/design-system/components/icon/icon'
import styles from '@/platform/design-system/components/identity-button/identity-button.module.css'
import { OverflowText } from '@/platform/design-system/components/overflow-text/overflow-text'

interface IdentityButtonProps {
  label: string
  children?: string
  leading?: ReactNode
  trailingIcon?: IconName
  onClick?: () => void
  render?: ReactElement
}

export function IdentityButton({
  label,
  children,
  leading,
  trailingIcon,
  onClick,
  render,
}: IdentityButtonProps) {
  return useRender({
    defaultTagName: 'button',
    render,
    props: {
      type: 'button',
      className: styles.button,
      'aria-label': label,
      'data-type': 'T043',
      onClick,
      children: (
        <>
          {leading}
          {children && (
            <span className={styles.name}>
              <OverflowText text={children}>{children}</OverflowText>
            </span>
          )}
          {trailingIcon && <Icon name={trailingIcon} />}
        </>
      ),
    },
  })
}
