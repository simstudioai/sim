import type { ReactNode } from 'react'
import { defineI18nUI } from 'fumadocs-ui/i18n'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { RootProvider } from 'fumadocs-ui/provider/next'
import { Geist_Mono, Inter } from 'next/font/google'
import Image from 'next/image'
import {
  SidebarFolder,
  SidebarItem,
  SidebarSeparator,
} from '@/components/docs-layout/sidebar-components'
import { Navbar } from '@/components/navbar/navbar'
import { i18n } from '@/lib/i18n'
import { source } from '@/lib/source'
import '../global.css'
import { Analytics } from '@vercel/analytics/next'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
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
    de: {
      displayName: 'Deutsch',
    },
    ja: {
      displayName: '日本語',
    },
    zh: {
      displayName: '简体中文',
    },
  },
})

type LayoutProps = {
  children: ReactNode
  params: Promise<{ lang: string }>
}

export default async function Layout({ children, params }: LayoutProps) {
  const { lang } = await params

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Sim Documentation',
    description:
      'Comprehensive documentation for Sim - the visual workflow builder for AI Agent Workflows.',
    url: 'https://docs.sim.ai',
    publisher: {
      '@type': 'Organization',
      name: 'Sim',
      url: 'https://sim.ai',
      logo: {
        '@type': 'ImageObject',
        url: 'https://docs.sim.ai/static/logo.png',
      },
    },
    inLanguage: lang,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://docs.sim.ai/api/search?q={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    },
  }

  return (
    <html
      lang={lang}
      className={`${inter.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className='flex min-h-screen flex-col font-sans'>
        <RootProvider i18n={provider(lang)}>
          <Navbar />
          <DocsLayout
            tree={source.pageTree[lang]}
            themeSwitch={{
              enabled: false,
            }}
            nav={{
              title: (
                <Image
                  src='/static/logo.png'
                  alt='Sim'
                  width={72}
                  height={28}
                  className='h-7 w-auto'
                  priority
                />
              ),
            }}
            sidebar={{
              defaultOpenLevel: 0,
              collapsible: false,
              footer: null,
              banner: null,
              components: {
                Item: SidebarItem,
                Folder: SidebarFolder,
                Separator: SidebarSeparator,
              },
            }}
            containerProps={{
              className: '!pt-10',
            }}
          >
            {children}
          </DocsLayout>
          <Analytics />
        </RootProvider>
      </body>
    </html>
  )
}
