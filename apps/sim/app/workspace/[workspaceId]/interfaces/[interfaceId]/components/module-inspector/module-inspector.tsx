'use client'

import type React from 'react'
import { useState } from 'react'
import { Button, FieldDivider, Tooltip } from '@sim/emcn'
import { Trash } from '@sim/emcn/icons'
import type { InterfaceModule } from '@/lib/interfaces'
import { ChatModuleFields } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector/components/chat-module-fields'
import { FileModuleFields } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector/components/file-module-fields'
import { FormModuleFields } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector/components/form-module-fields'
import { TableModuleFields } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/components/module-inspector/components/table-module-fields'
import type { InterfaceMode } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/search-params'
import { INTERFACE_MODULE_META } from '@/app/workspace/[workspaceId]/interfaces/[interfaceId]/utils'

export interface ModuleInspectorProps {
  workspaceId: string
  interfaceId: string
  /** `null` = no selection → renders the "Select a module to edit" empty state. */
  module: InterfaceModule | null
  mode: InterfaceMode
  canEdit: boolean
  /**
   * `isValid` reports whether the emitted config is safe to persist, so the
   * page can hold an intermediate edit (an empty field name, a blank submit
   * label) locally instead of PATCHing a layout the contract would reject.
   */
  onConfigChange: (moduleId: string, config: InterfaceModule['config'], isValid: boolean) => void
  onRemoveModule: (moduleId: string) => void
}

/**
 * Always-present properties panel for the interface canvas, mirroring the
 * workflow editor's right panel and the table detail sidebars.
 *
 * The `<aside>` never closes and never animates — it is a flex sibling of the
 * canvas fixed at the workflow panel's resting width (`PANEL_WIDTH.DEFAULT`,
 * inlined because Tailwind cannot read a value from JavaScript), so selecting a
 * module swaps the panel body rather than sliding a surface in. Persistence is
 * automatic: every edit is mirrored up
 * through `onConfigChange`, which the page debounces, so the panel carries no
 * Save/Cancel footer.
 *
 * Preview mode and read-only members get the same panel with every control
 * disabled, keeping the layout stable across mode switches.
 */
export function ModuleInspector({
  workspaceId,
  module,
  mode,
  canEdit,
  onConfigChange,
  onRemoveModule,
}: ModuleInspectorProps) {
  const meta = module ? INTERFACE_MODULE_META[module.type] : null

  return (
    <aside
      aria-label='Module properties'
      className='flex w-[320px] shrink-0 flex-col overflow-hidden border-[var(--border)] border-l bg-[var(--bg)]'
    >
      <div className='flex min-h-[48px] items-center justify-between border-[var(--border)] border-b px-3 py-[8.5px]'>
        <h2 className='font-medium text-[var(--text-primary)] text-small'>
          {meta?.label ?? 'Properties'}
        </h2>
        {module && meta && mode === 'edit' && canEdit && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => onRemoveModule(module.id)}
                className='!p-1 size-7'
                aria-label={`Remove ${meta.label} module`}
              >
                <Trash className='size-[14px]' />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>Remove {meta.label} module</Tooltip.Content>
          </Tooltip.Root>
        )}
      </div>

      {module ? (
        <ModuleInspectorBody
          key={module.id}
          workspaceId={workspaceId}
          module={module}
          disabled={mode === 'preview' || !canEdit}
          onConfigChange={onConfigChange}
        />
      ) : (
        <div className='flex flex-1 items-center justify-center text-[var(--text-placeholder)] text-small'>
          {/** Preview has no select handle, so "select a module" is advice that mode cannot take. */}
          {mode === 'preview' ? 'Switch to edit to configure a module' : 'Select a module to edit'}
        </div>
      )}
    </aside>
  )
}

interface ModuleInspectorBodyProps {
  workspaceId: string
  module: InterfaceModule
  disabled: boolean
  onConfigChange: (moduleId: string, config: InterfaceModule['config'], isValid: boolean) => void
}

/**
 * Scroll well for one selected module. Mounted with `key={module.id}` by
 * {@link ModuleInspector}, so switching modules remounts the draft rather than
 * carrying another module's config across.
 *
 * Leaving the `let section` assignment to an exhaustive `switch` is
 * deliberate: adding a fifth module type turns the missing branch into a
 * definite-assignment compile error rather than a silently blank panel.
 */
