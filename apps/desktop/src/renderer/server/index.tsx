import { createRoot } from 'react-dom/client'
import { ServerModal } from '@/renderer/server/server-modal'
import { initializeShellPage, shellWindow } from '@/renderer/shell'
import '@/renderer/shell.css'

const container = document.getElementById('root')
if (!container || !shellWindow) throw new Error('Server modal host is unavailable')
const server = shellWindow.server
const root = createRoot(container)

async function renderServerModal() {
  try {
    const configuration = await server.getConfiguration()
    root.render(<ServerModal server={server} configuration={configuration} />)
  } catch {
    root.render(<ServerModal server={server} initialError='Could not read the current server.' />)
  }
}

void initializeShellPage().then(renderServerModal)
