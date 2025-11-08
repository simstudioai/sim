import clsx from 'clsx'
import Image from 'next/image'
import type { MDXRemoteProps } from 'next-mdx-remote/rsc'

export const mdxComponents: MDXRemoteProps['components'] = {
  img: (props: any) => (
    <Image
      src={props.src}
      alt={props.alt || ''}
      width={props.width ? Number(props.width) : 800}
      height={props.height ? Number(props.height) : 450}
      className={clsx('w-full rounded-lg', props.className)}
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
  figure: (props: any) => (
    <figure {...props} className={clsx('my-8 overflow-hidden rounded-lg', props.className)} />
  ),
}
