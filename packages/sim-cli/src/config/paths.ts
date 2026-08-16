import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where the CLI keeps its state. `SIM_CONFIG_DIR` overrides the location
 * wholesale, which is what lets tests and CI point at a scratch directory
 * instead of the invoking user's real credentials.
 */
export function configDir(): string {
  return process.env.SIM_CONFIG_DIR || join(homedir(), '.sim')
}

/** Non-secret per-profile settings. Safe to commit to a dotfiles repo. */
export function configPath(): string {
  return process.env.SIM_CONFIG_FILE || join(configDir(), 'config')
}

/** API keys, written 0600. Kept apart from `config` so the two can be handled differently. */
export function credentialsPath(): string {
  return process.env.SIM_CREDENTIALS_FILE || join(configDir(), 'credentials')
}
