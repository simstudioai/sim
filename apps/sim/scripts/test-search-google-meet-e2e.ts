import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isHosted } from '@/lib/core/config/env-flags'
import { readGoogleMeet, searchGoogleMeet } from '@/lib/sim-search/live/google-meet'
import { createNativeClient, NativeSearchError } from '@/lib/sim-search/live/http'

/** Synthetic real-HTTP acceptance. Requires SEARCH_GOOGLE_MEET_REPORT_PATH and a local self-hosted app URL. */
const logger = createLogger('SearchGoogleMeetE2E')
const reportPath = process.env.SEARCH_GOOGLE_MEET_REPORT_PATH
assert(reportPath, 'Set SEARCH_GOOGLE_MEET_REPORT_PATH')
assert(!isHosted, 'Use a local self-hosted app URL')
const CONFERENCE = 'conferenceRecords/conference-one'
const TRANSCRIPT = `${CONFERENCE}/transcripts/transcript-one`
const NOTE = `${CONFERENCE}/smartNotes/note-one`
const PARTICIPANT = `${CONFERENCE}/participants/speaker-one`
const GUEST = `${CONFERENCE}/participants/speaker-two`
const START = '2026-10-01T10:00:00Z'
const END = '2026-10-01T11:00:00Z'
const DOCUMENT = 'SyntheticTranscriptDoc123'
const TOKEN = 'synthetic-member-token'
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const requests: { path: string; status: number }[] = []
let mode = ''
let conferenceReads = 0
let artifactReads = 0
let entryReads = 0
let observed = 0
let lastFilter = ''
let arrived: (() => void) | undefined
let held: http.ServerResponse | undefined
const conference = () => ({
  name: CONFERENCE,
  space: 'spaces/space-one',
  startTime: START,
  endTime: END,
  expireTime: '2026-10-31T11:00:00Z',
})
const artifact = (note = false) => ({
  name: note ? NOTE : TRANSCRIPT,
  state: mode === 'pending' ? 'STARTED' : 'FILE_GENERATED',
  startTime: START,
  endTime: mode === 'changed-final' && artifactReads > 1 ? '2026-10-01T11:01:00Z' : END,
  docsDestination: {
    document: DOCUMENT,
    exportUri:
      mode === 'unsafe-citation'
        ? 'https://attacker.invalid/secret'
        : `https://docs.google.com/document/d/${DOCUMENT}/edit`,
  },
})
const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const send = (data: unknown, status = 200) => {
    requests.push({ path: url.pathname, status })
    response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data))
  }
  if (request.headers.authorization !== `Bearer ${TOKEN}` || request.method !== 'GET') {
    send({}, 401)
    return
  }
  if (mode.startsWith('http-')) {
    send({ error: 'private-provider-detail' }, Number(mode.slice(5)))
    return
  }
  if (url.pathname === '/v2/conferenceRecords') {
    lastFilter = url.searchParams.get('filter') ?? ''
    const record = conference()
    send({
      conferenceRecords: [record],
      nextPageToken: mode === 'more-conferences' ? 'more-records' : undefined,
    })
    return
  }
  if (url.pathname === `/v2/${CONFERENCE}`) {
    conferenceReads++
    if (mode === 'revoked-final' && conferenceReads > 1) {
      send({}, 403)
      return
    }
    send({
      ...conference(),
      ...(mode === 'wrong-conference' ? { name: 'conferenceRecords/other' } : {}),
    })
    return
  }
  if (
    url.pathname === `/v2/${CONFERENCE}/transcripts` ||
    url.pathname === `/v2/${CONFERENCE}/smartNotes`
  ) {
    const note = url.pathname.endsWith('smartNotes')
    send({ [note ? 'smartNotes' : 'transcripts']: [artifact(note)] })
    return
  }
  if (url.pathname === `/v2/${TRANSCRIPT}` || url.pathname === `/v2/${NOTE}`) {
    artifactReads++
    send({
      ...artifact(url.pathname.endsWith('note-one')),
      ...(mode === 'wrong-artifact' ? { name: `${CONFERENCE}/transcripts/other` } : {}),
    })
    return
  }
  if (url.pathname === `/v2/${CONFERENCE}/participants`) {
    const second = url.searchParams.get('pageToken') === 'participants-2'
    send(
      second
        ? {
            participants: [
              {
                name: GUEST,
                ...(mode === 'unresolved'
                  ? {}
                  : { anonymousUser: { displayName: 'Guest speaker' } }),
              },
            ],
            ...(mode === 'participant-limit' ? { nextPageToken: 'participants-3' } : {}),
          }
        : {
            participants: [
              {
                name:
                  mode === 'wrong-participant'
                    ? 'conferenceRecords/other/participants/speaker-one'
                    : PARTICIPANT,
                signedinUser: { user: 'users/synthetic-user', displayName: 'Riley Analyst' },
              },
            ],
            nextPageToken: 'participants-2',
          }
    )
    return
  }
  if (url.pathname === `/v2/${TRANSCRIPT}/entries`) {
    entryReads++
    if (mode === 'cancel') {
      held = response
      arrived?.()
      return
    }
    const second = url.searchParams.has('pageToken')
    const entry = {
      name: `${TRANSCRIPT}/entries/${second ? 'entry-two' : 'entry-one'}`,
      participant: second ? GUEST : PARTICIPANT,
      text: second ? 'The handoffneedle decision was approved — café.' : 'Opening discussion.',
      languageCode: 'en-US',
      startTime: second ? '2026-10-01T10:02:00Z' : '2026-10-01T10:01:00Z',
      endTime: second ? '2026-10-01T10:02:10Z' : '2026-10-01T10:01:10Z',
    }
    if (mode === 'endless-pages') {
      entry.name = `${TRANSCRIPT}/entries/entry-${entryReads}`
      entry.startTime = new Date(Date.parse(START) + entryReads * 60_000).toISOString()
      entry.endTime = new Date(Date.parse(entry.startTime) + 10_000).toISOString()
    }
    if (mode === 'changed-text') entry.text += ' Later correction.'
    if (mode === 'wrong-entry') entry.name = 'conferenceRecords/other/transcripts/x/entries/y'
    if (mode === 'wrong-speaker') entry.participant = 'conferenceRecords/other/participants/x'
    if (mode === 'duplicate-entry') entry.name = `${TRANSCRIPT}/entries/entry-one`
    if (mode === 'invalid-time') entry.startTime = 'not-a-date'
    if (mode === 'oversize') entry.text = 'é'.repeat(512 * 1024)
    send({
      transcriptEntries: mode === 'malformed-array' ? {} : [entry],
      nextPageToken:
        mode === 'repeated-token' || mode === 'endless-pages'
          ? mode === 'repeated-token'
            ? 'entries-2'
            : `entries-${entryReads + 1}`
          : second
            ? undefined
            : 'entries-2',
    })
    return
  }
  observed++
  send({}, 404)
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const client = (signal = new AbortController().signal) =>
  createNativeClient({ origin, accessToken: TOKEN, signal })
