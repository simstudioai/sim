import { ArrowLeft, ChevronLeft } from 'lucide-react'
import Link from 'next/link'

export function BackLink() {
  return (
    <Link
      href='/blog'
      className='group flex items-center gap-1 text-[#999] text-sm hover:text-[#ECECEC]'
    >
      <span className='inline-flex transition-transform duration-200 group-hover:-translate-x-0.5'>
        <ChevronLeft className='h-4 w-4 block group-hover:hidden' aria-hidden='true' />
        <ArrowLeft className='h-4 w-4 hidden group-hover:block' aria-hidden='true' />
      </span>
      Back to Blog
    </Link>
  )
}
