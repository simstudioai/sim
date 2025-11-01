import { findNeighbour } from 'fumadocs-core/server'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageNavigationArrows } from '@/components/docs-layout/page-navigation-arrows'
import { TOCFooter } from '@/components/docs-layout/toc-footer'
import { StructuredData } from '@/components/structured-data'
import { CodeBlock } from '@/components/ui/code-block'
import { CopyPageButton } from '@/components/ui/copy-page-button'
import { source } from '@/lib/source'

export default async function Page(props: { params: Promise<{ slug?: string[]; lang: string }> }) {
  const params = await props.params
  const page = source.getPage(params.slug, params.lang)
  if (!page) notFound()

  const MDX = page.data.body
  const baseUrl = 'https://docs.sim.ai'

  const pageTreeRecord = source.pageTree as Record<string, any>
  const pageTree =
    pageTreeRecord[params.lang] ?? pageTreeRecord.en ?? Object.values(pageTreeRecord)[0]
  const neighbours = pageTree ? findNeighbour(pageTree, page.url) : null

  const generateBreadcrumbs = () => {
    const breadcrumbs: Array<{ name: string; url: string }> = [
      {
        name: 'Home',
        url: baseUrl,
      },
    ]

    const urlParts = page.url.split('/').filter(Boolean)
    let currentPath = ''

    urlParts.forEach((part, index) => {
      if (index === 0 && ['en', 'es', 'fr', 'de', 'ja', 'zh'].includes(part)) {
        currentPath = `/${part}`
        return
      }

      currentPath += `/${part}`

      const name = part
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')

      if (index === urlParts.length - 1) {
        breadcrumbs.push({
          name: page.data.title,
          url: `${baseUrl}${page.url}`,
        })
      } else {
        breadcrumbs.push({
          name: name,
          url: `${baseUrl}${currentPath}`,
        })
      }
    })

    return breadcrumbs
  }

  const breadcrumbs = generateBreadcrumbs()

  const CustomFooter = () => (
    <div className='mt-12'>
      {/* Navigation links */}
      <div className='flex items-center justify-between py-8'>
        {neighbours?.previous ? (
          <Link
            href={neighbours.previous.url}
            className='group flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground'
          >
            <ChevronLeft className='group-hover:-translate-x-1 h-4 w-4 transition-transform' />
            <span className='font-medium'>{neighbours.previous.name}</span>
          </Link>
        ) : (
          <div />
        )}

        {neighbours?.next ? (
          <Link
            href={neighbours.next.url}
            className='group flex items-center gap-2 text-muted-foreground transition-colors hover:text-foreground'
          >
            <span className='font-medium'>{neighbours.next.name}</span>
            <ChevronRight className='h-4 w-4 transition-transform group-hover:translate-x-1' />
          </Link>
        ) : (
          <div />
        )}
      </div>

      {/* Divider line */}
      <div className='border-border border-t' />

      {/* Social icons */}
      <div className='flex items-center gap-4 py-6'>
        <Link
          href='https://x.com/simdotai'
          target='_blank'
          rel='noopener noreferrer'
          aria-label='X (Twitter)'
        >
          <div
            className='h-5 w-5 bg-gray-400 transition-colors hover:bg-gray-500 dark:bg-gray-500 dark:hover:bg-gray-400'
            style={{
              maskImage:
                "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z%22/%3E%3C/svg%3E')",
              maskRepeat: 'no-repeat',
              maskPosition: 'center center',
              WebkitMaskImage:
                "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z%22/%3E%3C/svg%3E')",
              WebkitMaskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center center',
            }}
          />
        </Link>
        <Link
          href='https://github.com/simstudioai/sim'
          target='_blank'
          rel='noopener noreferrer'
          aria-label='GitHub'
        >
          <div
            className='h-5 w-5 bg-gray-400 transition-colors hover:bg-gray-500 dark:bg-gray-500 dark:hover:bg-gray-400'
            style={{
              maskImage:
                "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z%22/%3E%3C/svg%3E')",
              maskRepeat: 'no-repeat',
              maskPosition: 'center center',
              WebkitMaskImage:
                "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z%22/%3E%3C/svg%3E')",
              WebkitMaskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center center',
            }}
          />
        </Link>
        <Link
          href='https://discord.gg/Hr4UWYEcTT'
          target='_blank'
          rel='noopener noreferrer'
          aria-label='Discord'
        >
          <div
            className='h-5 w-5 bg-gray-400 transition-colors hover:bg-gray-500 dark:bg-gray-500 dark:hover:bg-gray-400'
            style={{
              maskImage:
                "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z%22/%3E%3C/svg%3E')",
              maskRepeat: 'no-repeat',
              maskPosition: 'center center',
              WebkitMaskImage:
                "url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Cpath d=%22M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z%22/%3E%3C/svg%3E')",
              WebkitMaskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center center',
            }}
          />
        </Link>
      </div>
    </div>
  )

  return (
    <>
      <StructuredData
        title={page.data.title}
        description={page.data.description || ''}
        url={`${baseUrl}${page.url}`}
        lang={params.lang}
        breadcrumb={breadcrumbs}
      />
      <DocsPage
        toc={page.data.toc}
        full={page.data.full}
        breadcrumb={{
          enabled: false,
        }}
        tableOfContent={{
          style: 'clerk',
          enabled: true,
          header: <div className='mb-2 font-medium text-sm'>On this page</div>,
          footer: <TOCFooter />,
          single: false,
        }}
        article={{
          className: 'scroll-smooth max-sm:pb-16',
        }}
        tableOfContentPopover={{
          style: 'clerk',
          enabled: true,
        }}
        footer={{
          enabled: true,
          component: <CustomFooter />,
        }}
      >
        <div className='relative'>
          <div className='absolute top-1 right-0 flex items-center gap-2'>
            <CopyPageButton
              content={`# ${page.data.title}

${page.data.description || ''}

${page.data.content || ''}`}
            />
            <PageNavigationArrows previous={neighbours?.previous} next={neighbours?.next} />
          </div>
          <DocsTitle>{page.data.title}</DocsTitle>
          <DocsDescription>{page.data.description}</DocsDescription>
        </div>
        <DocsBody>
          <MDX
            components={{
              ...defaultMdxComponents,
              CodeBlock,
            }}
          />
        </DocsBody>
      </DocsPage>
    </>
  )
}

