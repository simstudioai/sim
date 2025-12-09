/**
 * Logs layout - applies sidebar padding for all logs routes.
 */
export default function LogsLayout({ children }: { children: React.ReactNode }) {
  return <div className='flex h-full flex-1 flex-col pl-60'>{children}</div>
}
