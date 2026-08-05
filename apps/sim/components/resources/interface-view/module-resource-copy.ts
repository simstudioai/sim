/**
 * The copy every surface uses to bind a module to a workspace resource — the
 * in-canvas picker an unconfigured module renders, and the inspector field the
 * builder repoints it from. Spelling "Select a workflow" twice is how the two
 * drift apart.
 *
 * Pure strings — no React — so both the renderers and the route tree can read
 * them, and so the constant costs nothing to import.
 *
 * It lives here, beside `module-chrome.ts`, rather than under the interfaces
 * route because the canvas side is the canonical view: an anonymous share page
 * mounts `InterfaceView` with no workspace route above it. The route tree may
 * import from here; nothing here may import from the route tree.
 */

/** The workspace resources a module can be bound to. */
export type ModuleResourceKind = 'workflow' | 'table' | 'file'

interface ModuleResourceCopy {
  /** Chooser header and inspector field title; doubles as the `aria-label`. */
  title: string
  placeholder: string
  searchPlaceholder: string
  emptyMessage: string
  /** Shown when a bound id no longer resolves against the workspace list. */
  missingMessage: string
}

export const MODULE_RESOURCE_COPY: Record<ModuleResourceKind, ModuleResourceCopy> = {
  workflow: {
    title: 'Workflow',
    placeholder: 'Select a workflow',
    searchPlaceholder: 'Search workflows...',
    emptyMessage: 'No workflows in this workspace',
    missingMessage: 'This workflow is no longer in the workspace.',
  },
  table: {
    title: 'Table',
    placeholder: 'Select a table',
    searchPlaceholder: 'Search tables...',
    emptyMessage: 'No tables in this workspace',
    missingMessage: 'This table is no longer in the workspace.',
  },
  file: {
    title: 'File',
    placeholder: 'Select a file',
    searchPlaceholder: 'Search files...',
    emptyMessage: 'No files in this workspace',
    missingMessage: 'This file is no longer in the workspace.',
  },
}
