/**
 * Templates layout - applies sidebar padding for all template routes.
 */
export default function TemplatesLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className='flex h-full flex-1 flex-col overflow-hidden bg-muted/40 pl-64'>
      <div>{children}</div>
    </main>
  )
}
