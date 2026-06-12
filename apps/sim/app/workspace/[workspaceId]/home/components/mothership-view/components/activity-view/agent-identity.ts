import type { ComponentType, CSSProperties } from 'react'
import {
  Blimp,
  Bug,
  Connections,
  Database,
  File as FileIcon,
  Folder,
  Hammer,
  Key,
  Library,
  Rocket,
  Search,
  Table as TableIcon,
  Wrench,
} from '@/components/emcn/icons'
import type { MothershipResourceType } from '@/lib/copilot/resources/types'
import type { SceneKind } from './activity-model'

type IconComponent = ComponentType<{ className?: string; style?: CSSProperties }>

export interface AgentIdentity {
  icon: IconComponent
  /** Accent color (hex) for the glyph tint + lane accent. */
  color: string
}

const DEFAULT_IDENTITY: AgentIdentity = { icon: Wrench, color: '#8B8B8B' }

/**
 * Per-subagent visual identity. Colors reuse the existing chat accent palette
 * (see special-tags thinking blocks) so the visualizer feels native.
 */
export const AGENT_IDENTITY: Record<string, AgentIdentity> = {
  mothership: { icon: Blimp, color: '#6E79FF' },
  research: { icon: Search, color: '#2ABBF8' },
  table: { icon: TableIcon, color: '#00C48C' },
  workflow: { icon: Connections, color: '#7B61FF' },
  deploy: { icon: Rocket, color: '#FF7A45' },
  file: { icon: FileIcon, color: '#F5A623' },
  knowledge: { icon: Library, color: '#9B5DE5' },
  debug: { icon: Bug, color: '#FF4E6A' },
  auth: { icon: Key, color: '#FFCC02' },
  agent: { icon: Wrench, color: '#4C9AFF' },
  job: { icon: Hammer, color: '#00B8A9' },
  custom_tool: { icon: Hammer, color: '#FA4EDF' },
  superagent: { icon: Rocket, color: '#6E79FF' },
}

export function agentIdentity(key: string): AgentIdentity {
  return AGENT_IDENTITY[key] ?? DEFAULT_IDENTITY
}

export const SCENE_ACCENT: Record<SceneKind, string> = {
  idle: '#8B8B8B',
  thinking: '#6E79FF',
  'workflow-build': '#7B61FF',
  deploy: '#FF7A45',
  authoring: '#F5A623',
  research: '#2ABBF8',
  data: '#00C48C',
  knowledge: '#9B5DE5',
  execution: '#4C9AFF',
  debug: '#FF4E6A',
  connect: '#FFCC02',
  code: '#4C9AFF',
  'tool-build': '#FA4EDF',
  job: '#00B8A9',
  composite: '#6E79FF',
}

const ARTIFACT_ICON: Record<string, IconComponent> = {
  table: TableIcon,
  file: FileIcon,
  workflow: Connections,
  knowledgebase: Library,
  folder: Folder,
  filefolder: Folder,
  log: Library,
  integration: Database,
  generic: Wrench,
  task: Wrench,
}

export function artifactIcon(type: MothershipResourceType): IconComponent {
  return ARTIFACT_ICON[type] ?? FileIcon
}
