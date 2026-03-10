export default function FilesLayout({ children }: { children: React.ReactNode }) {
  return <div className='flex h-full flex-1 flex-col overflow-hidden'>{children}</div>
}