function ModuleInspectorBody({
  workspaceId,
  module,
  disabled,
  onConfigChange,
}: ModuleInspectorBodyProps) {
  const meta = INTERFACE_MODULE_META[module.type]
  const Icon = meta.icon

  /**
   * Wires one narrowed config to its section. Every branch renders the same
   * `ModuleConfigDraft` element type, so `key` pins the seeded draft to the
   * module type — a section swap can never inherit another type's config.
   */
  function renderSection<TConfig extends InterfaceModule['config']>(
    Section: React.ComponentType<ModuleConfigSectionProps<TConfig>>,
    config: TConfig
  ) {
    return (
      <ModuleConfigDraft
        key={module.type}
        section={Section}
        workspaceId={workspaceId}
        config={config}
        onCommit={(next, isValid) => onConfigChange(module.id, next, isValid)}
        disabled={disabled}
      />
    )
  }

  let section: React.JSX.Element
  switch (module.type) {
    case 'chat':
      section = renderSection(ChatModuleFields, module.config)
      break
    case 'form':
      section = renderSection(FormModuleFields, module.config)
      break
    case 'table':
      section = renderSection(TableModuleFields, module.config)
      break
    case 'file':
      section = renderSection(FileModuleFields, module.config)
      break
  }

  return (
    <div className='flex-1 overflow-y-auto overflow-x-hidden px-2 pt-3 pb-2 [overflow-anchor:none]'>
      <div className='flex items-center gap-2 pl-0.5'>
        <Icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
        <p className='truncate text-[var(--text-muted)] text-caption'>{meta.description}</p>
      </div>
      <FieldDivider />
      {section}
    </div>
  )
}

/** Prop shape every per-type config section shares. */
interface ModuleConfigSectionProps<TConfig> {
  workspaceId: string
  value: TConfig
  /** `isValid` reports whether `next` is safe to persist. */
  onChange: (next: TConfig, isValid: boolean) => void
  disabled?: boolean
}

interface ModuleConfigDraftProps<TConfig> {
  section: React.ComponentType<ModuleConfigSectionProps<TConfig>>
  workspaceId: string
  /** The persisted config. Seeds the draft and re-seeds it on an external write. */
  config: TConfig
  onCommit: (config: TConfig, isValid: boolean) => void
  disabled: boolean
}

/**
 * Holds the local editing draft for one module's config and mirrors every
 * change upward as it happens.
 *
 * The draft exists only to keep typing snappy while the page debounces the
 * write, so it must yield to writes it did not make — an agent edit, a
 * teammate's save, a refetch. Those arrive as a new `config` prop and re-seed
 * the draft during render (per `.claude/rules/sim-hooks.md`), except while an
 * edit of ours is still unconfirmed: the page patches the query cache with the
 * exact object we emitted, so an incoming config that is not that object is
 * either an older echo of our own keystrokes or a write we would clobber the
 * user's newer text with. Those are dropped; the next confirmation re-opens the
 * draft to external writes.
 *
 * Generic over the config type so the caller's `switch` on `module.type`
 * narrows the config and the matching section component together — the whole
 * panel stays free of casts.
 */
function ModuleConfigDraft<TConfig>({
  section: Section,
  workspaceId,
  config,
  onCommit,
  disabled,
}: ModuleConfigDraftProps<TConfig>) {
  const [draft, setDraft] = useState<TConfig>(config)
  const [seenConfig, setSeenConfig] = useState<TConfig>(config)
  /** The last config emitted upward, until the page echoes it back. */
  const [unconfirmed, setUnconfirmed] = useState<TConfig | null>(null)

  if (seenConfig !== config) {
    setSeenConfig(config)
    if (config === unconfirmed) setUnconfirmed(null)
    else if (unconfirmed === null) setDraft(config)
  }

  const handleChange = (next: TConfig, isValid: boolean) => {
    setDraft(next)
    setUnconfirmed(next)
    onCommit(next, isValid)
  }

  return (
    <Section workspaceId={workspaceId} value={draft} onChange={handleChange} disabled={disabled} />
  )
}
