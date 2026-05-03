'use client'

import type React from 'react'
import {
  Calendar as CalendarIcon,
  TypeBoolean,
  TypeJson,
  TypeNumber,
  TypeText,
} from '@/components/emcn/icons'
import type { BlockIconInfo } from '../types'

export const COLUMN_TYPE_ICONS: Record<string, React.ElementType> = {
  string: TypeText,
  number: TypeNumber,
  boolean: TypeBoolean,
  date: CalendarIcon,
  json: TypeJson,
}

interface ColumnTypeIconProps {
  type: string
  workflowColor?: string
  blockIconInfo?: BlockIconInfo
}

/**
 * Tiny icon shown next to a column header. For workflow-output columns:
 * the producing block's icon (when known) or a colored swatch tinted with
 * the workflow's color. For plain columns: the type icon.
 */
export function ColumnTypeIcon({ type, workflowColor, blockIconInfo }: ColumnTypeIconProps) {
  if (workflowColor || blockIconInfo) {
    if (blockIconInfo) {
      const BlockIcon = blockIconInfo.icon
      return (
        <span
          className='flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px]'
          style={{ background: blockIconInfo.color }}
        >
          <BlockIcon className='!text-white h-[12px] w-[12px]' />
        </span>
      )
    }
    const color = workflowColor ?? 'var(--text-muted)'
    return (
      <span
        className='h-3 w-3 shrink-0 rounded-sm border-[2px]'
        style={{
          backgroundColor: color,
          borderColor: workflowColor ? `${workflowColor}60` : 'var(--border)',
          backgroundClip: 'padding-box',
        }}
      />
    )
  }
  const Icon = COLUMN_TYPE_ICONS[type] ?? TypeText
  return <Icon className='h-3 w-3 shrink-0 text-[var(--text-icon)]' />
}
