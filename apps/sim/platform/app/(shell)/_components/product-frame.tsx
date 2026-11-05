import type { ReactNode } from 'react'
import type { ShellData } from '@/platform/app/(shell)/_components/model'
import { PlatformShell } from '@/platform/app/(shell)/_components/platform-shell/platform-shell'
import { ProductSurface } from '@/platform/app/(shell)/_components/session/product-surface'
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