export async function generateStaticParams() {
  return source.generateParams()
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[]; lang: string }>
}) {
  const params = await props.params
  const page = source.getPage(params.slug, params.lang)
  if (!page) notFound()

  const baseUrl = 'https://docs.sim.ai'
  const fullUrl = `${baseUrl}${page.url}`

  return {
    title: page.data.title,
    description:
      page.data.description || 'Sim visual workflow builder for AI applications documentation',
    keywords: [
      'AI workflow builder',
      'visual workflow editor',
      'AI automation',
      'workflow automation',
      'AI agents',
      'no-code AI',
      'drag and drop workflows',
      page.data.title?.toLowerCase().split(' '),
    ]
      .flat()
      .filter(Boolean),
    authors: [{ name: 'Sim Team' }],
    category: 'Developer Tools',
    openGraph: {
      title: page.data.title,
      description:
        page.data.description || 'Sim visual workflow builder for AI applications documentation',
      url: fullUrl,
      siteName: 'Sim Documentation',
      type: 'article',
      locale: params.lang === 'en' ? 'en_US' : `${params.lang}_${params.lang.toUpperCase()}`,
      alternateLocale: ['en', 'es', 'fr', 'de', 'ja', 'zh']
        .filter((lang) => lang !== params.lang)
        .map((lang) => (lang === 'en' ? 'en_US' : `${lang}_${lang.toUpperCase()}`)),
    },
    twitter: {
      card: 'summary',
      title: page.data.title,
      description:
        page.data.description || 'Sim visual workflow builder for AI applications documentation',
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
    canonical: fullUrl,
    alternates: {
      canonical: fullUrl,
      languages: {
        'x-default': `${baseUrl}${page.url.replace(`/${params.lang}`, '')}`,
        en: `${baseUrl}${page.url.replace(`/${params.lang}`, '')}`,
        es: `${baseUrl}/es${page.url.replace(`/${params.lang}`, '')}`,
        fr: `${baseUrl}/fr${page.url.replace(`/${params.lang}`, '')}`,
        de: `${baseUrl}/de${page.url.replace(`/${params.lang}`, '')}`,
        ja: `${baseUrl}/ja${page.url.replace(`/${params.lang}`, '')}`,
        zh: `${baseUrl}/zh${page.url.replace(`/${params.lang}`, '')}`,
      },
    },
  }
}
