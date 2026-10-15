import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@sim/emcn'
import Link from 'next/link'
import { SITE_URL } from '@/lib/core/utils/urls'
import { blockTypeToIconMap, INTEGRATIONS } from '@/lib/integrations'
import { IntegrationIcon } from '@/app/(landing)/integrations/components/integration-icon'
import { getProviderBySlug } from '@/app/(landing)/models/utils'

interface ChangelogLinkProps extends ComponentPropsWithoutRef<'a'> {}

const SITE_HOST = new URL(SITE_URL).hostname
const SITE_APEX = SITE_HOST.replace(/^www\./, '')
const INTEGRATIONS_BY_PATH = new Map(
  INTEGRATIONS.map((integration) => [`/integrations/${integration.slug}`, integration])
)
const INTEGRATIONS_BY_DOCS = new Map(
  INTEGRATIONS.map((integration) => [integration.docsUrl, integration])
)

/** Decorates catalog links with the same brand marks used on their destination pages. */
export function ChangelogLink({ href, children, className, ...props }: ChangelogLinkProps) {
  let url: URL | undefined
  try {
    if (href) url = new URL(href, SITE_URL)
  } catch {}

  const isSite = url?.hostname === SITE_HOST || url?.hostname === SITE_APEX
  const isExternal = url && url.hostname !== SITE_APEX && !url.hostname.endsWith(`.${SITE_APEX}`)
  const pathname = url?.pathname.replace(/\/$/, '')
  const integration = isSite
    ? INTEGRATIONS_BY_PATH.get(pathname ?? '')
    : url && INTEGRATIONS_BY_DOCS.get(`${url.origin}${pathname}`)
  const providerSlug = isSite ? pathname?.match(/^\/models\/([^/]+)(?:\/[^/]+)?$/)?.[1] : undefined
  const ProviderIcon = providerSlug ? getProviderBySlug(providerSlug)?.icon : undefined
  const isHeadingAnchor = className?.split(' ').includes('anchor')
  const icon = !isHeadingAnchor && (integration || ProviderIcon)

  const content = (
    <>
      {icon ? (
        <span aria-hidden='true' className='mr-1 inline-flex align-[-0.15em]'>
          {integration ? (
            <IntegrationIcon
              as='span'
              name={integration.name}
              bgColor={integration.bgColor}
              Icon={blockTypeToIconMap[integration.type]}
              className='size-4 rounded-sm'
              iconClassName='size-3'
              fallbackClassName='text-xs'
            />
          ) : ProviderIcon ? (
            <ProviderIcon className='size-4' />
          ) : null}
        </span>
      ) : null}
      {children}
    </>
  )
  const linkClassName = cn(
    isHeadingAnchor
      ? 'text-inherit no-underline'
      : 'text-[var(--text-primary)] underline decoration-[var(--border)] underline-offset-4 transition-colors hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-4',
    className
  )

  return href && isSite ? (
    <Link {...props} href={href} prefetch={false} className={linkClassName}>
      {content}
    </Link>
  ) : (
    <a
      {...props}
      href={href}
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={linkClassName}
    >
      {content}
    </a>
  )
}
