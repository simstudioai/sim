export function AccessRequestsLoading() {
  return (
    <main className='flex h-full min-h-0 flex-col bg-[var(--bg)]'>
      <div className='mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8'>
        <h1 className='text-[var(--text-primary)] text-lg'>Access requests</h1>
        <p role='status' className='text-[var(--text-muted)] text-sm'>
          Loading access requests...
        </p>
      </div>
    </main>
  )
}
