import type { Metadata } from 'next'
import { TablesDetail } from './tables-detail'

export const metadata: Metadata = {
  title: 'Table',
}

export default function TablePage() {
  return <TablesDetail />
}
