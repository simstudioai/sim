import type { Metadata } from 'next'
import { Table } from './table'

export const metadata: Metadata = {
  title: 'Table',
}

export default function TablePage() {
  return <Table />
}
