import type { ComponentType, SVGProps } from 'react'
import { Clock, Database, Layers, Repeat, Table } from 'lucide-react'
import {
  ApiIcon,
  ChartBarIcon,
  CodeIcon,
  ConditionalIcon,
  ConnectIcon,
  CredentialIcon,
  HumanInTheLoopIcon,
  ResponseIcon,
  RssIcon,
  ScheduleIcon,
  ShieldCheckIcon,
  VariableIcon,
  WebhookIcon,
  WorkflowIcon,
} from '@/components/icons'
import { blockTypeToIconMap } from '@/components/ui/icon-mapping'

/**
 * The two Sim-specific block glyphs we need, ported verbatim from
 * `apps/sim/components/icons.tsx` so the preview matches the real builder.
 * Other block types fall back to lucide-react stand-ins for now.
 */
export function StartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='26'
      height='16'
      viewBox='0 0 26 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M7.8 13C9.23 13 10.45 12.49 11.47 11.47C12.49 10.45 13 9.23 13 7.8C13 6.37 12.49 5.15 11.47 4.13C10.45 3.11 9.23 2.6 7.8 2.6C6.37 2.6 5.15 3.11 4.13 4.13C3.11 5.15 2.6 6.37 2.6 7.8C2.6 9.23 3.11 10.45 4.13 11.47C5.15 12.49 6.37 13 7.8 13ZM7.8 15.6C5.63 15.6 3.79 14.84 2.28 13.33C0.76 11.81 0 9.97 0 7.8C0 5.63 0.76 3.79 2.28 2.28C3.79 0.76 5.63 0 7.8 0C9.75 0 11.45 0.62 12.89 1.85C14.33 3.09 15.2 4.64 15.5 6.5H24.7C25.07 6.5 25.38 6.62 25.63 6.87C25.88 7.12 26 7.43 26 7.8C26 8.17 25.87 8.48 25.63 8.73C25.38 8.98 25.07 9.1 24.7 9.1H15.5C15.2 10.96 14.33 12.51 12.89 13.75C11.44 14.98 9.75 15.6 7.8 15.6Z'
        fill='currentColor'
      />
    </svg>
  )
}

export function AgentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      width='21'
      height='24'
      viewBox='0 0 21 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M15.67 9.25H4.67C2.64 9.25 1 10.89 1 12.92V18.42C1 20.44 2.64 22.08 4.67 22.08H15.67C17.69 22.08 19.33 20.44 19.33 18.42V12.92C19.33 10.89 17.69 9.25 15.67 9.25Z'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M10.17 5.58C11.18 5.58 12 4.76 12 3.75C12 2.74 11.18 1.92 10.17 1.92C9.15 1.92 8.33 2.74 8.33 3.75C8.33 4.76 9.15 5.58 10.17 5.58Z'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M10.17 5.59V9.25M7.42 16.59V14.75M12.92 14.75V16.59'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

/** Block type → glyph. Brand glyphs from the app for core blocks; lucide stand-ins for the rest. */
export const BLOCK_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  starter: StartIcon,
  start_trigger: StartIcon,
  agent: AgentIcon,
  api: ApiIcon,
  condition: ConditionalIcon,
  credential: CredentialIcon,
  evaluator: ChartBarIcon,
  function: CodeIcon,
  guardrails: ShieldCheckIcon,
  human_in_the_loop: HumanInTheLoopIcon,
  response: ResponseIcon,
  router: ConnectIcon,
  variables: VariableIcon,
  wait: Clock,
  webhook: WebhookIcon,
  workflow: WorkflowIcon,
  schedule: ScheduleIcon,
  rss: RssIcon,
  loop: Repeat,
  parallel: Layers,
  knowledge_base: Database,
  knowledge: Database,
  table: Table,
}

/**
 * Resolves a block (or tool) type to its glyph: the core-block map first, then
 * the integration icon map so diagrams can render tool chips too. Returns
 * `null` when no glyph is registered.
 */
export function resolveIcon(type: string): ComponentType<{ className?: string }> | null {
  return BLOCK_ICONS[type] ?? blockTypeToIconMap[type] ?? null
}
