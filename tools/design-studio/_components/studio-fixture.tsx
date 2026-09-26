'use client'

import { type CSSProperties, useEffect, useState } from 'react'
import { cn } from '@sim/emcn'
import * as Icons from '@sim/emcn/icons'
import { ComponentPreview } from '@studio/_components/component-fixtures'
import type { StudioSample } from '@studio/_lib/manifest'
import { Command } from 'cmdk'
import { AgentIcon, ApiIcon, SearchIcon, WorkflowIcon } from '@/components/icons'
import { ThinkingLoader } from '@/components/ui/thinking-loader'
import { ErrorShell } from '@/app/workspace/[workspaceId]/components/error/error'
import { KnowledgeIsoMark } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/knowledge-iso'
import { BrowserLoadingBar } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-loading-bar'
import { DropOverlay } from '@/app/workspace/[workspaceId]/home/components/user-input/components/drop-overlay/drop-overlay'
import {
  IntegrationsShowcase,
  IntegrationTile,
} from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase/integrations-showcase'
import { CommandSearch } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/search-modal/components/command-chrome/command-chrome'
import '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/rich-markdown-editor.css'

interface StudioFixtureProps {
  kind: string
  id: string
  theme: 'light' | 'dark'
  rootSize: 16 | 20
  variant?: { axis: string; value: string }
  variants?: Record<string, string>
  interactive?: boolean
  state?: string
  sample?: StudioSample
}

