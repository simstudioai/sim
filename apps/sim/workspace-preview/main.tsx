import '@/workspace-preview/preview.css'
import { Workflow } from '@sim/emcn/icons'
import { createRoot } from 'react-dom/client'
import { ProductionWorkflowStage } from '@/app/(landing)/components/hero/components/hero-platform-loop/production-workflow-stage'
import {
  STAGE_BLOCKS,
  STAGE_CANVAS,
  STAGE_EDGES,
} from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-data'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import { ResourcePreview } from '@/workspace-preview/resources'

const params = new URLSearchParams(window.location.search)
const theme = params.get('theme')
const system = window.matchMedia('(prefers-color-scheme: dark)')
function syncTheme() {
  document.documentElement.classList.toggle(
    'dark',
    theme === 'dark' || (theme !== 'light' && system.matches)
  )
}
syncTheme()
system.addEventListener('change', syncTheme)

const root = document.getElementById('root')
if (!root) throw new Error('The workspace content needs a root')
const section = params.get('section') ?? ''
const workflowId = params.get('workflow')
const blocks = workflowId === 'account-review' ? STAGE_BLOCKS.slice(0, 3) : STAGE_BLOCKS
const blockIds = new Set(blocks.map(({ id }) => id))
const edges = STAGE_EDGES.filter(([from, to]) => blockIds.has(from) && blockIds.has(to))
createRoot(root).render(
  section === 'w' ? (
    <Resource>
      <Resource.Header
        icon={Workflow}
        title={workflowId === 'account-review' ? 'Account review' : 'Lead enrichment'}
      />
      <div className='relative min-h-0 flex-1'>
        <ProductionWorkflowStage
          blocks={blocks}
          edges={edges}
          builtCount={blocks.length}
          canvas={STAGE_CANVAS}
        />
      </div>
    </Resource>
  ) : (
    <ResourcePreview section={section} scenario={params.get('state')} />
  )
)
