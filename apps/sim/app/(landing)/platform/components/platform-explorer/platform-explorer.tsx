'use client'

import { useId, useState } from 'react'
import { Chip } from '@sim/emcn'
import { LandingCtaLink } from '@/app/(landing)/components/landing-cta-link'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'
import { ProductHeroPreview } from '@/app/(landing)/components/solutions-page/components/solutions-product-page/components/product-hero-preview'

const PRODUCTS = [
  { id: 'workflows', label: 'Workflows', href: '/workflows' },
  { id: 'knowledge', label: 'Knowledge Base', href: '/knowledge' },
  { id: 'files', label: 'Files', href: '/files' },
  { id: 'tables', label: 'Tables', href: '/tables' },
  { id: 'logs', label: 'Logs', href: '/logs' },
  { id: 'enterprise', label: 'Enterprise', href: '/enterprise' },
] as const

type ProductId = (typeof PRODUCTS)[number]['id']

/** A switchable, open product stage reuses the navigation's actual UI previews. */
export function PlatformExplorer() {
  const previewId = useId()
  const [selectedId, setSelectedId] = useState<ProductId>('workflows')
  const selected = PRODUCTS.find((product) => product.id === selectedId) ?? PRODUCTS[0]

  return (
    <div data-platform-explorer className='absolute inset-0 bg-[var(--bg)]'>
      <div
        role='group'
        aria-label='Choose a product preview'
        className='absolute inset-x-0 top-7 z-10 overflow-x-auto px-7 pb-2 max-sm:top-3'
      >
        <div className='mx-auto flex w-max items-center gap-2'>
          {PRODUCTS.map((product) => (
            <Chip
              key={product.id}
              active={selectedId === product.id}
              aria-pressed={selectedId === product.id}
              aria-controls={previewId}
              onClick={() => setSelectedId(product.id)}
            >
              {product.label}
            </Chip>
          ))}
        </div>
      </div>
      <div
        id={previewId}
        role='region'
        aria-label={`${selected.label} preview`}
        className='absolute inset-x-0 top-20 max-sm:top-14'
      >
        <ProductHeroPreview key={selectedId} product={selectedId} />
        <EdgeFade ground='canvas' edges={['bottom']} depth='stage' />
      </div>
      <div className='absolute inset-x-7 bottom-6 z-10 flex justify-center max-sm:bottom-3'>
        <LandingCtaLink href={selected.href} variant='outline' withArrow>
          Explore {selected.label}
        </LandingCtaLink>
      </div>
      <p role='status' aria-live='polite' className='sr-only'>
        Showing {selected.label}
      </p>
    </div>
  )
}
