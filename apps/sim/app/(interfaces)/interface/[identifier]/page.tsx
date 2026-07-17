import type { Metadata } from 'next'
import { InterfaceRuntime } from '@/app/(interfaces)/interface/[identifier]/interface-runtime'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
}

export default async function InterfacePage({
  params,
}: {
  params: Promise<{ identifier: string }>
}) {
  const { identifier } = await params

  return <InterfaceRuntime identifier={identifier} />
}
