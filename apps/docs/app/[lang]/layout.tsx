import type { ReactNode } from 'react'
import { defineI18nUI } from 'fumadocs-ui/i18n'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { RootProvider } from 'fumadocs-ui/provider/next'
import { Martian_Mono } from 'next/font/google'
import localFont from 'next/font/local'
import Script from 'next/script'
import { DocsFooter } from '@/components/docs-layout/docs-footer'
import {
  SidebarFolder,
  SidebarItem,
  SidebarSeparator,
} from '@/components/docs-layout/sidebar-components'
import { Navbar } from '@/components/navbar/navbar'
import { SimLogoFull } from '@/components/ui/sim-logo'
import { i18n } from '@/lib/i18n'
import { source } from '@/lib/source'
import '../global.css'

const season = localFont({
  src: [{ path: '../fonts/SeasonSansUprightsVF.woff2', weight: '300 800', style: 'normal' }],
  display: 'swap',
  preload: true,
  variable: '--font-season',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans'],
  adjustFontFallback: 'Arial',
})

const martianMono = Martian_Mono({
  subsets: ['latin'],
  variable: '--font-martian-mono',
  display: 'swap',
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

const SUPPORTED_LANGUAGES: Set<string> = new Set(i18n.languages)

export default async function Layout({ children, params }: LayoutProps) {
  const { lang: rawLang } = await params
  const lang = SUPPORTED_LANGUAGES.has(rawLang) ? rawLang : 'en'

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Sim Documentation',
    description:
      'Documentation for Sim — the open-source platform to build AI agents and run your agentic workforce. Connect 1,000+ integrations and LLMs to deploy and orchestrate agentic workflows.',
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
      className={`${season.variable} ${martianMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body className='flex min-h-screen flex-col font-season'>
        <Script src='https://assets.onedollarstats.com/stonks.js' strategy='lazyOnload' />
        <RootProvider i18n={provider(lang)}>
          <Navbar />
          <DocsLayout
            tree={source.pageTree[lang]}
            nav={{
              title: <SimLogoFull className='h-7 w-auto' />,
            }}
            sidebar={{
              tabs: false,
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
              className: '!pt-0',
            }}
          >
            {children}
          </DocsLayout>
            <DocsFooter />
        </RootProvider>
      </body>
    </html>
  )
}
