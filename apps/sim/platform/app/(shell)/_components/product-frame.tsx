import type { ReactNode } from 'react'
import { ProductSurface } from '@/platform/design-system/components/product-surface'
import { PlatformShell } from '@/platform/design-system/features/shell/platform-shell'
import type { ShellData } from '@/platform/design-system/models/shell'
import { readAppearance } from '@/platform/design-system/navigation'
import type { Scenario } from '@/platform/fixtures'

type ProductQuery = Record<string, string | string[] | undefined>

export function readScenario(query: ProductQuery): Scenario {
  return query.state === 'empty' || query.state === 'stress' ? query.state : 'full'
}

interface ProductFrameProps {
  query: ProductQuery
  shell: ShellData | null
  desktopTitle?: string
  navigation?: ReactNode
  children: ReactNode
}

export function ProductFrame({
  children,
  query,
  shell,
  navigation,
  desktopTitle,
}: ProductFrameProps) {
  return (
    <ProductSurface preference={readAppearance(query.theme)}>
      <PlatformShell data={shell} desktopTitle={desktopTitle} navigation={navigation}>
        {children}
      </PlatformShell>
    </ProductSurface>
  )
}
