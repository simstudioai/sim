import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ComputerUseError } from '@sim/desktop-bridge'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeComputerUseClient } from '@/main/computer-use/native-client'

const roots: string[] = []
const clients: NativeComputerUseClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.stop()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A real child process exercises framing and shutdown without OS permissions. */
function helper(body: string) {
  const root = mkdtempSync(join(tmpdir(), 'sim-native-transport-'))
  roots.push(root)
  const executable = join(root, 'helper')
  writeFileSync(executable, `#!${process.execPath}\n${body}\n`)
  chmodSync(executable, 0o700)
  const reset = vi.fn()
  const client = new NativeComputerUseClient(executable, reset)
  clients.push(client)
  return { client, reset }
}

const status = JSON.stringify({
  kind: 'status',
  platform: 'darwin',
  accessibility: true,
  screenRecording: false,
})
const reader = `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);`

describe('native computer use transport', () => {
  it.each([undefined, 'not_started'])(
    'preserves explicit dispatch certainty %s without inferring it from an error code',
    async (dispatchState) => {
      const details = {
        code: 'activation_required',
        message: 'Activate and observe the app first.',
        ...(dispatchState ? { dispatchState } : {}),
      }
      const { client } = helper(
        `${reader}process.stdout.write(JSON.stringify({id:request.id,error:${JSON.stringify(details)}})+'\\n');});`
      )
      const error = await client.request('input_sequence', {}).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(ComputerUseError)
      expect(error).toMatchObject({ details })
    }
  )

  it('decodes split frames and correlates replies that arrive out of order', async () => {
    const { client } = helper(`let first; ${reader}
      if(!first){first=request;return}
      const replies=[request,first].map(value=>JSON.stringify({id:value.id,result:${status}})+'\\n').join('');
      process.stdout.write(replies.slice(0,13));
      setTimeout(()=>process.stdout.write(replies.slice(13)),1);
    });`)
    const results = await Promise.all([client.request('status', {}), client.request('status', {})])
    expect(results).toEqual([JSON.parse(status), JSON.parse(status)])
  })

  it('rejects malformed output and can start a fresh helper afterward', async () => {
    const { client, reset } = helper(`${reader}
      process.stdout.write(request.method==='bad'?'not json\\n':JSON.stringify({id:request.id,result:${status}})+'\\n');
    });`)
    await expect(client.request('bad', {})).rejects.toThrow('invalid response')
    expect(reset).toHaveBeenCalledOnce()
    await expect(client.request('status', {})).resolves.toMatchObject({ kind: 'status' })
  })

  it('rejects oversized output instead of retaining an unbounded buffer', async () => {
    const { client } = helper(`${reader}process.stdout.write('x'.repeat(17*1024*1024));});`)
    await expect(client.request('status', {})).rejects.toThrow('oversized response')
  })

  it('can recover after the helper executable is initially unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sim-native-missing-'))
    roots.push(root)
    const executable = join(root, 'helper')
    const client = new NativeComputerUseClient(executable, () => {})
    clients.push(client)
    await expect(client.request('status', {})).rejects.toThrow(/could not start|disconnected/)
    writeFileSync(
      executable,
      `#!${process.execPath}\n${reader}process.stdout.write(JSON.stringify({id:request.id,result:${status}})+'\\n');});`
    )
    chmodSync(executable, 0o700)
    await expect(client.request('status', {})).resolves.toMatchObject({ kind: 'status' })
  })

  it('rejects pending requests if the child exits', async () => {
    const { client } = helper(`${reader}process.exit(0);});`)
    await expect(client.request('status', {})).rejects.toThrow('helper exited')
  })

  it('Stop rejects pending input and prevents waiting requests crossing another Stop', async () => {
    const { client } =
      helper(`process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),20));${reader}
      if(request.method==='status')process.stdout.write(JSON.stringify({id:request.id,result:${status}})+'\\n');
    });`)
    await client.request('status', {})
    const pending = client.request('hang', {})
    const stopped = expect(pending).rejects.toThrow('stopped')
    await Promise.resolve()
    client.stop()
    await stopped
    const waiting = client.request('status', {})
    const waitingStopped = expect(waiting).rejects.toThrow('stopped')
    client.stop()
    await waitingStopped
    await expect(client.request('status', {})).resolves.toMatchObject({ kind: 'status' })
  })
})
