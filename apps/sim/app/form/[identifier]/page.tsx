import FormClient from '@/app/form/[identifier]/form-client'

export default async function FormPage({ params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params
  return <FormClient identifier={identifier} />
}
