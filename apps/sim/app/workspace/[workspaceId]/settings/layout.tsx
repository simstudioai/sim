export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='h-full overflow-y-auto [scrollbar-gutter:stable]'>
      <div className='mx-auto flex min-h-full max-w-[900px] flex-col px-[26px] pt-9 pb-[52px]'>
        {children}
      </div>
    </div>
  )
}
