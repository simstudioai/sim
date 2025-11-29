import type { GlobalCommand } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'

/**
 * Identifiers for all globally-available commands.
 *
 * Components must use these identifiers (via {@link createCommand}) rather than
 * ad-hoc ids or shortcuts to ensure a single source of truth.
 */
export type CommandId =
  | 'add-agent'
  | 'goto-templates'
  | 'goto-logs'
  | 'open-search'
  | 'run-workflow'
  | 'focus-copilot-tab'
  | 'focus-toolbar-tab'
  | 'focus-editor-tab'
  | 'clear-terminal-console'
  | 'focus-toolbar-search'
  | 'clear-notifications'

/**
 * Static metadata for a global command.
 *
 * This central registry defines the keyboard shortcut and default behavior
 * for whether the command is allowed inside editable elements.
 */
export interface CommandDefinition {
  /** Stable identifier for the command. */
  id: CommandId
  /** Shortcut string in the form "Mod+Shift+A", "Mod+Enter", etc. */
  shortcut: string
  /**
   * Whether to allow the command inside editable elements such as inputs and
   * textareas. When omitted, the command provider will default to `true`.
   */
  allowInEditable?: boolean
}

/**
 * Central mapping from command id to its definition.
 *
 * All global commands must be declared here to be usable.
 */
export const COMMAND_DEFINITIONS: Record<CommandId, CommandDefinition> = {
  'add-agent': {
    id: 'add-agent',
    shortcut: 'Mod+Shift+A',
    allowInEditable: true,
  },
  'goto-templates': {
    id: 'goto-templates',
    shortcut: 'Mod+Y',
    allowInEditable: true,
  },
  'goto-logs': {
    id: 'goto-logs',
    shortcut: 'Mod+L',
    allowInEditable: true,
  },
  'open-search': {
    id: 'open-search',
    shortcut: 'Mod+K',
    allowInEditable: true,
  },
  'run-workflow': {
    id: 'run-workflow',
    shortcut: 'Mod+Enter',
    allowInEditable: false,
  },
  'focus-copilot-tab': {
    id: 'focus-copilot-tab',
    shortcut: 'C',
    allowInEditable: false,
  },
  'focus-toolbar-tab': {
    id: 'focus-toolbar-tab',
    shortcut: 'T',
    allowInEditable: false,
  },
  'focus-editor-tab': {
    id: 'focus-editor-tab',
    shortcut: 'E',
    allowInEditable: false,
  },
  'clear-terminal-console': {
    id: 'clear-terminal-console',
    shortcut: 'Mod+D',
    allowInEditable: false,
  },
  'focus-toolbar-search': {
    id: 'focus-toolbar-search',
    shortcut: 'Mod+F',
    allowInEditable: false,
  },
  'clear-notifications': {
    id: 'clear-notifications',
    shortcut: 'Mod+E',
    allowInEditable: false,
  },
}

/**
 * Input for creating a concrete command instance from the registry.
 */
export interface CreateCommandInput {
  /** Identifier of the command to materialize. */
  id: CommandId
  /**
   * Handler invoked when the shortcut is matched. This is the only dynamic
   * part supplied by call sites.
   */
  handler: (event: KeyboardEvent) => void
  /**
   * Optional overrides for definition defaults. Use sparingly; most behavior
   * should be configured in {@link COMMAND_DEFINITIONS}.
   */
  overrides?: Pick<GlobalCommand, 'allowInEditable'>
}

/**
 * Creates a concrete {@link GlobalCommand} from a registry definition.
 *
 * This ensures:
 * - Only commands declared in {@link COMMAND_DEFINITIONS} can be registered.
 * - Shortcut strings and ids are centralized and consistent.
 *
 * @throws Error when the `id` is not present in the registry.
 */
export function createCommand(input: CreateCommandInput): GlobalCommand {
  const definition = COMMAND_DEFINITIONS[input.id]
  if (!definition) {
    throw new Error(`Unknown global command id: ${input.id as string}`)
  }

  return {
    id: definition.id,
    shortcut: definition.shortcut,
    allowInEditable: input.overrides?.allowInEditable ?? definition.allowInEditable,
    handler: input.handler,
  }
}

/**
 * Convenience helper to create multiple commands from the registry in one call.
 *
 * @param inputs - List of command inputs to materialize.
 * @returns Array of {@link GlobalCommand} instances ready for registration.
 */
export function createCommands(inputs: CreateCommandInput[]): GlobalCommand[] {
  return inputs.map((input) => createCommand(input))
}
