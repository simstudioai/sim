import { TableOfContents } from '@/app/(landing)/blog/[slug]/table-of-contents'

interface ArticleSidebarProps {
  headings: { text: string; id: string; level: number }[]
}

export function ArticleSidebar({ headings }: ArticleSidebarProps) {
  if (headings.length === 0) return null

  return (
    <aside className='mr-2 hidden w-full shrink-0 self-start xl:sticky xl:top-[76px] xl:block xl:w-72 xl:pt-16'>
      <TableOfContents headings={headings} />
    </aside>
  )
}
