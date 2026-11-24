import type { Command } from 'commander'
import { refreshStoredOAuth } from './auth/refresh'
import {
  type OutputFormat,
  type ProfileOverrides,
  type ResolvedProfile,
  resolveProfile,
} from './config/index'
import { SimClient } from './http/client'

/** Global flags, shared by every subcommand. */
export interface GlobalOptions {
  profile?: string
  endpoint?: string
  workspace?: string
  output?: OutputFormat
}

/**
 * Commander stores globals on the root command, not on the leaf that ran, so a
 * subcommand handler has to walk up to find them. `optsWithGlobals()` does that
 * walk; reading `command.opts()` alone silently drops `--profile`.
 */
export function globalsOf(command: Command): GlobalOptions {
  return command.optsWithGlobals() as GlobalOptions
}

/**
 * The profile a command runs with. It resolves from the working directory, so a command run inside
 * a source directory acts on that directory's workspace unless `--workspace` or `SIM_WORKSPACE`
 * names one; `extra.cwd: undefined` opts out.
 */
export function profileFrom(command: Command, extra: ProfileOverrides = {}): ResolvedProfile {
  const globals = globalsOf(command)
  return resolveProfile({
    cwd: process.cwd(),
    profile: globals.profile,
    endpoint: globals.endpoint,
    workspaceId: globals.workspace,
    output: globals.output,
    ...extra,
  })
}

/** The raw client behind a command. Only `connect` calls it: commands reach the API declared. */
export function clientFrom(command: Command): { client: SimClient; profile: ResolvedProfile } {
  const profile = profileFrom(command)
  return { client: new SimClient(profile, { refreshOAuth: refreshStoredOAuth }), profile }
}
