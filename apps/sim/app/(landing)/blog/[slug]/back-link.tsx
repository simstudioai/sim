import { ArrowLeft, ChevronLeft } from 'lucide-react'
import Link from 'next/link'

export function BackLink() {
  return (
    <Link
      href='/blog'
      className='group flex items-center gap-1 text-[#999] text-sm hover:text-[#ECECEC]'
    >
      <span className='group-hover:-translate-x-0.5 inline-flex transition-transform duration-200'>
        <ChevronLeft className='block h-4 w-4 group-hover:hidden' aria-hidden='true' />
        <ArrowLeft className='hidden h-4 w-4 group-hover:block' aria-hidden='true' />
      </span>
      Back to Blog
    </Link>
  )
}
