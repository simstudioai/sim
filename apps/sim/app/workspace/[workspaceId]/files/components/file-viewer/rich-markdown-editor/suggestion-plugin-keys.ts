import { PluginKey } from '@tiptap/pm/state'

/** Shared suggestion identities let keyboard guards read activity without importing popup UI. */
export const MENTION_PLUGIN_KEY = new PluginKey<{ active: boolean }>('mention')

/** Slash commands have their own state and must never reuse the mention plugin's identity. */
export const SLASH_COMMAND_PLUGIN_KEY = new PluginKey<{ active: boolean }>('slashCommand')
