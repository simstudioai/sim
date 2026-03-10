import type { Metadata } from 'next'
import Form from '@/app/form/[identifier]/form'

export const metadata: Metadata = {
  title: 'Form',
}

export default async function FormPage({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params
  return <Form identifier={identifier} />
}