const read = () => readGoogleMeet(client(), { id: TRANSCRIPT, kind: 'transcript' })
async function check(name: string, run: () => Promise<void>) {
  mode = ''
  conferenceReads = 0
  artifactReads = 0
  entryReads = 0
  lastFilter = ''
  held = undefined
  arrived = undefined
  const start = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: performance.now() - start })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
    process.exitCode = 1
  }
}
const rejectRead = () =>
  assert.rejects(read, (error: unknown) => error instanceof NativeSearchError)
try {
  await check(
    'Complete multi-page speech retains the final decision, names, timestamps, and canonical citation',
    async () => {
      const doc = await read()
      assert.equal(doc.id, TRANSCRIPT)
      assert.equal(doc.eventStartAt, START)
      assert.equal(doc.modifiedAt, undefined)
      assert.equal(doc.url, `https://docs.google.com/document/d/${DOCUMENT}/view`)
      for (const text of [
        'Opening discussion.',
        'handoffneedle',
        'Riley Analyst',
        'Guest speaker',
        '2026-10-01T10:02:00Z',
        'café',
      ])
        assert(doc.content.includes(text), `Missing source evidence: ${text}`)
      assert.equal(observed, 0)
    }
  )
  await check(
    'Literal transcript search finds a match on the final entry page and sends only supported date/space filters',
    async () => {
      const page = await searchGoogleMeet(client(), {
        query: 'handoffneedle',
        scopes: [],
        limit: 5,
        filters: { startDate: START, endDate: END },
        native: { provider: 'google_meet', query: 'handoffneedle', project: 'spaces/space-one' },
      })
      assert.deepEqual(
        page.documents.map((doc) => doc.id),
        [TRANSCRIPT]
      )
      assert.equal(
        lastFilter,
        'start_time >= "2026-10-01T10:00:00.000Z" AND start_time < "2026-10-01T11:00:00.000Z" AND space.name = "spaces/space-one"'
      )
      assert(!lastFilter.includes('handoffneedle'))
    }
  )
  await check(
    'Unexamined conferences make an absent local match partial without a fabricated cursor',
    async () => {
      mode = 'more-conferences'
      const page = await searchGoogleMeet(client(), {
        query: 'definitely-absent',
        scopes: [],
        limit: 5,
      })
      assert.equal(page.documents.length, 0)
      assert.equal(page.partial, true)
      assert.equal(page.nextCursor, undefined)
    }
  )
  await check(
    'Smart notes expose an authorized document citation, never a fabricated note body',
    async () => {
      const doc = await readGoogleMeet(client(), { id: NOTE, kind: 'smart_notes' })
      assert.equal(doc.url, `https://docs.google.com/document/d/${DOCUMENT}/view`)
      assert.match(doc.content, /not.*retriev|metadata.only/i)
      assert.match(doc.content, /Drive/)
      assert.equal(entryReads, 0)
    }
  )
  for (const failure of [
    'wrong-conference',
    'wrong-artifact',
    'wrong-entry',
    'wrong-speaker',
    'wrong-participant',
    'duplicate-entry',
    'invalid-time',
    'malformed-array',
    'repeated-token',
    'oversize',
    'pending',
    'unsafe-citation',
    'changed-final',
    'revoked-final',
  ])
    await check(`Complete read rejects ${failure}`, async () => {
      mode = failure
      await rejectRead()
    })
  for (const failure of ['endless-pages', 'participant-limit'])
    await check(`Unfinished ${failure} fails at the pagination limit`, async () => {
      mode = failure
      await assert.rejects(
        read,
        (error: unknown) =>
          error instanceof NativeSearchError && /pagination.*limit/.test(error.message)
      )
    })
  await check(
    'Missing display names stay unresolved instead of inventing speaker attribution',
    async () => {
      mode = 'unresolved'
      const doc = await read()
      assert(doc.content.includes(`Unresolved participant ${GUEST}`))
      assert(!doc.content.includes('Guest speaker'))
    }
  )
  await check('A changed transcript cannot splice an existing read window', async () => {
    const first = await read()
    mode = 'changed-text'
    await assert.rejects(
      () => readGoogleMeet(client(), { id: TRANSCRIPT, revision: first.revision }),
      /changed/
    )
  })
  await check('Smart-note body terms are not claimed as metadata matches', async () => {
    const page = await searchGoogleMeet(client(), {
      query: 'handoffneedle',
      scopes: [],
      limit: 5,
      native: { provider: 'google_meet', query: 'handoffneedle', kind: 'smart_notes' },
    })
    assert.equal(page.documents.length, 0)
    assert.equal(entryReads, 0)
  })
  for (const [status, expected] of [
    [401, 'reconnect'],
    [403, 'reconnect'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
  ] as const)
    await check(`HTTP ${status} remains an actionable failure`, async () => {
      mode = `http-${status}`
      await assert.rejects(
        read,
        (error: unknown) =>
          error instanceof NativeSearchError &&
          error.status === expected &&
          !error.message.includes('private-provider-detail')
      )
    })
  await check(
    'Malformed caller paths and unsupported cursor cannot make provider requests',
    async () => {
      const before = requests.length
      await assert.rejects(
        () => readGoogleMeet(client(), { id: `${TRANSCRIPT}/../../private` }),
        (error: unknown) => error instanceof NativeSearchError
      )
      await assert.rejects(
        () =>
          searchGoogleMeet(client(), {
            query: 'x',
            scopes: [],
            limit: 5,
            native: { provider: 'google_meet', query: 'x', cursor: 'opaque' },
          }),
        (error: unknown) => error instanceof NativeSearchError
      )
      assert.equal(requests.length, before)
    }
  )
  await check('Modification filters cannot silently become meeting-start filters', async () => {
    const before = requests.length
    await assert.rejects(
      () =>
        searchGoogleMeet(client(), {
          query: 'handoffneedle',
          scopes: [],
          limit: 5,
          filters: { modifiedAfter: START },
        }),
      (error: unknown) => error instanceof NativeSearchError && /modification/.test(error.message)
    )
    assert.equal(requests.length, before)
  })
  await check(
    'An in-flight cancellation cannot release a complete transcript or continue pagination',
    async () => {
      mode = 'cancel'
      const controller = new AbortController()
      const entered = new Promise<void>((resolve) => {
        arrived = resolve
      })
      const reading = readGoogleMeet(client(controller.signal), { id: TRANSCRIPT })
      const rejected = assert.rejects(reading)
      await Promise.race([
        entered,
        reading.then(() => {
          throw new Error('Read completed before held transcript request')
        }),
      ])
      controller.abort(new Error('cancelled'))
      held?.end()
      await rejected
      assert.equal(entryReads, 1)
    }
  )
} finally {
  held?.end()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify({ fixture: 'synthetic-loopback-google-meet', checks, requests }, null, 2)
  )
  logger.info('Meet verification complete', {
    passed: checks.filter((item) => item.status === 'passed').length,
    failed: checks.filter((item) => item.status === 'failed').length,
    reportPath,
  })
}
