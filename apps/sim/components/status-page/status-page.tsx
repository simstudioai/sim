import type { ReactNode } from 'react'

interface StatusPageContentProps {
  title: string
  description: string
  children: ReactNode
}

/** Shared centered content for full-page not-found and fatal-error states. */
export function StatusPageContent({ title, description, children }: StatusPageContentProps) {
  return (
    <div className='flex w-full max-w-[410px] flex-col items-center gap-3 text-center'>
      <h1 className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
        {title}
      </h1>
      <p className='text-[var(--text-body)] text-lg'>{description}</p>
      <div className='mt-3 flex flex-wrap items-center justify-center gap-2'>{children}</div>
    </div>
  )
}

interface StatusPageProps extends StatusPageContentProps {
  id?: string
}

/** Shared landing-shell page frame for route-specific not-found states. */
export function StatusPage({ title, description, children, id = 'main-content' }: StatusPageProps) {
  return (
    <main
      id={id}
      className='mx-auto flex min-h-[60vh] w-full max-w-[1728px] flex-col items-center justify-center px-10 py-24 max-md:px-7 max-lg:px-8 max-xl:px-9'
    >
      <StatusPageContent title={title} description={description}>
        {children}
      </StatusPageContent>
    </main>
  )
}
