import { StrictMode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { createRoot } from 'react-dom/client'
import type { McpPresentationReceipt } from '@/lib/mcp/presentation'
import { useDocPreviewBinary } from '@/app/workspace/[workspaceId]/files/components/file-viewer/use-doc-preview-binary'
import { ChatSurfaceProvider } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import { McpResult } from '@/app/workspace/[workspaceId]/home/components/message-content/components/mcp-result/mcp-result'
import { FileContentSourceProvider } from '@/hooks/use-file-content-source'

const queryClient = new QueryClient()
const source = {
  buildUrl: () => '/api/fixture/assets/0',
  resolveImageSrc: () => undefined,
  hasCommittedContent: true,
}
function BinaryPreviewProbe() {
  const preview = useDocPreviewBinary('fixture-workspace', {
    id: 'report',
    key: 'report',
    size: 0,
    updatedAt: new Date(0),
  })
  return (
    <pre>
      {preview.data
        ? `${preview.state}:${new TextDecoder().decode(preview.data.slice(0, 5))}`
        : preview.state}
    </pre>
  )
}
const receipt: McpPresentationReceipt = {
  id: 'a'.repeat(64),
  title: 'Report',
  hasApp: true,
  items: [],
}
const root = document.getElementById('root')
if (!root) throw new Error('Fixture root is missing')

createRoot(root).render(
  <StrictMode>
    <ThemeProvider attribute='class' defaultTheme='light'>
      <QueryClientProvider client={queryClient}>
        <ChatSurfaceProvider chatId='fixture-chat'>
          {location.pathname === '/preview' ? (
            <FileContentSourceProvider value={source}>
              <BinaryPreviewProbe />
            </FileContentSourceProvider>
          ) : (
            <McpResult receipt={receipt} />
          )}
        </ChatSurfaceProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)
