import type { InterfaceControl, InterfaceSpec } from '@/lib/interfaces/spec/schema'

const COLOR_PATTERN = /^(#[0-9A-Fa-f]{3,8}|var\(--[a-zA-Z0-9-]+\))$/
const DEFAULT_PRIMARY_COLOR = 'var(--brand-hover)'

function resolvePrimaryColor(...candidates: Array<string | undefined | null>): string {
  for (const candidate of candidates) {
    if (candidate && COLOR_PATTERN.test(candidate)) return candidate
  }
  return DEFAULT_PRIMARY_COLOR
}

export interface InterfacePresentation {
  title: string
  description?: string | null
  primaryColor?: string
}

/** Public-safe control (no bind / field mapping). */
export type PublicInterfaceControl =
  | {
      type: 'text' | 'textarea' | 'number' | 'checkbox'
      id: string
      label: string
      required?: boolean
      placeholder?: string
    }
  | {
      type: 'select'
      id: string
      label: string
      required?: boolean
      options: Array<{ label: string; value: string }>
    }
  | {
      type: 'markdown'
      id: string
      content: string
    }

export interface PublicInterfaceDto {
  title: string
  description?: string
  primaryColor: string
  density?: 'comfortable' | 'compact'
  pageDescription?: string
  sections: Array<{
    id: string
    title?: string
    controls: PublicInterfaceControl[]
  }>
  actions: Array<{
    id: string
    label: string
    variant: 'primary' | 'secondary'
  }>
  messages?: {
    success?: string
    error?: string
  }
  auth: { type: 'public' }
}

function toPublicControl(control: InterfaceControl): PublicInterfaceControl {
  if (control.type === 'markdown') {
    return { type: 'markdown', id: control.id, content: control.content }
  }
  if (control.type === 'select') {
    return {
      type: 'select',
      id: control.id,
      label: control.label,
      required: control.required,
      options: control.options,
    }
  }
  if (control.type === 'text' || control.type === 'textarea') {
    return {
      type: control.type,
      id: control.id,
      label: control.label,
      required: control.required,
      placeholder: control.placeholder,
    }
  }
  return {
    type: control.type,
    id: control.id,
    label: control.label,
    required: control.required,
  }
}

/**
 * Merge deployment-owned presentation with the private spec into a public DTO.
 * Never includes fieldMapping, bind, brief, or outputConfigs.
 */
export function toPublicInterfaceDto(
  presentation: InterfacePresentation,
  spec: InterfaceSpec
): PublicInterfaceDto {
  return {
    title: presentation.title || spec.page.title || 'Interface',
    description: presentation.description || spec.page.description || undefined,
    primaryColor: resolvePrimaryColor(presentation.primaryColor, spec.theme.primaryColor),
    density: spec.theme.density,
    pageDescription: spec.page.description,
    sections: spec.sections.map((section) => ({
      id: section.id,
      title: section.title,
      controls: section.controls.map(toPublicControl),
    })),
    actions: spec.actions.map((action) => ({
      id: action.id,
      label: action.label,
      variant: action.variant ?? 'primary',
    })),
    messages: spec.messages,
    auth: { type: 'public' },
  }
}