function GenericSample({ sample }: { sample: StudioSample }) {
  const authoredStyle: CSSProperties = {}
  if (/^(?:\d+(?:\.\d+)?(?:px|rem|em|%)|0)$/.test(sample.value)) {
    if (sample.property === 'border-radius') authoredStyle.borderRadius = sample.value
    if (sample.property === 'font-size') authoredStyle.fontSize = sample.value
    if (sample.property === 'line-height') authoredStyle.lineHeight = sample.value
  }
  if (/^(?:#[\da-f]{3,8}|(?:rgb|hsl|oklch|var)\()/i.test(sample.value)) {
    if (sample.property === 'color') authoredStyle.color = sample.value
    if (sample.property === 'background-color') authoredStyle.backgroundColor = sample.value
  }
  const classTokens = sample.className.split(/\s+/)
  for (const token of classTokens) {
    if (token.includes(':')) continue
    const arbitrary = /^([\w-]+)-\[(.+)\]!?$/.exec(token)
    if (!arbitrary) continue
    const [, utility, raw] = arbitrary
    const value = raw.replaceAll('_', ' ').replace(/^color:/, '')
    if (utility === 'rounded') authoredStyle.borderRadius = value
    if (utility === 'rounded-b') {
      authoredStyle.borderBottomLeftRadius = value
      authoredStyle.borderBottomRightRadius = value
    }
    if (utility === 'rounded-t') {
      authoredStyle.borderTopLeftRadius = value
      authoredStyle.borderTopRightRadius = value
    }
    if (utility === 'leading') authoredStyle.lineHeight = value
    if (utility === 'tracking') authoredStyle.letterSpacing = value
    if (utility === 'text') {
      if (/^(?:\d|calc\()/.test(value)) authoredStyle.fontSize = value
      else authoredStyle.color = value
    }
    if (utility === 'bg') authoredStyle.backgroundColor = value
    if (utility === 'border') authoredStyle.borderColor = value
    if (utility === 'shadow') authoredStyle.boxShadow = value
    if (utility === 'size') {
      authoredStyle.width = value
      authoredStyle.height = value
      authoredStyle.minHeight = 0
    }
  }
  const visualClasses = classTokens
    .filter(
      (token) =>
        token !== 'opacity-0' &&
        /(?:^|:)(?:bg-|text-|border-|rounded-|shadow-|font-|leading-|tracking-|opacity-|ring-|outline-|fill-|stroke-|p[xytrbl]?-|size-)/.test(
          token
        )
    )
    .join(' ')
  if (sample.kind === 'swatch') {
    return (
      <div className='grid max-w-full grid-cols-5 gap-2'>
        {sample.values.map((value) => (
          <div key={value} className='w-14 text-center' title={value}>
            <div
              className='h-10 rounded-lg border border-[var(--border)]'
              style={{ backgroundColor: value }}
            />
            <span className='mt-1 block truncate font-mono text-[9px] text-[var(--text-muted)]'>
              {value}
            </span>
          </div>
        ))}
      </div>
    )
  }
  if (sample.kind === 'runtime') {
    return (
      <div className='rounded-lg border border-[var(--border)] bg-[var(--surface-3)] p-5 text-[var(--text-body)]'>
        <span className='font-medium text-sm'>Runtime stylesheet</span>
        <span className='mt-2 block font-mono text-[var(--text-muted)] text-xs'>
          Values supplied by the running product
        </span>
      </div>
    )
  }
  if (sample.kind === 'text') {
    return (
      <p
        className={cn('max-w-80 text-center text-[var(--text-body)]', visualClasses)}
        style={authoredStyle}
      >
        The quick brown fox jumps over the lazy dog.
      </p>
    )
  }
  if (sample.kind === 'control') {
    const tag = sample.tag.toLowerCase()
    if (tag.includes('label')) {
      return (
        <label
          style={authoredStyle}
          className={cn('inline-flex items-center gap-3 text-[var(--text-body)]', visualClasses)}
        >
          <input type='checkbox' defaultChecked />
          Example label
        </label>
      )
    }
    if (tag === 'textarea') {
      return (
        <textarea
          aria-label='Sample textarea'
          readOnly
          value='Example text'
          style={authoredStyle}
          className={cn(
            'max-w-60 rounded-md border border-[var(--border)] bg-[var(--surface-3)] px-3 py-2 text-[var(--text-body)]',
            visualClasses
          )}
        />
      )
    }
    if (tag.includes('input')) {
      return (
        <input
          aria-label='Sample input'
          readOnly
          value='Example input'
          style={authoredStyle}
          className={cn(
            'max-w-60 rounded-md border border-[var(--border)] bg-[var(--surface-3)] px-3 py-2 text-[var(--text-body)]',
            visualClasses
          )}
        />
      )
    }
    if (tag === 'a' || tag.includes('link')) {
      return (
        <a
          href='#sample-link'
          style={authoredStyle}
          className={cn('text-[var(--text-body)] underline underline-offset-4', visualClasses)}
        >
          Example link ↗
        </a>
      )
    }
    if (tag.includes('avatar')) {
      return (
        <span
          style={authoredStyle}
          className={cn(
            'flex size-10 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] text-[var(--text-body)] text-xs',
            visualClasses
          )}
        >
          AL
        </span>
      )
    }
    if (tag.includes('chip') || tag.includes('badge')) {
      return (
        <span
          style={authoredStyle}
          className={cn(
            'inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] px-3 py-1 text-[var(--text-body)] text-xs',
            visualClasses
          )}
        >
          Example tag
        </span>
      )
    }
    if (tag.includes('menuitem')) {
      return (
        <div
          role='menuitem'
          style={authoredStyle}
          className={cn('rounded-md px-3 py-2 text-[var(--text-body)] text-sm', visualClasses)}
        >
          Example menu item
        </div>
      )
    }
    if (tag.includes('tooltip') || tag.includes('popover') || tag.includes('menu')) {
      return (
        <div
          style={authoredStyle}
          className={cn(
            'min-w-40 rounded-lg border border-[var(--border)] bg-[var(--surface-3)] p-3 text-[var(--text-body)] text-sm shadow-sm',
            visualClasses
          )}
        >
          Example content
        </div>
      )
    }
    if (tag === 'div' || tag === 'span' || tag === 'th' || tag.includes('code.')) {
      return (
        <div
          style={authoredStyle}
          className={cn(
            'min-w-40 rounded-lg border border-[var(--border)] bg-[var(--surface-3)] px-4 py-3 text-[var(--text-body)] text-sm',
            visualClasses
          )}
        >
          Example content
        </div>
      )
    }
    return (
      <button
        type='button'
        style={authoredStyle}
        className={cn(
          'min-h-9 rounded-md border border-[var(--border)] bg-[var(--surface-3)] px-3 py-2 text-[var(--text-body)]',
          visualClasses
        )}
      >
        {visualClasses.includes('size-') ? '●' : 'Example action'}
      </button>
    )
  }
  return (
    <div
      style={authoredStyle}
      className={cn(
        'flex h-24 w-48 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-3)] text-[var(--text-body)]',
        visualClasses
      )}
    >
      <span className='text-xs'>Sample surface</span>
    </div>
  )
}

const sourceExtras = {
  knowledge: KnowledgeIsoMark,
  showcase: IntegrationsShowcase,
  agentIcon: AgentIcon,
  apiIcon: ApiIcon,
  searchIcon: SearchIcon,
  workflowIcon: WorkflowIcon,
} as const

interface ExtraPreviewProps {
  id: string
}

function ExtraPreview({ id }: ExtraPreviewProps) {
  const SourceExtra = sourceExtras[id as keyof typeof sourceExtras]
  if (SourceExtra) return <SourceExtra />

  switch (id) {
    case 'thinking':
      return <ThinkingLoader variant='relay' relayLayout='wide' size={24} />
    case 'error':
      return (
        <ErrorShell title='Something went wrong' description='Please try again.'>
          {null}
        </ErrorShell>
      )
    case 'integration-tile':
      return <IntegrationTile blockType='slack' icon={Icons.Integration} framed />
    case 'command-search':
      return (
        <Command className='relative h-24 w-64 rounded-2xl border border-[var(--border)] bg-[var(--surface-4)]'>
          <CommandSearch surface='palette' placeholder='Search commands…' />
        </Command>
      )
    case 'rich-code':
      return (
        <div className='rich-markdown-prose text-[var(--text-body)]'>
          Rich text with <code>inline code</code>
        </div>
      )
    case 'rich-type':
      return (
        <div className='rich-markdown-prose max-h-56 w-full overflow-auto text-[var(--text-body)]'>
          <h1>Heading one</h1>
          <h2>Heading two</h2>
          <h3>Heading three</h3>
          <h4>Heading four</h4>
          <h5>Heading five</h5>
          <h6>Heading six</h6>
          <div className='rich-markdown-nodes'>
            <div className='raw-markdown-block'>Raw markdown</div>
          </div>
        </div>
      )
    case 'rich-selection':
      return (
        <div className='rich-markdown-nodes w-56 text-[var(--text-body)]'>
          <hr className='rich-leaf-in-selection' />
        </div>
      )
    case 'browser-loading':
      return (
        <div className='relative h-8 w-56 border-[var(--border)] border-b'>
          <BrowserLoadingBar loading />
        </div>
      )
    case 'drop-overlay':
      return (
        <div className='relative h-28 w-64 rounded-2xl border border-[var(--border)]'>
          <DropOverlay imagesOnly />
        </div>
      )
    default:
      return <span data-studio-unavailable />
  }
}

/** Mounts production components with fixed example state for repeatable captures. */
export function StudioFixture({
  kind,
  id,
  theme,
  rootSize,
  variant,
  variants,
  interactive,
  state,
  sample,
}: StudioFixtureProps) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const root = document.documentElement
    const previousSize = root.style.fontSize
    const previousDark = root.classList.contains('dark')
    root.style.fontSize = `${rootSize}px`
    root.classList.toggle('dark', theme === 'dark')
    setReady(true)
    return () => {
      root.style.fontSize = previousSize
      root.classList.toggle('dark', previousDark)
    }
  }, [theme, rootSize])
  // biome-ignore lint/performance/noDynamicNamespaceImportAccess: The source-discovered icon catalog needs one generic adapter.
  const Icon = kind === 'icon' ? Icons[id as keyof typeof Icons] : null
  const supportedKind = ['component', 'sample', 'icon', 'extra'].includes(kind)
  return (
    <main
      data-studio-theme
      className={`${theme} flex min-h-screen items-center justify-center bg-[var(--bg)] p-6`}
    >
      {ready ? (
        <div
          data-studio-fixture
          className='relative flex min-h-40 w-full items-center justify-center overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-8'
        >
          {kind === 'component' ? (
            <ComponentPreview
              id={id}
              variant={variant}
              variants={variants}
              interactive={interactive}
              state={state}
            />
          ) : null}
          {kind === 'sample' &&
            (sample ? <GenericSample sample={sample} /> : <span data-studio-unavailable />)}
          {kind === 'icon' && Icon ? <Icon className='size-12' /> : null}
          {kind === 'icon' && !Icon ? <span data-studio-unavailable /> : null}
          {kind === 'extra' ? <ExtraPreview id={id} /> : null}
          {!supportedKind ? <span data-studio-unavailable /> : null}
        </div>
      ) : null}
    </main>
  )
}
