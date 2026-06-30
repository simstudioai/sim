import { ChipLink } from '@sim/emcn'
import { DocsPage } from 'fumadocs-ui/page'

export const metadata = {
  title: 'Page Not Found',
}

export default function NotFound() {
  return (
    <DocsPage>
      <div className='flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center'>
        <h1 className='bg-gradient-to-b from-[var(--brand-accent)] to-[var(--brand-accent-hover)] bg-clip-text font-semibold text-8xl text-transparent'>
          404
        </h1>
        <h2 className='font-semibold text-2xl text-[var(--text-primary)]'>Page Not Found</h2>
        <p className='text-[var(--text-muted)]'>
          The page you're looking for doesn't exist or has been moved.
        </p>
        <ChipLink href='/' variant='primary'>
          Go home
        </ChipLink>
      </div>
    </DocsPage>
  )
}
