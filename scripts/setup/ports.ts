import { getErrorMessage } from '@sim/utils/errors'
import { type PortOwnerInfo, portOpen, portOwner } from './detect.ts'
import { waitFor } from './probes.ts'
import * as p from './prompter.ts'
import { theme } from './theme.ts'

interface BusyPort {
  port: number
  owner: PortOwnerInfo | null
}

function describe(busy: BusyPort): string {
  return busy.owner
    ? `:${busy.port} is held by ${busy.owner.command} (pid ${busy.owner.pid})`
    : `:${busy.port} is in use`
}

/**
 * Resolve any listeners on `ports` before Sim tries to bind them. Loops offering
 * to kill non-docker owners (or pointing at docker ones) until every port is
 * free. Returns true when all are free, false if the user left them alone — the
 * caller decides whether that's fatal (compose can't start) or just skips an
 * optional auto-start (dev).
 */
export async function ensurePortsFree(ports: number[]): Promise<boolean> {
  for (;;) {
    const busy: BusyPort[] = []
    for (const port of ports) {
      if (await portOpen(port)) busy.push({ port, owner: portOwner(port) })
    }
    if (busy.length === 0) return true

    p.log.warn(`Sim needs ports ${ports.join(' and ')}, but ${busy.map(describe).join(' and ')}.`)
    const dockerOwned = busy.filter((b) => b.owner?.isDocker)
    if (dockerOwned.length > 0) {
      p.log.info(
        theme.muted(
          'A docker-published port means a container holds it — find it with `docker ps` and stop it.'
        )
      )
    }
    const killable = busy.filter((b) => b.owner && !b.owner.isDocker)
    const options: p.SelectOption<'recheck' | 'kill' | 'abort'>[] = [
      { value: 'recheck', label: "I've stopped it — check again" },
    ]
    if (killable.length > 0) {
      options.push({
        value: 'kill',
        label: 'Kill it for me',
        hint: killable.map((b) => `${b.owner?.command} on :${b.port}`).join(', '),
      })
    }
    options.push({ value: 'abort', label: 'Leave the ports alone' })
    const choice = await p.select({ message: 'How do you want to handle it?', options })

    if (choice === 'abort') return false
    if (choice === 'kill') {
      const killed: string[] = []
      for (const b of killable) {
        if (!b.owner) continue
        const label = `${b.owner.command} (pid ${b.owner.pid})`
        try {
          process.kill(b.owner.pid, 'SIGKILL')
          killed.push(label)
        } catch (error) {
          // The owner list came from an lsof snapshot, so the process may have
          // exited in between — that is the outcome we wanted, not a failure.
          // A signal we're not allowed to send is worth saying out loud, but
          // never fatal: the loop re-probes and offers the choice again.
          const code = (error as NodeJS.ErrnoException).code
          if (code === 'ESRCH') killed.push(`${label} — already gone`)
          else if (code === 'EPERM') {
            p.log.warn(
              `Not allowed to kill ${label} — stop it yourself, then choose "check again".`
            )
          } else {
            p.log.warn(`Could not kill ${label}: ${getErrorMessage(error)}`)
          }
        }
      }
      if (killed.length > 0) p.log.step(`Killed ${killed.join(', ')}`)
      // SIGKILL is async — the kernel releases the listening socket a beat after
      // the process dies, so re-checking immediately would still see the port
      // held. Wait for the killed ports to actually free before looping.
      await waitFor(
        async () => {
          for (const b of killable) {
            if (await portOpen(b.port)) return false
          }
          return true
        },
        5000,
        250
      )
    }
  }
}
