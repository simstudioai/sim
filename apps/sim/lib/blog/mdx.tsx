import clsx from 'clsx'
import Image from 'next/image'
import type { MDXRemoteProps } from 'next-mdx-remote/rsc'
import { CodeBlock } from '@/lib/blog/code'

export const mdxComponents: MDXRemoteProps['components'] = {
  img: (props: any) => (
    <Image
      src={props.src}
      alt={props.alt || ''}
      width={props.width ? Number(props.width) : 800}
      height={props.height ? Number(props.height) : 450}
      className={clsx('h-auto w-full rounded-lg', props.className)}
      sizes='(max-width: 768px) 100vw, 800px'
      loading='lazy'
      unoptimized
    />
  ),
  h2: ({ children, className, ...props }: any) => (
    <h2
      {...props}
      style={{ fontSize: '30px', marginTop: '3rem', marginBottom: '1.5rem' }}
      className={clsx('font-medium text-[var(--landing-text)] leading-tight', className)}
    >
      {children}
    </h2>
  ),
  h3: ({ children, className, ...props }: any) => (
    <h3
      {...props}
      style={{ fontSize: '24px', marginTop: '1.5rem', marginBottom: '0.75rem' }}
      className={clsx('font-medium text-[var(--landing-text)] leading-tight', className)}
    >
      {children}
    </h3>
  ),
  h4: ({ children, className, ...props }: any) => (
    <h4
      {...props}
      style={{ fontSize: '19px', marginTop: '1.5rem', marginBottom: '0.75rem' }}
      className={clsx('font-medium text-[var(--landing-text)] leading-tight', className)}
    >
      {children}
    </h4>
  ),
  p: (props: any) => (
    <p
      {...props}
      style={{ fontSize: '19px', marginBottom: '1.5rem', fontWeight: '400' }}
      className={clsx('text-[var(--text-subtle)] leading-relaxed', props.className)}
    />
  ),
  ul: (props: any) => (
    <ul
      {...props}
      style={{ fontSize: '19px', marginBottom: '1rem', fontWeight: '400' }}
      className={clsx(
        'list-outside list-disc pl-6 text-[var(--text-subtle)] leading-relaxed',
        props.className
      )}
    />
  ),
  ol: (props: any) => (
    <ol
      {...props}
      style={{ fontSize: '19px', marginBottom: '1rem', fontWeight: '400' }}
      className={clsx(
        'list-outside list-decimal pl-6 text-[var(--text-subtle)] leading-relaxed',
        props.className
      )}
    />
  ),
  li: (props: any) => <li {...props} className={clsx('mb-1', props.className)} />,
  strong: (props: any) => (
    <strong
      {...props}
      className={clsx('font-semibold text-[var(--landing-text)]', props.className)}
    />
  ),
  em: (props: any) => <em {...props} className={clsx('text-[#bbb] italic', props.className)} />,
  a: (props: any) => {
    const isAnchorLink = props.className?.includes('anchor')
    if (isAnchorLink) {
      return <a {...props} className={clsx('text-inherit no-underline', props.className)} />
    }
    return (
      <a
        {...props}
        className={clsx(
          'font-medium text-[var(--landing-text)] underline hover:text-white',
          props.className
        )}
      />
    )
  },
  figure: (props: any) => (
    <figure {...props} className={clsx('my-8 overflow-hidden rounded-lg', props.className)} />
  ),
  hr: (props: any) => (
    <hr
      {...props}
      className={clsx('my-8 border-[var(--landing-bg-elevated)]', props.className)}
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

      const languageMap: Record<string, 'javascript' | 'json' | 'python'> = {
        js: 'javascript',
        jsx: 'javascript',
        ts: 'javascript',
        tsx: 'javascript',
        typescript: 'javascript',
        javascript: 'javascript',
        json: 'json',
        python: 'python',
        py: 'python',
      }

      const mappedLanguage = languageMap[language.toLowerCase()] || 'javascript'

      return (
        <div className='not-prose my-6'>
          <CodeBlock
            code={typeof codeContent === 'string' ? codeContent.trim() : String(codeContent)}
            language={mappedLanguage}
          />
        </div>
      )
    }
    return <pre {...props} className={clsx('my-4 overflow-x-auto rounded-lg', props.className)} />
  },
  code: (props: any) => {
    if (!props.className) {
      return (
        <code
          {...props}
          className={clsx(
            'rounded bg-[var(--surface-4)] px-1.5 py-0.5 font-mono font-normal text-[0.9em] text-[var(--landing-text)]',
            props.className
          )}
          style={{ fontWeight: 400 }}
        />
      )
    }
    return <code {...props} />
  },
}
