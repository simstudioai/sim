import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildShellLaunch,
  detectShell,
  ShellIntegrationParser,
} from '@/main/terminal/shell-integration'

const NONCE = 'testnonce'

function osc(body: string): string {
  return `\u001b]633;${body}\u0007`
}

describe('ShellIntegrationParser', () => {
  it('extracts command lifecycle markers and strips them from the display stream', () => {
    const parser = new ShellIntegrationParser(NONCE)
    const { text, markers } = parser.parse(
      `${osc(`E;npm test;${NONCE}`)}${osc(`C;${NONCE}`)}output here${osc(`D;0;${NONCE}`)}`
    )

    expect(text).toBe('output here')
    expect(markers).toEqual([
      { kind: 'command-line', command: 'npm test' },
      { kind: 'output-start' },
      { kind: 'output-end', exitCode: 0 },
    ])
  })

  it('ignores markers carrying the wrong nonce', () => {
    const parser = new ShellIntegrationParser(NONCE)
    // A file rendered with `cat` can contain a literal finish sequence. Acting
    // on it would hand the agent a fabricated exit code, so it must be inert.
    const { markers } = parser.parse(`BEFORE${osc('D;0;attacker')}AFTER`)

    expect(markers).toEqual([])
  })

  it('still removes forged sequences from the display stream', () => {
    const parser = new ShellIntegrationParser(NONCE)
    const { text } = parser.parse(`BEFORE${osc('D;0;attacker')}AFTER`)

    expect(text).toBe('BEFOREAFTER')
  })

  it('reassembles sequences split across chunks', () => {
    const parser = new ShellIntegrationParser(NONCE)
    const full = `hello${osc(`D;7;${NONCE}`)}world`
    const split = full.length - 8

    const first = parser.parse(full.slice(0, split))
    const second = parser.parse(full.slice(split))

    expect(first.markers).toEqual([])
    expect(second.markers).toEqual([{ kind: 'output-end', exitCode: 7 }])
    expect(first.text + second.text).toBe('helloworld')
  })

  it('unescapes semicolons and newlines in command lines', () => {
    const parser = new ShellIntegrationParser(NONCE)
    const { markers } = parser.parse(osc(`E;echo a\\x3bb\\x0ac;${NONCE}`))

    expect(markers).toEqual([{ kind: 'command-line', command: 'echo a;b\nc' }])
  })

  it('tracks the working directory', () => {
    const parser = new ShellIntegrationParser(NONCE)
    const { markers } = parser.parse(osc(`P;Cwd=/tmp/some dir;${NONCE}`))

    expect(markers).toEqual([{ kind: 'cwd', cwd: '/tmp/some dir' }])
  })

  it("recognises the startup marker sent before the user's startup files", () => {
    const parser = new ShellIntegrationParser(NONCE)
    const { text, markers } = parser.parse(`${osc(`SimStartup;${NONCE}`)}loading`)

    expect(text).toBe('loading')
    expect(markers).toEqual([{ kind: 'startup' }])
  })

  it('accepts ST as well as BEL as a terminator', () => {
    const parser = new ShellIntegrationParser(NONCE)
    const { text, markers } = parser.parse(`a\u001b]633;A;${NONCE}\u001b\\b`)

    expect(text).toBe('ab')
    expect(markers).toEqual([{ kind: 'prompt-start' }])
  })

  it('releases an unterminated sequence rather than buffering without bound', () => {
    const parser = new ShellIntegrationParser(NONCE)
    const runaway = `\u001b]633;${'x'.repeat(9000)}`
    const { text } = parser.parse(runaway)

    expect(text).toBe(runaway)
  })
})

describe('detectShell', () => {
  it('recognises the shells we can instrument', () => {
    expect(detectShell('/bin/zsh')).toBe('zsh')
    expect(detectShell('/usr/local/bin/bash')).toBe('bash')
  })

  it('returns null for shells without hooks, leaving the terminal uninstrumented', () => {
    expect(detectShell('/usr/bin/fish')).toBeNull()
    expect(detectShell('/bin/sh')).toBeNull()
  })
})

