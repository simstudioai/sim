import Nav from '@/app/(landing)/components/nav/nav'

export default function BuildingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav hideAuthButtons={false} variant='landing' />
      {children}
    </>
  )
}
