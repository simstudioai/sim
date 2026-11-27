import type { Command } from 'commander'
import { refreshStoredOAuth } from './auth/refresh'
import type { NamedWorkspace } from './commands/protocol/source-dir'
import {
  explicitWorkspaceSetting,
  normalizeWorkspaceId,
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

/** The workspace the source directory the terminal runs in names, by the program running there. */
const workingDirectoryWorkspaces = new WeakMap<Command, NamedWorkspace>()

/**
 * Records the workspace the source directory `program` runs in names, which the terminal reads
 * before each action: {@link actingProfileFrom} then gives it to every command `program` runs.
 */
export function setWorkingDirectoryWorkspace(program: Command, named: NamedWorkspace): void {
  workingDirectoryWorkspaces.set(program, named)
}

function rootOf(command: Command): Command {
  let root = command
  while (root.parent) root = root.parent
  return root
}

/**
 * The profile a command acts with: {@link profileFrom}, whose workspace the source directory the
 * terminal runs in chooses when neither `--workspace` nor `SIM_WORKSPACE` names one, so a command
 * run there acts on that directory's workspace before the profile's.
 */
export function actingProfileFrom(command: Command): ResolvedProfile {
  const profile = profileFrom(command)
  const named = workingDirectoryWorkspaces.get(rootOf(command))
  if (!named || explicitWorkspaceSetting(profile) !== null) return profile
  return {
    ...profile,
    workspaceId: normalizeWorkspaceId(named.workspaceId, `the source directory ${named.dir}`),
    workspaceDirectory: named.dir,
  }
}

/** The raw client behind a command. Only `connect` calls it: commands reach the API declared. */
export function clientFrom(command: Command): { client: SimClient; profile: ResolvedProfile } {
  const profile = actingProfileFrom(command)
  return { client: new SimClient(profile, { refreshOAuth: refreshStoredOAuth }), profile }
}