/**
 * The generated startup files run in a real shell, with the user's own files standing in as a
 * temp home whose startup prints a line. The startup marker has to reach the terminal before that
 * line, and only from the interactive shell the terminal runs.
 */
describe('startup marker', () => {
  const STARTUP = `\u001b]633;SimStartup;${NONCE}\u0007`

  function userHome(rcFile: string): string {
    const home = mkdtempSync(join(tmpdir(), 'sim-shell-home-'))
    writeFileSync(join(home, rcFile), 'echo user-startup\n')
    return home
  }

  it.skipIf(!existsSync('/bin/zsh'))(
    "zsh sends it before the user's files, interactively only",
    () => {
      const home = userHome('.zshrc')
      const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home }
      const launch = buildShellLaunch('zsh', mkdtempSync(join(tmpdir(), 'sim-zsh-')), NONCE, env)
      const run = (args: string[]) =>
        spawnSync('/bin/zsh', args, { env: { ...env, ...launch.env }, encoding: 'utf8' }).stdout

      const interactive = run([...launch.args, '-i', '-c', 'true'])
      expect(interactive.indexOf(STARTUP)).toBeGreaterThanOrEqual(0)
      expect(interactive.indexOf(STARTUP)).toBeLessThan(interactive.indexOf('user-startup'))
      expect(run(['-c', 'echo script'])).toBe('script\n')
    }
  )

  it.skipIf(!existsSync('/bin/zsh'))(
    "zsh keeps integrating when the user's .zshenv moves ZDOTDIR, and runs all their files there",
    () => {
      const home = mkdtempSync(join(tmpdir(), 'sim-shell-home-'))
      const userDir = join(home, '.config', 'zsh')
      mkdirSync(userDir, { recursive: true })
      writeFileSync(join(home, '.zshenv'), 'export ZDOTDIR="$HOME/.config/zsh"\n')
      writeFileSync(join(userDir, '.zprofile'), 'USER_PROFILE_RAN=1\n')
      writeFileSync(join(userDir, 'plugins.zsh'), 'USER_PLUGIN_RAN=1\n')
      writeFileSync(join(userDir, '.zshrc'), 'USER_RC_RAN=1\nsource "$ZDOTDIR/plugins.zsh"\n')
      writeFileSync(join(userDir, '.zlogin'), 'echo "login=$USER_RC_RAN"\n')
      const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home }
      const launch = buildShellLaunch('zsh', mkdtempSync(join(tmpdir(), 'sim-zsh-')), NONCE, env)

      const output = spawnSync(
        '/bin/zsh',
        [
          ...launch.args,
          '-i',
          '-c',
          'echo "profile=$USER_PROFILE_RAN rc=$USER_RC_RAN plugin=$USER_PLUGIN_RAN zdotdir=$ZDOTDIR"; whence -w __sim_precmd',
        ],
        { env: { ...env, ...launch.env }, encoding: 'utf8' }
      ).stdout

      expect(output).toContain(`profile=1 rc=1 plugin=1 zdotdir=${userDir}`)
      expect(output).toContain('__sim_precmd: function')
      expect(output).toContain('login=1')
    }
  )

  it.skipIf(!existsSync('/bin/bash'))("bash sends it before the user's files", () => {
    const home = userHome('.bashrc')
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home }
    const launch = buildShellLaunch('bash', mkdtempSync(join(tmpdir(), 'sim-bash-')), NONCE, env)
    const output = spawnSync('/bin/bash', launch.args, {
      env: { ...env, ...launch.env },
      input: 'exit\n',
      encoding: 'utf8',
    }).stdout

    expect(output.indexOf(STARTUP)).toBeGreaterThanOrEqual(0)
    expect(output.indexOf(STARTUP)).toBeLessThan(output.indexOf('user-startup'))
  })
})
