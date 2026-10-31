import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const OPEN_TIMEOUT_MS = 15_000

/**
 * Opens `url` in one profile of an installed Chromium-family browser.
 *
 * `-n` launches a fresh instance whose command line Chromium's process
 * singleton forwards to the running browser; without it a running browser
 * drops `--args` and opens the page in whichever profile was last active.
 */
export async function openInBrowserProfile(
  bundleId: string,
  profileDirectory: string,
  url: string
): Promise<void> {
  await execFileAsync(
    '/usr/bin/open',
    ['-n', '-b', bundleId, '--args', `--profile-directory=${profileDirectory}`, url],
    { timeout: OPEN_TIMEOUT_MS }
  )
}
