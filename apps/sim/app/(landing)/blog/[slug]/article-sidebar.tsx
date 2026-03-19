import { TableOfContents } from '@/app/(landing)/blog/[slug]/table-of-contents'

interface ArticleSidebarProps {
  headings: { text: string; id: string; level: number }[]
}

export function ArticleSidebar({ headings }: ArticleSidebarProps) {
  if (headings.length === 0) return null

  return (
    <aside className='hidden w-full shrink-0 self-start xl:sticky xl:top-[76px] xl:col-start-3 xl:block xl:w-72 xl:pt-16'>
      <div className='xl:max-h-[calc(100vh-140px)] xl:overflow-auto xl:pr-2'>
        <TableOfContents headings={headings} />
      </div>
    </aside>
  )
}
