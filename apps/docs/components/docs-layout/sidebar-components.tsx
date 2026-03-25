'use client'

import { type ReactNode, useEffect, useState } from 'react'
import type { Folder, Item, Separator } from 'fumadocs-core/page-tree'
import { BookOpen, ChevronRight, Cog, Layers, Play, Plug, Rocket, Search } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const SEPARATOR_ICON_ENTRIES: Array<{ names: Set<string>; icon: React.ElementType }> = [
  {
    names: new Set(['Basics', 'Fundamentos', 'Grundlagen', '基本', '基础', 'Bases']),
    icon: BookOpen,
  },
  {
    names: new Set([
      'Core Concepts',
      'Conceptos principales',
      'Kernkonzepte',
      'コアコンセプト',
      '核心概念',
      'Concepts clés',
    ]),
    icon: Layers,
  },
  {
    names: new Set([
      'Integrations',
      'Integraciones',
      'Integrationen',
      'インテグレーション',
      '集成',
      'Intégrations',
    ]),
    icon: Plug,
  },
  {
    names: new Set([
      'Security & Configuration',
      'Seguridad y configuración',
      'Sicherheit & Konfiguration',
      'セキュリティと設定',
      '安全与配置',
      'Sécurité et configuration',
    ]),
    icon: Cog,
  },
  {
    names: new Set([
      'Execution & Operations',
      'Ejecución y operaciones',
      'Ausführung & Betrieb',
      '実行と運用',
      '执行与运维',
      'Exécution et opérations',
    ]),
    icon: Play,
  },
  {
    names: new Set([
      'Deployment',
      'Despliegue',
      'Bereitstellung',
      'デプロイ',
      '部署',
      'Déploiement',
    ]),
    icon: Rocket,
  },
  {
    names: new Set(['Reference', 'Referencia', 'Referenz', 'リファレンス', '参考', 'Référence']),
    icon: Search,
  },
]

function getSeparatorIcon(name: string): React.ElementType | undefined {
  return SEPARATOR_ICON_ENTRIES.find((entry) => entry.names.has(name))?.icon
}

const LANG_PREFIXES = ['/en', '/es', '/fr', '/de', '/ja', '/zh']

function stripLangPrefix(path: string): string {
  for (const prefix of LANG_PREFIXES) {
    if (path === prefix) return '/'
    if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length)
  }
  return path
}

function isActive(url: string, pathname: string, nested = true): boolean {
  const normalizedPathname = stripLangPrefix(pathname)
  const normalizedUrl = stripLangPrefix(url)
  return (
    normalizedUrl === normalizedPathname ||
    (nested && normalizedPathname.startsWith(`${normalizedUrl}/`))
  )
}

const itemBase = cn(
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
  'text-fd-muted-foreground hover:bg-fd-accent/50 hover:text-fd-accent-foreground',
  'lg:mb-[0.0625rem] lg:block lg:rounded-lg lg:px-2.5 lg:py-[7px] lg:text-[13.5px] lg:leading-snug'
)

const itemIdle = cn(
  'lg:font-normal lg:text-neutral-500 lg:dark:text-neutral-400',
  'lg:hover:bg-neutral-100/70 lg:hover:text-neutral-700 lg:dark:hover:bg-white/[0.06] lg:dark:hover:text-neutral-300'
)

const itemActive = cn(
  'lg:bg-neutral-100 lg:font-medium lg:text-neutral-900',
  'lg:dark:bg-white/[0.09] lg:dark:text-neutral-100'
)

export function SidebarItem({ item }: { item: Item }) {
  const pathname = usePathname()
  const active = isActive(item.url, pathname, false)

  return (
    <Link
      href={item.url}
      data-active={active}
      className={cn(
        itemBase,
        active && 'bg-fd-primary/10 font-medium text-fd-primary',
        active ? itemActive : itemIdle
      )}
    >
      {item.name}
    </Link>
  )
}

function isApiReferenceFolder(node: Folder): boolean {
  if (node.index?.url.includes('/api-reference/')) return true
  for (const child of node.children) {
    if (child.type === 'page' && child.url.includes('/api-reference/')) return true
    if (child.type === 'folder' && isApiReferenceFolder(child)) return true
  }
  return false
}

