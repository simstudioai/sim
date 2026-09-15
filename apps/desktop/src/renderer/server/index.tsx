import { createRoot } from 'react-dom/client'
import { ServerModal } from '@/renderer/server/server-modal'
import { initializeShellPage, shellWindow } from '@/renderer/shell'
import '@/renderer/shell.css'

initializeShellPage()
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.close()
})

const server = shellWindow?.server
const container = document.getElementById('root')
if (!container) throw new Error('Server modal root is missing')
const root = createRoot(container)

async function renderServerModal() {
  try {
    const configuration = await server?.getConfiguration()
    root.render(<ServerModal server={server} configuration={configuration} />)
  } catch {
    root.render(<ServerModal server={server} initialError='Could not read the current server.' />)
  }
}

void renderServerModal()
