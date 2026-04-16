import { DocsPage } from 'fumadocs-ui/page'
import Link from 'next/link'

export const metadata = {
  title: 'Page Not Found',
}

export default function NotFound() {
  return (
    <DocsPage>
      <div className='flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center'>
        <h1 className='bg-gradient-to-b from-[#47d991] to-[#33c482] bg-clip-text font-bold text-8xl text-transparent'>
          404
        </h1>
        <h2 className='font-semibold text-2xl text-foreground'>Page Not Found</h2>
        <p className='text-muted-foreground'>
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href='/'
          className='ml-1 flex items-center rounded-[8px] bg-[#33c482] px-2.5 py-1.5 text-[13px] text-white transition-colors duration-200 hover:bg-[#2DAC72]'
        >
          Go home
        </Link>
      </div>
    </DocsPage>
  )
}
