'use client'

import type { ReactElement, ReactNode } from 'react'
import { ControlRow } from '#emcn/components/button/control-row'
import type { IconName } from '#emcn/components/icon/icon'

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
