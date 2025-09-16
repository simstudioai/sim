import type { ReactNode } from 'react'
import { defineI18nUI } from 'fumadocs-ui/i18n'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { RootProvider } from 'fumadocs-ui/provider'
import { ExternalLink, GithubIcon } from 'lucide-react'
import { Inter } from 'next/font/google'
import Image from 'next/image'
import Link from 'next/link'
import { LanguageDropdown } from '@/components/ui/language-dropdown'
import { i18n } from '@/lib/i18n'
import { source } from '@/lib/source'
import '../global.css'
import { Analytics } from '@vercel/analytics/next'

const inter = Inter({
  subsets: ['latin'],
})

const { provider } = defineI18nUI(i18n, {
  translations: {
    en: {
      displayName: 'English',
    },
    es: {
      displayName: 'Español',
    },
    fr: {
      displayName: 'Français',
    },
    zh: {
      displayName: '简体中文',
    },
  },
})

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

type LayoutProps = {
  children: ReactNode
  params: Promise<{ lang: string }>
}

export default async function Layout({ children, params }: LayoutProps) {
  const { lang } = await params

  return (
    <html lang={lang} className={inter.className} suppressHydrationWarning>
      <body className='flex min-h-screen flex-col'>
        <RootProvider i18n={provider(lang)}>
          <DocsLayout
            tree={source.pageTree[lang]}
            nav={{
              title: (
                <div className='flex items-center gap-3'>
                  <Image
                    src='/static/logo.png'
                    alt='Sim'
                    width={60}
                    height={24}
                    className='h-6 w-auto'
                  />
                  <LanguageDropdown />
                </div>
              ),
            }}
            links={[
              {
                text: 'Visit Sim',
                url: 'https://sim.ai',
                icon: <ExternalLink className='h-4 w-4' />,
              },
            ]}
            sidebar={{
              defaultOpenLevel: 0,
              collapsible: true,
              footer: null,
              banner: null,
            }}
          >
            {children}
          </DocsLayout>
          <GitHubLink />
          <Analytics />
        </RootProvider>
      </body>
    </html>
  )
}
