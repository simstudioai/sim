/**
 * The boxd adapter against real boxd machines: what the conformance suite can
 * only assume about the SDK. A command's exit code, environment, and streams
 * arrive intact; a timed-out command really stops; files survive a binary round
 * trip; a pinned snapshot version is enforced; and a killed sandbox is gone.
 *
 * Enable with `BOXD_SANDBOX_SMOKE=1`. Requires `BOXD_API_KEY`,
 * `BOXD_FUNCTION_SNAPSHOT` (`<snapshot>@<version>`), and `BOXD_REGION` when the
 * snapshot is not in the key's default region. Each case creates and deletes
 * its own machine.
 */
import { createHash } from 'node:crypto'
import { Boxd } from '@boxd-sh/sdk'
import { generateShortId } from '@sim/utils/id'
import { parseBoxdSnapshotRef } from '@sim/utils/sandbox-references'
import { describe, expect, it } from 'vitest'
import { env } from '@/lib/core/config/env'
import { boxdProvider } from '@/lib/execution/remote-sandbox/boxd'

const smokeEnabled = process.env.BOXD_SANDBOX_SMOKE === '1'
const CASE_TIMEOUT_MS = 3 * 60_000

function client(apiKey = env.BOXD_API_KEY): Boxd {
  return new Boxd({ apiKey, ...(env.BOXD_REGION ? { region: env.BOXD_REGION } : {}) })
}

describe.skipIf(!smokeEnabled)('boxd sandbox smoke', () => {
  it(
    'runs a command with its exit code, environment, and separate streams on an isolated machine',
    async () => {
      const sandbox = await boxdProvider.create('shell')
      try {
        const machine = await client().machines.get(sandbox.sandboxId)
        expect(machine.networking.isolated).toBe(true)
        expect(machine.deleteAt).toBeInstanceOf(Date)

        const result = await sandbox.runCommand(
          'echo "out:$SIM_SMOKE_VALUE"; echo "err:$SIM_SMOKE_VALUE" >&2; exit 7',
          { timeoutMs: 30_000, envs: { SIM_SMOKE_VALUE: "it's quoted $(not run)" } }
        )

        expect(result).toEqual({
          stdout: "out:it's quoted $(not run)\n",
          stderr: "err:it's quoted $(not run)\n",
          exitCode: 7,
        })

        const asRoot = await sandbox.runCommand(
          'echo "$(id -u):$SIM_SMOKE_VALUE"; tr "\\0" " " < /proc/$$/cmdline; ls /tmp/.sim-env-* 2>/dev/null || true',
          { timeoutMs: 30_000, rootUser: true, envs: { SIM_SMOKE_VALUE: 'root-only-value' } }
        )
        expect(asRoot.exitCode).toBe(0)
        const [identity, ...rest] = asRoot.stdout.split('\n')
        expect(identity).toBe('0:root-only-value')
        expect(rest.join('\n')).not.toContain('root-only-value')
        expect(rest.join('\n')).not.toMatch(/^\/tmp\/\.sim-env-/m)
      } finally {
        await sandbox.kill()
      }
    },
    CASE_TIMEOUT_MS
  )

  it(
    'stops a command at its timeout and keeps a background process between calls',
    async () => {
      const sandbox = await boxdProvider.create('shell')
      try {
        await sandbox.runCommand('nohup sleep 600 >/dev/null 2>&1 &', { timeoutMs: 30_000 })
        const timedOut = await sandbox.runCommand('sleep 45', { timeoutMs: 2000 })
        expect(timedOut).toMatchObject({ exitCode: 124, timedOut: true })
        const rootTimedOut = await sandbox.runCommand('sleep 46', {
          timeoutMs: 2000,
          rootUser: true,
        })
        expect(rootTimedOut).toMatchObject({ exitCode: 124, timedOut: true })

        const processes = await sandbox.runCommand('pgrep -x sleep -a || true', {
          timeoutMs: 30_000,
        })
        expect(processes.stdout).toContain('sleep 600')
        expect(processes.stdout).not.toContain('sleep 45')
        expect(processes.stdout).not.toContain('sleep 46')
      } finally {
        await sandbox.kill()
      }
    },
    CASE_TIMEOUT_MS
  )

  it(
    'round-trips 5 MiB of binary data byte for byte',
    async () => {
      const sandbox = await boxdProvider.create('shell')
      try {
        const bytes = Buffer.alloc(5 * 1024 * 1024)
        for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 131) % 256
        const path = `/tmp/sim-smoke-${generateShortId(8)}.bin`
        await sandbox.writeFile(
          path,
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
        )

        expect(await sandbox.getFileSize(path)).toBe(bytes.length)
        const remoteHash = await sandbox.runCommand(`sha256sum ${path} | cut -d' ' -f1`, {
          timeoutMs: 30_000,
        })
        const localHash = createHash('sha256').update(bytes).digest('hex')
        expect(remoteHash.stdout.trim()).toBe(localHash)

        const { content, byteLength } = await sandbox.readFileWithLimit(path, {
          maxBytes: 6 * 1024 * 1024,
          encoding: 'base64',
        })
        expect(byteLength).toBe(bytes.length)
        expect(createHash('sha256').update(Buffer.from(content, 'base64')).digest('hex')).toBe(
          localHash
        )
      } finally {
        await sandbox.kill()
      }
    },
    CASE_TIMEOUT_MS
  )

  it(
    'deletes the machine on kill, once',
    async () => {
      const sandbox = await boxdProvider.create('shell')
      await sandbox.kill()
      await sandbox.kill()

      await expect(client().machines.get(sandbox.sandboxId)).rejects.toMatchObject({
        name: 'NotFoundError',
      })
    },
    CASE_TIMEOUT_MS
  )

  it(
    'refuses a snapshot that is not at the pinned version and leaves no machine behind',
    async () => {
      const ref = parseBoxdSnapshotRef(env.BOXD_FUNCTION_SNAPSHOT ?? '')
      expect(ref?.version).toBeDefined()
      const original = {
        BOXD_FUNCTION_SNAPSHOT: env.BOXD_FUNCTION_SNAPSHOT,
        BOXD_SANDBOX_NAME_PREFIX: env.BOXD_SANDBOX_NAME_PREFIX,
      }
      const prefix = `${env.BOXD_SANDBOX_NAME_PREFIX?.trim() || 'sim-sandbox-'}pin-`
      Object.assign(env, {
        BOXD_FUNCTION_SNAPSHOT: `${ref?.snapshot}@${(ref?.version ?? 0) + 1}`,
        BOXD_SANDBOX_NAME_PREFIX: prefix,
      })
      try {
        await expect(boxdProvider.create('code')).rejects.toThrow(
          /but this deployment is pinned to version/
        )
        const machines = await client().machines.list({
          ...(env.BOXD_ORG ? { org: env.BOXD_ORG } : {}),
        })
        expect(machines.filter((machine) => machine.name.startsWith(prefix))).toEqual([])
      } finally {
        Object.assign(env, original)
      }
    },
    CASE_TIMEOUT_MS
  )

  it(
    'reports a rejected API key without creating anything',
    async () => {
      const original = env.BOXD_API_KEY
      Object.assign(env, { BOXD_API_KEY: 'not-a-real-key' })
      try {
        await expect(boxdProvider.create('shell')).rejects.toMatchObject({
          name: 'AuthenticationError',
        })
      } finally {
        Object.assign(env, { BOXD_API_KEY: original })
      }
    },
    CASE_TIMEOUT_MS
  )
})
