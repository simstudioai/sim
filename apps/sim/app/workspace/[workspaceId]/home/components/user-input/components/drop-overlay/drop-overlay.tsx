'use client'

import { memo } from 'react'
import { ImageUp } from '@sim/emcn/icons'
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

interface DropOverlayProps {
  imagesOnly?: boolean
}

export const DropOverlay = memo(function DropOverlay({ imagesOnly = false }: DropOverlayProps) {
  return (
    <div className='pointer-events-none absolute inset-[6px] z-10 flex items-center justify-center rounded-[14px] border-[1.5px] border-[var(--border-1)] border-dashed bg-[var(--white)] dark:bg-[var(--surface-4)]'>
      <div className='flex flex-col items-center gap-2'>
        <span className='text-[13px] text-[var(--text-secondary)]'>
          {imagesOnly ? 'Drop images' : 'Drop files'}
        </span>
        <div className='flex items-center gap-2 text-[var(--text-icon)]'>
          {(imagesOnly ? [ImageUp] : DROP_OVERLAY_ICONS).map((Icon, i) => (
            <Icon key={i} className='size-[14px]' />
          ))}
        </div>
      </div>
    </div>
  )
})
