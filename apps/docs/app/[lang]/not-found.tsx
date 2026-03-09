import { DocsBody, DocsPage } from 'fumadocs-ui/page'

export const metadata = {
  title: 'Page Not Found',
}

export default function NotFound() {
  return (
    <DocsPage>
      <DocsBody>
        <div className='flex min-h-[60vh] flex-col items-center justify-center text-center'>
          <h1 className='mb-4 bg-gradient-to-b from-[#47d991] to-[#33c482] bg-clip-text font-bold text-8xl text-transparent'>
            404
          </h1>
          <h2 className='mb-2 font-semibold text-2xl text-foreground'>Page Not Found</h2>
          <p className='text-muted-foreground'>
            The page you're looking for doesn't exist or has been moved.
          </p>
        </div>
      </DocsBody>
    </DocsPage>
  )
}
