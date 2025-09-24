import { notFound } from 'next/navigation'
import { env } from '@/lib/env'
import { FormRenderer } from './components/form-renderer'

interface FormPageProps {
  params: Promise<{
    formId: string
  }>
}

async function getFormData(formId: string) {
  try {
    const response = await fetch(`${env.NEXT_PUBLIC_APP_URL}/api/forms/${formId}`, {
      cache: 'no-store',
    })

    if (!response.ok) {
      return null
    }

    return await response.json()
  } catch (error) {
    console.error('Error fetching form data:', error)
    return null
  }
}

export default async function FormPage({ params }: FormPageProps) {
  const { formId } = await params
  const formData = await getFormData(formId)

  if (!formData) {
    notFound()
  }

  return (
    <div className='min-h-screen bg-background'>
      <div className='container mx-auto max-w-2xl px-4 py-10'>
        <div className='rounded-xl border bg-card p-6 shadow-sm'>
          <div className='space-y-6'>
            <div className='text-center'>
              <h1 className='font-semibold text-foreground text-xl tracking-tight sm:text-2xl'>
                {formData.title}
              </h1>
              {formData.description && (
                <p className='mx-auto mt-1 max-w-prose text-balance text-muted-foreground text-sm'>
                  {formData.description}
                </p>
              )}
              <div className='mt-4 border-border border-b' />
            </div>

            <FormRenderer
              formId={formId}
              formConfig={formData.formConfig}
              styling={formData.styling}
              settings={formData.settings}
            />
          </div>
        </div>

        {/* Powered by Sim */}
        <div className='mt-8 text-center'>
          <a
            href='https://sim.ai'
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground'
          >
            <span>Powered by</span>
            <img src='/logo/reverse/text/medium.png' alt='Sim' className='h-4' />
          </a>
        </div>
      </div>
    </div>
  )
}

export async function generateMetadata({ params }: FormPageProps) {
  const { formId } = await params
  const formData = await getFormData(formId)

  if (!formData) {
    return {
      title: 'Form Not Found',
    }
  }

  return {
    title: formData.title,
    description: formData.description || 'Fill out this form',
  }
}
