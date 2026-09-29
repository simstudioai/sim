import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { env, isTruthy } from '@/lib/core/config/env'
import { ProtoShell } from '@/app/playground/org/components/proto-shell'

/** Mock-data prototype of the org-level workspace view. Gated like the EMCN playground. */
export default function OrgPrototypeLayout({ children }: { children: ReactNode }) {
  if (!isTruthy(env.NEXT_PUBLIC_ENABLE_PLAYGROUND)) notFound()
  return <ProtoShell>{children}</ProtoShell>
}
