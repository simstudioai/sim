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

/**
 * Where the once-a-day update check remembers that it ran.
 *
 * Cache, not configuration, so it is safe to delete at any time and gets no
 * `SIM_*` override of its own: nobody relocates a cache deliberately, and
 * `SIM_CONFIG_DIR` already moves it for the two callers that matter — the test
 * harness and anyone keeping `~/.sim` somewhere else. It is kept out of the
 * config file because that file is INI the user edits, and a timestamp inside a
 * `[profile x]` section would surface in `sim configure` and `sim whoami`.
 */
export function updateCachePath(): string {
  return join(configDir(), 'update-check.json')
}
