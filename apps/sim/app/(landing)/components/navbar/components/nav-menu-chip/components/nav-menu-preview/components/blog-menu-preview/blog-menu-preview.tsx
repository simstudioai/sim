import { FileText } from '@sim/emcn/icons'
import Image from 'next/image'
import { MenuPreviewFrame } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-frame'
import { MenuPreviewHeader } from '@/app/(landing)/components/navbar/components/nav-menu-chip/components/nav-menu-preview/components/menu-preview-header/menu-preview-header'

/** Cover of the latest published post, Tracking Secrets Through an Agent Run (August 8, 2026). */
export function BlogMenuPreview() {
  return (
    <MenuPreviewFrame kind='blog'>
      <div className='min-h-[400px] w-[620px] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg)] font-normal text-[var(--text-body)] text-small shadow-xs'>
        <MenuPreviewHeader icon={FileText} title='Blog' />
        <Image
          src='/blog/secret-provenance/cover.jpg'
          alt='Sim secret provenance technical overview'
          width={1200}
          height={675}
          sizes='620px'
          loading='lazy'
          unoptimized
          className='h-[260px] w-full object-cover'
        />
      </div>
    </MenuPreviewFrame>
  )
}
