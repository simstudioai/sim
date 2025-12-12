import Nav from '@/app/(landing)/components/nav/nav'

export default function ChangelogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='min-h-screen bg-background text-foreground'>
      <Nav />
      {children}
    </div>
  )
}
