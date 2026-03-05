export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className='h-full overflow-y-auto'>
      <div className='mx-auto max-w-[900px] px-[26px] pt-[36px] pb-[52px]'>{children}</div>
    </div>
  )
}
