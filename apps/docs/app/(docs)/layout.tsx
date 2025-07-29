import type { ReactNode } from 'react'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { ExternalLink, GithubIcon } from 'lucide-react'
import Link from 'next/link'
import { source } from '@/lib/source'

const GitHubLink = () => (
  <div className='fixed right-4 bottom-4 z-50'>
    <Link
      href='https://github.com/simstudioai/sim'
      target='_blank'
      rel='noopener noreferrer'
      className='flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background transition-colors hover:bg-muted'
    >
      <GithubIcon className='h-4 w-4' />
    </Link>
  </div>
)

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <DocsLayout
        tree={source.pageTree}
        nav={{
          title: <div className='flex items-center font-medium'>Sim</div>,
        }}
        links={[
          {
            text: 'Visit Sim',
            url: 'https://sim.ai',
            icon: <ExternalLink className='h-4 w-4' />,
          },
        ]}
        sidebar={{
          defaultOpenLevel: 1,
          collapsible: true,
          footer: null,
        }}
      >
        {children}
      </DocsLayout>
      <GitHubLink />
    </>
  )
}
