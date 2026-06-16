import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { Table } from './table'

export const metadata: Metadata = {
  title: 'Table',
}

export default async function TablePage() {
  const session = await getSession(await headers())
  const workflowColumnsEnabled = await isFeatureEnabled('workflow-columns', {
    userId: session?.user?.id,
  })
  return <Table workflowColumnsEnabled={workflowColumnsEnabled} />
}
