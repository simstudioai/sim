import type { Command } from 'commander'
import { type ProfileOverrides, type ResolvedProfile, resolveProfile } from './config/index.js'
import { SimClient } from './http/client.js'

/** Global flags, shared by every subcommand. */
export interface GlobalOptions {
  profile?: string
  endpoint?: string
  workspace?: string
  output?: string
}

/**
 * Commander stores globals on the root command, not on the leaf that ran, so a
 * subcommand handler has to walk up to find them. `optsWithGlobals()` does that
 * walk; reading `command.opts()` alone silently drops `--profile`.
 */
export function globalsOf(command: Command): GlobalOptions {
  return command.optsWithGlobals() as GlobalOptions
}

export function profileFrom(command: Command, extra: ProfileOverrides = {}): ResolvedProfile {
  const globals = globalsOf(command)
  return resolveProfile({
    profile: globals.profile,
    endpoint: globals.endpoint,
    workspaceId: globals.workspace,
    output: globals.output,
    ...extra,
  })
}

export function clientFrom(command: Command): { client: SimClient; profile: ResolvedProfile } {
  const profile = profileFrom(command)
  return { client: new SimClient(profile), profile }
}
