'use client'

import { PageError } from '@/app/(product)/_components/shell-gate/shell-gate'

export default function ErrorPage({ retry }: { retry: () => void }) {
  return <PageError retry={retry} />
}
