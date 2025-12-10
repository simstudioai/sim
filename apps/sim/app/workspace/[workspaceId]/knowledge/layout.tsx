/**
 * Knowledge Base layout - applies sidebar padding for all knowledge routes.
 */
export default function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  return <div className='flex h-full flex-1 flex-col pl-60'>{children}</div>
}
