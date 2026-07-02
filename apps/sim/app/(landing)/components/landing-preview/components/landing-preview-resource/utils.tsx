import type { PreviewCell } from '@/app/(landing)/components/landing-preview/components/landing-preview-resource/landing-preview-resource'

/** Builds a preview owner cell: a small circular initial badge next to a name. */
export function ownerCell(initial: string, name: string): PreviewCell {
  return {
    icon: (
      <span className='flex size-[14px] flex-shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] font-medium text-[8px] text-[var(--text-secondary)]'>
        {initial}
      </span>
    ),
    label: name,
  }
}
