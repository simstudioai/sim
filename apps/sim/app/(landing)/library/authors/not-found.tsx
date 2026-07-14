import { ChipLink } from '@sim/emcn'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Page Not Found',
  robots: { index: false, follow: true },
}

export default function LibraryAuthorNotFound() {
  return (
    <main
      id='main-content'
      className='mx-auto flex min-h-[60vh] w-full max-w-[1460px] flex-col items-center justify-center gap-3 px-20 py-24 text-center max-sm:px-5 max-lg:px-8'
    >
      <h1 className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
        Author not found
      </h1>
      <p className='text-[var(--text-muted)] text-lg'>
        The author you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <ChipLink variant='primary' href='/library' className='mt-3'>
        Browse library
      </ChipLink>
    </main>
  )
}
