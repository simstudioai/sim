'use client'

import type { ReactNode } from 'react'
import { FILTER_SECTION_LABEL_CLASS } from '@/app/workspace/[workspaceId]/components/resource/components/resource-options/resource-options'

interface ResourceFilterPanelProps {
  children: ReactNode
}

/** The filter content frame shared by resource lists and document chunks. */
export function ResourceFilterPanel({ children }: ResourceFilterPanelProps) {
  return <div className='flex w-[240px] flex-col gap-3 p-3'>{children}</div>
}

interface ResourceFilterSectionProps {
  label: string
  children: ReactNode
  /** A distinct label treatment, such as the document chunk status label. */
  labelClassName?: string
}

export function ResourceFilterSection({
  label,
  children,
  labelClassName = FILTER_SECTION_LABEL_CLASS,
}: ResourceFilterSectionProps) {
  return (
    <div className='flex flex-col gap-1.5'>
      <span className={labelClassName}>{label}</span>
      {children}
    </div>
  )
}
