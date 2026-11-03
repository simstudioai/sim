import Link from 'next/link'
import { DocsPageFrame } from '@/components/docs/page-frame'

export default function NotFound() {
  return (
    <DocsPageFrame headings={[]}>
      <main id='main-content' tabIndex={-1} className='py-16'>
        <p className='mb-3 text-[var(--docs-muted)] text-docs-control'>404</p>
        <h1 className='mb-4 font-medium text-[var(--docs-heading)] text-docs-title'>
          Page not found
        </h1>
        <p className='mb-6 text-docs-body'>
          This documentation page does not exist. Search the docs or return to the introduction.
        </p>
        <Link href='/introduction' className='text-[var(--docs-link)] hover:underline'>
          Read the introduction
        </Link>
      </main>
    </DocsPageFrame>
  )
}
