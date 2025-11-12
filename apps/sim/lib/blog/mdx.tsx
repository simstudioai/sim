import clsx from 'clsx'
import Image from 'next/image'
import type { MDXRemoteProps } from 'next-mdx-remote/rsc'
import { CodeBlock } from './code'

export const mdxComponents: MDXRemoteProps['components'] = {
  img: (props: any) => (
    <Image
      src={props.src}
      alt={props.alt || ''}
      width={props.width ? Number(props.width) : 800}
      height={props.height ? Number(props.height) : 450}
      className={clsx('h-auto w-full rounded-lg', props.className)}
    />
  ),
  h2: (props: any) => (
    <h2
      {...props}
      style={{ fontSize: '30px', marginTop: '3rem', marginBottom: '1.5rem' }}
      className={clsx('font-medium text-black leading-tight', props.className)}
    />
  ),
  h3: (props: any) => (
    <h3
      {...props}
      style={{ fontSize: '24px', marginTop: '1.5rem', marginBottom: '0.75rem' }}
      className={clsx('font-medium leading-tight', props.className)}
    />
  ),
  h4: (props: any) => (
    <h4
      {...props}
      style={{ fontSize: '19px', marginTop: '1.5rem', marginBottom: '0.75rem' }}
      className={clsx('font-medium leading-tight', props.className)}
    />
  ),
  p: (props: any) => (
    <p
      {...props}
      style={{ fontSize: '19px', marginBottom: '1.5rem', fontWeight: '400' }}
      className={clsx('text-gray-800 leading-relaxed', props.className)}
    />
  ),
  ul: (props: any) => (
    <ul
      {...props}
      style={{ fontSize: '19px', marginBottom: '1rem', fontWeight: '400' }}
      className={clsx('list-outside list-disc pl-6 text-gray-800 leading-relaxed', props.className)}
    />
  ),
  ol: (props: any) => (
    <ol
      {...props}
      style={{ fontSize: '19px', marginBottom: '1rem', fontWeight: '400' }}
      className={clsx(
        'list-outside list-decimal pl-6 text-gray-800 leading-relaxed',
        props.className
      )}
    />
  ),
  li: (props: any) => <li {...props} className={clsx('mb-2', props.className)} />,
  strong: (props: any) => <strong {...props} className={clsx('font-semibold', props.className)} />,
  em: (props: any) => <em {...props} className={clsx('italic', props.className)} />,
  a: (props: any) => {
    const isAnchorLink = props.className?.includes('anchor')
    if (isAnchorLink) {
      return <a {...props} />
    }
    return (
      <a
        {...props}
        className={clsx(
          'font-medium text-[#33B4FF] underline hover:text-[#2A9FE8]',
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
      className={clsx('my-8 border-gray-200', props.className)}
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
        <div className='my-6'>
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
            'rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[0.9em] text-red-600',
            props.className
          )}
        />
      )
    }
    return <code {...props} />
  },
}
