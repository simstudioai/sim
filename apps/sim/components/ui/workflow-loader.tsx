import { WordmarkMorph } from '@/components/ui/wordmark-morph'

interface WorkflowLoaderProps {
  label?: string
}

/** Brand loading state for workspace navigation and workflow canvases. */
export function WorkflowLoader({ label = 'Loading workflow' }: WorkflowLoaderProps) {
  return (
    <div role='status'>
      <WordmarkMorph />
      <span className='sr-only'>{label}</span>
    </div>
  )
}
