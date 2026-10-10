import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@sim/emcn'
import type { MDXRemoteProps } from 'next-mdx-remote/rsc'
import { ChangelogImage, ChangelogVideo } from '@/app/(landing)/changelog/components'
import { HOME_TYPE } from '@/app/(landing)/components/landing-layout'
import { PROSE_TYPE } from '@/app/(landing)/components/prose-page/constants'

export const changelogComponents = {
  ChangelogVideo,
  ChangelogImage,
  h3: ({ className, ...props }: ComponentPropsWithoutRef<'h3'>) => (
    <h3 {...props} className={cn('mt-8 mb-3 text-balance', PROSE_TYPE.h2, className)} />
  ),
  h4: ({ className, ...props }: ComponentPropsWithoutRef<'h4'>) => (
    <h4 {...props} className={cn('mt-6 mb-3', PROSE_TYPE.h3, className)} />
  ),
  p: ({ className, ...props }: ComponentPropsWithoutRef<'p'>) => (
    <p
      {...props}
      className={cn(
        HOME_TYPE.body,
        'mb-4 text-pretty text-[var(--text-body)] leading-relaxed',
        className
      )}
    />
  ),
  ul: ({ className, ...props }: ComponentPropsWithoutRef<'ul'>) => (
    <ul
      {...props}
      className={cn(
        HOME_TYPE.body,
        'mb-4 list-disc space-y-2 pl-6 text-[var(--text-body)] leading-relaxed marker:text-[var(--text-muted)]',
        className
      )}
    />
  ),
  ol: ({ className, ...props }: ComponentPropsWithoutRef<'ol'>) => (
    <ol
      {...props}
      className={cn(
        HOME_TYPE.body,
        'mb-4 list-decimal space-y-2 pl-6 text-[var(--text-body)] leading-relaxed marker:text-[var(--text-muted)]',
        className
      )}
    />
  ),
} satisfies MDXRemoteProps['components']
