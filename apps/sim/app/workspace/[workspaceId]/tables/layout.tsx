/**
 * Tables layout - applies sidebar padding for all table routes.
 */
export default function TablesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='flex h-full flex-1 flex-col overflow-hidden pl-[var(--sidebar-width)]'>
      {children}
    </div>
  )
}
