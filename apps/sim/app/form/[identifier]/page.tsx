import Form from '@/app/form/[identifier]/form'

export default async function FormPage({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params
  return <Form identifier={identifier} />
}
