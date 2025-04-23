import type { ReactNode } from 'react'
import Link from 'next/link'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { GithubIcon, ExternalLink } from 'lucide-react'
import { source } from '@/lib/source'
import { AgentIcon } from '@/components/icons'

const GitHubLink = () => (
  <div className="fixed bottom-4 left-4 z-50">
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
          title: (
            <div className="flex items-center gap-2">
              <AgentIcon className="h-4 w-4 text-[#8b5cf6]" />
              Sim Studio
            </div>
          ),
        }}
        links={[
          {
            text: 'Visit Sim Studio',
            url: 'https://simstudio.ai',
            icon: <ExternalLink className="h-4 w-4" />,
          }
        ]}
      >
        {children}
      </DocsLayout>
      <GitHubLink />
    </>
  )
}