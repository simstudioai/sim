'use client'

import React from 'react'
import {
  AudioIcon,
  CsvIcon,
  DocxIcon,
  JsonIcon,
  MarkdownIcon,
  PdfIcon,
  TxtIcon,
  VideoIcon,
  XlsxIcon,
} from '@/components/icons/document-icons'

const DROP_OVERLAY_ICONS = [
  PdfIcon,
  DocxIcon,
  XlsxIcon,
  CsvIcon,
  TxtIcon,
  MarkdownIcon,
  JsonIcon,
  AudioIcon,
  VideoIcon,
] as const

export const DropOverlay = React.memo(function DropOverlay() {
  return (
    <div className='pointer-events-none absolute inset-[6px] z-10 flex items-center justify-center rounded-[14px] border-[1.5px] border-[var(--border-1)] border-dashed bg-[var(--white)] dark:bg-[var(--surface-4)]'>
      <div className='flex flex-col items-center gap-[8px]'>
        <span className='font-medium text-[13px] text-[var(--text-secondary)]'>Drop files</span>
        <div className='flex items-center gap-[8px] text-[var(--text-icon)]'>
          {DROP_OVERLAY_ICONS.map((Icon, i) => (
            <Icon key={i} className='h-[14px] w-[14px]' />
          ))}
        </div>
      </div>
    </div>
  )
})
