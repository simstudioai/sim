export default function TemplatesLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className='flex flex-1 flex-col h-full overflow-hidden bg-muted/40'>
      <div>{children}</div>
    </main>
  )
}
