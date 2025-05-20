import type { ReactNode } from 'react'
import Link from 'next/link'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { ExternalLink, GithubIcon } from 'lucide-react'
import { source } from '@/lib/source'

const GitHubLink = () => (
  <div className="fixed bottom-4 right-4 z-50">
    <Link
      href="https://github.com/simstudioai/sim"
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center w-8 h-8 rounded-full bg-background border border-border hover:bg-muted transition-colors"
    >
      <GithubIcon className="h-4 w-4" />
    </Link>
  </div>
)

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <DocsLayout
        tree={source.pageTree}
        nav={{
          title: <div className="flex items-center font-medium">Sim Studio</div>,
        }}
        links={[
          {
            text: 'Visit Sim Studio',
            url: 'https://simstudio.ai',
            icon: <ExternalLink className="h-4 w-4" />,
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