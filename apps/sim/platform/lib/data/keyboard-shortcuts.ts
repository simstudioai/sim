import { COMMAND_DEFINITIONS, type CommandId } from '@/lib/global-commands/commands'

interface ShortcutRow {
  id: string
  label: string
  keys: string
}

interface ShortcutGroup {
  title: string
  rows: ShortcutRow[]
}

/**
 * Where each registered command is listed and what it is called. Typed over every `CommandId`, so a
 * command added to the registry fails type-check until it has a row here.
 */
const COMMAND_ROWS: Record<CommandId, { group: 'Navigation' | 'Workflow editor'; label: string }> =
  {
    'open-search': { group: 'Navigation', label: 'Search' },
    'toggle-sidebar': { group: 'Navigation', label: 'Toggle sidebar' },
    'goto-logs': { group: 'Workflow editor', label: 'Go to logs' },
    'add-workflow': { group: 'Workflow editor', label: 'New workflow' },
    'add-agent': { group: 'Workflow editor', label: 'Add an Agent block' },
    'open-workflow-search-replace': { group: 'Workflow editor', label: 'Find and replace' },
    'focus-toolbar-search': { group: 'Workflow editor', label: 'Search blocks' },
    'fit-to-view': { group: 'Workflow editor', label: 'Fit to view' },
    'run-workflow': { group: 'Workflow editor', label: 'Run workflow' },
    'clear-terminal-console': { group: 'Workflow editor', label: 'Clear console' },
  }

const KEY_NAMES: Record<string, string> = {
  Mod: '⌘ / Ctrl',
  Alt: '⌥ / Alt',
  Shift: 'Shift',
  Enter: 'Enter',
}

/** `Mod+Shift+P` as the reader presses it: `⌘ / Ctrl + Shift + P`. */
function formatShortcut(shortcut: string) {
  return shortcut
    .split('+')
    .map((key) => KEY_NAMES[key] ?? key.toUpperCase())
    .join(' + ')
}

/** Keys the shell handles outside the command registry. */
const SHELL_ROWS: ShortcutRow[] = [
  { id: 'search-settings', label: 'Search settings', keys: '/' },
  { id: 'close', label: 'Close menu or dialog', keys: 'Esc' },
]

/** Every registered keyboard shortcut, grouped as the Keyboard shortcuts settings page lists them. */
export function keyboardShortcutGroups(): ShortcutGroup[] {
  const rowsIn = (group: 'Navigation' | 'Workflow editor') =>
    Object.values(COMMAND_DEFINITIONS)
      .filter((definition) => COMMAND_ROWS[definition.id].group === group)
      .map((definition) => ({
        id: definition.id,
        label: COMMAND_ROWS[definition.id].label,
        keys: formatShortcut(definition.shortcut),
      }))
  return [
    { title: 'Navigation', rows: [...rowsIn('Navigation'), ...SHELL_ROWS] },
    { title: 'Workflow editor', rows: rowsIn('Workflow editor') },
  ]
}