export function SidebarFolder({ item, children }: { item: Folder; children: ReactNode }) {
  const pathname = usePathname()
  const hasActiveChild = checkHasActiveChild(item, pathname)
  const isApiRef = isApiReferenceFolder(item)
  const isOnApiRefPage = stripLangPrefix(pathname).startsWith('/api-reference')
  const hasChildren = item.children.length > 0
  const [open, setOpen] = useState(hasActiveChild || (isApiRef && isOnApiRefPage))

  useEffect(() => {
    setOpen(hasActiveChild || (isApiRef && isOnApiRefPage))
  }, [hasActiveChild, isApiRef, isOnApiRefPage])

  const active = item.index ? isActive(item.index.url, pathname, false) : false

  if (item.index && !hasChildren) {
    return (
      <Link
        href={item.index.url}
        data-active={active}
        className={cn(
          itemBase,
          active && 'bg-fd-primary/10 font-medium text-fd-primary',
          active ? itemActive : itemIdle
        )}
      >
        {item.name}
      </Link>
    )
  }

  const folderHeaderBase = cn(
    'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
    'text-fd-muted-foreground hover:bg-fd-accent/50 hover:text-fd-accent-foreground',
    'lg:rounded-lg lg:px-2.5 lg:py-[7px] lg:text-[13.5px] lg:leading-snug'
  )

  const folderHeaderIdle = cn(
    'lg:font-[460] lg:text-neutral-700 lg:dark:text-neutral-300',
    'lg:hover:bg-neutral-100/70 lg:dark:hover:bg-white/[0.06]'
  )

  const folderHeaderActive = cn(
    'lg:bg-neutral-100 lg:font-medium lg:text-neutral-900',
    'lg:dark:bg-white/[0.09] lg:dark:text-neutral-100'
  )

  return (
    <div className='flex flex-col lg:mb-[0.0625rem]'>
      <div className='flex w-full items-center lg:gap-0.5'>
        {item.index ? (
          <Link
            href={item.index.url}
            data-active={active}
            className={cn(
              folderHeaderBase,
              'lg:block lg:flex-1',
              active && 'bg-fd-primary/10 font-medium text-fd-primary',
              active ? folderHeaderActive : folderHeaderIdle
            )}
          >
            {item.name}
          </Link>
        ) : (
          <button
            onClick={() => setOpen(!open)}
            className={cn(
              folderHeaderBase,
              'lg:flex lg:w-full lg:cursor-pointer lg:items-center lg:justify-between lg:text-left',
              folderHeaderIdle
            )}
          >
            <span>{item.name}</span>
            <ChevronRight
              className={cn(
                'ml-auto hidden h-3 w-3 flex-shrink-0 text-neutral-400 transition-transform duration-200 ease-in-out lg:block dark:text-neutral-500',
                open && 'rotate-90'
              )}
            />
          </button>
        )}
        {hasChildren && (
          <button
            onClick={() => setOpen(!open)}
            className={cn(
              'rounded p-1 hover:bg-fd-accent/50',
              'lg:cursor-pointer lg:rounded-md lg:p-1 lg:transition-colors lg:hover:bg-neutral-100/70 lg:dark:hover:bg-white/[0.06]'
            )}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              className={cn(
                'h-4 w-4 transition-transform',
                'lg:h-3 lg:w-3 lg:text-neutral-400 lg:duration-200 lg:ease-in-out lg:dark:text-neutral-500',
                open && 'rotate-90'
              )}
            />
          </button>
        )}
      </div>
      {hasChildren && (
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-200 ease-in-out',
            open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          )}
        >
          <div className='overflow-hidden'>
            {/* Mobile: simple indent */}
            <div className='ml-4 flex flex-col gap-0.5 lg:hidden'>{children}</div>
            {/* Desktop: styled with subtle border */}
            <ul className='mt-0.5 ml-2 hidden space-y-[0.0625rem] border-neutral-200/60 border-l pl-2.5 lg:block dark:border-neutral-700/50'>
              {children}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

export function SidebarSeparator({ item }: { item: Separator }) {
  const name = typeof item.name === 'string' ? item.name : ''
  const Icon = getSeparatorIcon(name)

  return (
    <p
      className={cn(
        'mt-5 mb-2 flex items-center gap-2 px-2 font-semibold text-fd-muted-foreground text-sm',
        'lg:mt-7 lg:mb-2 lg:px-2.5 lg:font-[620] lg:text-[13px] lg:text-neutral-800 lg:tracking-normal lg:dark:text-neutral-200',
        'first:mt-0 first:lg:mt-0'
      )}
    >
      {Icon && <Icon className='h-[14px] w-[14px] flex-shrink-0 opacity-70' />}
      {item.name}
    </p>
  )
}

function checkHasActiveChild(node: Folder, pathname: string): boolean {
  if (node.index && isActive(node.index.url, pathname)) {
    return true
  }

  for (const child of node.children) {
    if (child.type === 'page' && isActive(child.url, pathname)) {
      return true
    }
    if (child.type === 'folder' && checkHasActiveChild(child, pathname)) {
      return true
    }
  }

  return false
}
