import { ChipLink } from '@sim/emcn'
import { DocsPage } from 'fumadocs-ui/page'

export const metadata = {
  title: 'Page Not Found',
}

export default function NotFound() {
  return (
    <DocsPage role='main' tabIndex={-1}>
      <div className='flex min-h-[60vh] flex-col items-center justify-center px-4 py-24 text-center'>
        <div className='flex w-full max-w-[410px] flex-col items-center gap-3'>
          <h1 className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
            Page not found
          </h1>
          <p className='text-[var(--text-secondary)] text-lg'>
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
          <div className='mt-3 flex flex-wrap items-center justify-center gap-2'>
            <ChipLink href='/' variant='primary'>
              Return home
            </ChipLink>
          </div>
        </div>
      </div>
    </DocsPage>
  )
}
