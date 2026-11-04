import { type ReactNode, Suspense } from 'react'
import { ProductSession } from '@/platform/app/(shell)/_components/product-session'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ProductSession>{children}</ProductSession>
    </Suspense>
  )
}
