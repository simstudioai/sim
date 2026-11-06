import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  useSidebarChrome,
  WorkspaceChrome,
} from '@/app/workspace/[workspaceId]/components/workspace-chrome'

/** Stands in for the rail: the chrome only owes it collapse and peek state. */
function FixtureRail() {
  const { isCollapsed, isPeeking } = useSidebarChrome()
  return (
    <aside aria-label='Fixture rail' data-peeking={isPeeking || undefined}>
      {!isCollapsed || isPeeking ? <nav aria-label='Expanded rail'>Workflows</nav> : null}
    </aside>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing fixture root')
root.style.cssText = 'display:flex;height:100vh'
createRoot(root).render(
  <StrictMode>
    <WorkspaceChrome sidebar={<FixtureRail />} initialSidebarCollapsed>
      <main>Content</main>
    </WorkspaceChrome>
  </StrictMode>
)
