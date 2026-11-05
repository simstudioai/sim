'use client'

import type { ReactElement, ReactNode } from 'react'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { ControlRow } from '@/platform/design-system/components/button/control-row'

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
  return (
    <ControlRow
      render={render ?? <button type='button' />}
      accessibleLabel={label}
      label={children}
      leading={leading}
      trailingIcon={trailingIcon}
      onClick={onClick}
    />
  )
}
