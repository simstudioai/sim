import type { ReactNode } from 'react'
import { defineI18nUI } from 'fumadocs-ui/i18n'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { RootProvider } from 'fumadocs-ui/provider/next'
import { Geist_Mono, Inter } from 'next/font/google'
import {
  CustomSidebarFolder,
  CustomSidebarItem,
  CustomSidebarSeparator,
} from '@/components/docs-layout/simple-sidebar-components'
import { CustomNavbar } from '@/components/navbar/custom-navbar'
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

  return (
    <html
      lang={lang}
      className={`${inter.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className='flex min-h-screen flex-col font-sans'>
        <RootProvider i18n={provider(lang)}>
          <CustomNavbar />
          <DocsLayout
            tree={source.pageTree[lang]}
            themeSwitch={{
              enabled: false,
            }}
            sidebar={{
              defaultOpenLevel: 0,
              collapsible: false,
              footer: null,
              banner: null,
              components: {
                Item: CustomSidebarItem,
                Folder: CustomSidebarFolder,
                Separator: CustomSidebarSeparator,
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
