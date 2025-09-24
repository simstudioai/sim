import Nav from '@/app/(landing)/components/nav/nav'

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='min-h-screen bg-background font-geist-sans text-foreground'>
      <Nav />
      {children}
    </div>
  )
}
