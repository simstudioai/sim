/**
 * Presentation metadata for the four interface module types. Shared by the
 * canvas, the module picker, and the inspector so a module's icon, label, and
 * description are declared exactly once.
 *
 * Construction defaults live in `@/lib/interfaces/constants` — the same
 * database-free module the service builds from — so an optimistic client
 * layout can never disagree with what the server persists.
 */

import type { ComponentType } from 'react'
import { BubbleChat, File, FormInput, Table } from '@sim/emcn/icons'
import type { InterfaceModuleType } from '@/lib/interfaces/types'

export interface InterfaceModuleMeta {
  type: InterfaceModuleType
  label: string
  /** One-line description shown in the inspector header. */
  description: string
  icon: ComponentType<{ className?: string }>
}

/**
 * Picker rank — most-reached-for first. Keyed by the module union so widening
 * `InterfaceModuleType` is a compile error here rather than a type silently
 * missing from the picker.
 */
const INTERFACE_MODULE_RANK: Record<InterfaceModuleType, number> = {
  chat: 0,
  form: 1,
  table: 2,
  file: 3,
}

/** Picker order — most-reached-for first. */
export const INTERFACE_MODULE_ORDER: readonly InterfaceModuleType[] = (
  Object.keys(INTERFACE_MODULE_RANK) as InterfaceModuleType[]
).sort((a, b) => INTERFACE_MODULE_RANK[a] - INTERFACE_MODULE_RANK[b])

export const INTERFACE_MODULE_META: Record<InterfaceModuleType, InterfaceModuleMeta> = {
  chat: { type: 'chat', label: 'Chat', description: 'Chat with a workflow', icon: BubbleChat },
  form: {
    type: 'form',
    label: 'Form',
    description: 'Collect input, run a workflow',
    icon: FormInput,
  },
  table: { type: 'table', label: 'Table', description: 'Show a workspace table', icon: Table },
  file: { type: 'file', label: 'File', description: 'Preview a workspace file', icon: File },
}
