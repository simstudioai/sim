import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@sim/emcn'
import type { MDXRemoteProps } from 'next-mdx-remote/rsc'
import { CodeBlock } from '@/lib/content/code'
import { SITE_URL } from '@/lib/core/utils/urls'
import { ContentImage } from '@/app/(landing)/components/content-image'

/**
 * Apex host for every Sim-owned property, derived from the canonical site URL
 * rather than the environment so a post renders identically in dev, preview,
 * and production.
 */
const SITE_APEX_HOST = new URL(SITE_URL).hostname.replace(/^www\./, '')

/**
 * True only for links that leave Sim entirely. Relative hrefs, in-page anchors,
 * the apex host, and any Sim subdomain (`www.`, `docs.`) are first-party and keep
 * default same-tab navigation so internal linking stays crawlable. The leading dot
 * in the suffix check keeps lookalike domains such as `evil-sim.ai` external.
 */
function isExternalHref(href: string | undefined): boolean {
  if (!href || !/^https?:\/\//i.test(href)) return false
  try {
    const { hostname } = new URL(href)
    return hostname !== SITE_APEX_HOST && !hostname.endsWith(`.${SITE_APEX_HOST}`)
  } catch {
    return false
  }
}

const LANGUAGE_MAP: Record<string, 'javascript' | 'json' | 'python' | 'bash'> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'javascript',
  tsx: 'javascript',
  typescript: 'javascript',
  javascript: 'javascript',
  json: 'json',
  python: 'python',
  py: 'python',
  bash: 'bash',
  shell: 'bash',
  sh: 'bash',
}

export const mdxComponents: MDXRemoteProps['components'] = {
  img: (props: any) => (
    <ContentImage
      src={props.src}
      alt={props.alt || ''}
      width={props.width ? Number(props.width) : 800}
      height={props.height ? Number(props.height) : 450}
      className={props.className}
    />
  ),
  h2: ({ children, className, ...props }: any) => (
    <h2
      {...props}
      style={{ fontSize: '30px', marginTop: '3rem', marginBottom: '1.5rem' }}
      className={cn('font-medium text-[var(--text-primary)] leading-tight', className)}
    >
      {children}
    </h2>
  ),
  h3: ({ children, className, ...props }: any) => (
    <h3
      {...props}
      style={{ fontSize: '24px', marginTop: '1.5rem', marginBottom: '0.75rem' }}
      className={cn('font-medium text-[var(--text-primary)] leading-tight', className)}
    >
      {children}
    </h3>
  ),
  h4: ({ children, className, ...props }: any) => (
    <h4
      {...props}
      style={{ fontSize: '19px', marginTop: '1.5rem', marginBottom: '0.75rem' }}
      className={cn('font-medium text-[var(--text-primary)] leading-tight', className)}
    >
      {children}
    </h4>
  ),
  p: (props: any) => (
    <p
      {...props}
      style={{ fontSize: '19px', marginBottom: '1.5rem', fontWeight: '400' }}
      className={cn('text-[var(--text-body)] leading-relaxed', props.className)}
    />
  ),
  ul: (props: any) => (
    <ul
      {...props}
      style={{ fontSize: '19px', marginBottom: '1rem', fontWeight: '400' }}
      className={cn(
        'list-outside list-disc pl-6 text-[var(--text-body)] leading-relaxed',
        props.className
      )}
    />
  ),
  ol: (props: any) => (
    <ol
      {...props}
      style={{ fontSize: '19px', marginBottom: '1rem', fontWeight: '400' }}
      className={cn(
        'list-outside list-decimal pl-6 text-[var(--text-body)] leading-relaxed',
        props.className
      )}
    />
  ),
  li: (props: any) => <li {...props} className={cn('mb-1', props.className)} />,
  strong: (props: any) => (
    <strong
      {...props}
      className={cn('font-semibold text-[var(--text-primary)]', props.className)}
    />
  ),
  em: (props: any) => (
    <em {...props} className={cn('text-[var(--text-muted)] italic', props.className)} />
  ),
  a: (props: any) => {
    const isAnchorLink = props.className?.includes('anchor')
    if (isAnchorLink) {
      return <a {...props} className={cn('text-inherit no-underline', props.className)} />
    }
    /**
     * Outbound citations in post bodies open in a new tab and carry
     * `rel="noopener noreferrer"`, per `.claude/rules/landing-seo-geo.md`.
     */
    const isExternal = isExternalHref(props.href)
    return (
      <a
        {...props}
        {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className={cn(
          'font-medium text-[var(--text-primary)] underline hover:text-[var(--text-primary)]',
          props.className
        )}
      />
    )
  },
  /**
   * Wide GFM tables would set the page's content width and scroll the whole article sideways on
   * phones; the wrapper confines scrolling to the table's own axis. `min-w` stops columns from
   * collapsing to one word per line, but is narrow enough that tables that already fit never scroll.
   */
  table: ({ className, ...props }: ComponentPropsWithoutRef<'table'>) => (
    <div className='my-6 w-full overflow-x-auto'>
      <table {...props} className={cn('my-0 min-w-[520px]', className)} />
    </div>
  ),
  figure: (props: any) => (
    <figure {...props} className={cn('my-8 overflow-hidden rounded-lg', props.className)} />
  ),
  hr: (props: any) => (
    <hr
      {...props}
      className={cn('my-8 border-[var(--border)]', props.className)}
      style={{ marginBottom: '1.5rem' }}
    />
  ),
  pre: (props: any) => {
    const child = props.children
    const isCodeBlock = child && typeof child === 'object' && child.props

    if (isCodeBlock) {
      const codeContent = child.props.children || ''
      const className = child.props.className || ''
      const language = className.replace('language-', '') || 'javascript'
      const mappedLanguage = LANGUAGE_MAP[language.toLowerCase()] || 'javascript'

      return (
        <div className='not-prose my-6'>
          <CodeBlock
            code={typeof codeContent === 'string' ? codeContent.trim() : String(codeContent)}
            language={mappedLanguage}
          />
        </div>
      )
    }
    return <pre {...props} className={cn('my-4 overflow-x-auto rounded-lg', props.className)} />
  },
  // Inline code chip, matching the rich markdown editor's `.rich-markdown-prose code`: no color set,
  // so it composites over its surrounding context (e.g. a link's blue).
  code: (props: any) => {
    if (!props.className) {
      return (
        <code
          {...props}
          className={cn(
            'rounded-[4px] bg-[var(--surface-5)] px-[0.375rem] py-[0.125rem] font-normal text-[0.875em]',
            props.className
          )}
          style={{
            fontFamily: 'var(--font-martian-mono, ui-monospace, monospace)',
            fontWeight: 400,
          }}
        />
      )
    }
    return <code {...props} />
  },
}
