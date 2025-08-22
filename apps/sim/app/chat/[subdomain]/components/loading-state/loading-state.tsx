'use client'

export function ChatLoadingState() {
  return (
    <div className='flex min-h-screen items-center justify-center bg-background text-foreground'>
      <div className='animate-pulse text-center'>
        <div className='mx-auto mb-4 h-8 w-48 rounded bg-muted' />
        <div className='mx-auto h-4 w-64 rounded bg-muted' />
      </div>
    </div>
  )
}
