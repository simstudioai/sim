import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import type { BrowserPagePrompt, BrowserPagePromptResponse } from '@sim/browser-protocol'
import type {
  AuthenticationResponseDetails,
  AuthInfo,
  Certificate,
  Session,
  WebContents,
  WebFrameMain,
} from 'electron'
import { app, shell } from 'electron'
import {
  appLaunchNoticeForContents,
  handleBrowserLogin,
  handleSelectClientCertificate,
  httpAuthChallenge,
  noteMainFrameNavigation,
  pagePromptForContents,
  requestExternalLaunch,
  resetPagePromptDecisions,
  respondToPagePrompt,
  setPagePromptHost,
} from '@/main/browser-agent/page-prompts'
import { registerAgentWebContents } from '@/main/browser-agent/registry'

const PAGE = 'https://meet.example'

interface Context {
  promptsEnabled: boolean
  onScreen: boolean
  userActivated: boolean
  agentActedLast: boolean
  agentDrives: boolean
}

let context: Context

function agentContents(session: Session = {} as Session): WebContents {
  const contents = {
    isDestroyed: () => false,
    getURL: () => `${PAGE}/j/1`,
    mainFrame: { frameTreeNodeId: 1 },
    session,
  } as WebContents
  registerAgentWebContents(contents)
  return contents
}

function shownPrompt(contents: WebContents): BrowserPagePrompt {
  const prompt = pagePromptForContents(contents)
  if (!prompt) throw new Error('No prompt shown')
  return prompt
}

function answer(contents: WebContents, response: BrowserPagePromptResponse, scopeId = 'chat') {
  respondToPagePrompt(scopeId, {
    action: 'respond-prompt',
    requestId: shownPrompt(contents).requestId,
    response,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  context = {
    promptsEnabled: true,
    onScreen: true,
    userActivated: false,
    agentActedLast: false,
    agentDrives: false,
  }
  setPagePromptHost({
    tabContext: () => ({ scopeId: 'chat', ...context }),
    publish: () => {},
    focus: () => {},
    noticeForAgent: () => {},
  })
})

afterEach(() => {
  setPagePromptHost(null)
  resetPagePromptDecisions()
  vi.useRealTimers()
})

describe('httpAuthChallenge', () => {
  const url = 'https://intranet.example:8443/reports'
  const page = { url, isRequestForNavigation: true }
  const server = { isProxy: false, host: 'intranet.example', port: 8443 }

  it("asks about the tab's own top-level navigation, challenged by the host it requested", () => {
    expect(httpAuthChallenge(page, server, url)).toEqual({
      origin: 'https://intranet.example:8443',
      proxy: false,
      insecure: false,
    })
    expect(
      httpAuthChallenge(
        { url: 'http://router.local/', isRequestForNavigation: true },
        { isProxy: false, host: 'router.local', port: 80 },
        'http://router.local/'
      )
    ).toMatchObject({ insecure: true })
  })

  it('cancels frame, subresource, and cross-origin challenges', () => {
    expect(httpAuthChallenge(page, server, 'https://intranet.example:8443/')).toBeNull()
    expect(httpAuthChallenge(page, server, undefined)).toBeNull()
    expect(httpAuthChallenge({ ...page, isRequestForNavigation: false }, server, url)).toBeNull()
    expect(httpAuthChallenge(page, { ...server, host: 'evil.example' }, url)).toBeNull()
    expect(httpAuthChallenge(page, { ...server, port: 443 }, url)).toBeNull()
  })

  it('asks about a proxy for any request', () => {
    expect(
      httpAuthChallenge(
        { url: 'https://example.com/pixel.png', isRequestForNavigation: false },
        { isProxy: true, host: 'proxy.corp', port: 3128 },
        undefined
      )
    ).toEqual({ origin: 'proxy.corp:3128', proxy: true, insecure: false })
  })
})

describe('HTTP sign-in', () => {
  const url = 'https://intranet.example/'
  const login = (contents: WebContents, firstAuthAttempt = true) => {
    const callback = vi.fn()
    handleBrowserLogin(
      { preventDefault: () => {} },
      contents,
      { url, isRequestForNavigation: true, firstAuthAttempt } as AuthenticationResponseDetails,
      {
        isProxy: false,
        scheme: 'basic',
        host: 'intranet.example',
        port: 443,
        realm: '',
      } as AuthInfo,
      callback
    )
    return callback
  }

  it('stops asking a page that keeps reloading into the same challenge', () => {
    const contents = agentContents()
    for (let attempt = 0; attempt < 3; attempt++) {
      noteMainFrameNavigation(contents, url)
      const callback = login(contents)
      expect(pagePromptForContents(contents)).toMatchObject({ kind: 'http-auth' })
      answer(contents, { allowed: false })
      expect(callback).toHaveBeenCalledExactlyOnceWith()
    }
    noteMainFrameNavigation(contents, url)
    expect(login(contents)).toHaveBeenCalledExactlyOnceWith()
    expect(pagePromptForContents(contents)).toBeUndefined()

    vi.advanceTimersByTime(60_000)
    login(contents)
    expect(pagePromptForContents(contents)).toMatchObject({ kind: 'http-auth' })
  })

  it('passes on only the credentials of an accepted answer', () => {
    const contents = agentContents()
    noteMainFrameNavigation(contents, url)
    const callback = login(contents)
    answer(contents, { allowed: true, kind: 'http-auth', username: 'ada', password: 'pw' })
    expect(callback).toHaveBeenCalledExactlyOnceWith('ada', 'pw')
  })
})

describe('client certificates', () => {
  const certificate = (fingerprint: string, subjectName: string) =>
    ({ fingerprint, subjectName, issuerName: 'Corp CA', validExpiry: 2_000_000_000 }) as Certificate
  const first = certificate('sha256/first', 'Personal')
  const work = certificate('sha256/work', 'Work badge')

  function request(contents: WebContents | null, list: Certificate[], url = 'https://mtls.corp') {
    const event = { preventDefault: vi.fn() }
    const callback = vi.fn()
    handleSelectClientCertificate(event, contents, url, list, callback)
    return { event, callback }
  }

  it("leaves the main window on Electron's default", () => {
    const { event, callback } = request({ isDestroyed: () => false } as WebContents, [first])
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
  })

  it('sends no certificate when there is none, or no renderer to ask', () => {
    const contents = agentContents()
    const empty = request(contents, [])
    expect(empty.event.preventDefault).toHaveBeenCalled()
    expect(empty.callback).toHaveBeenCalledExactlyOnceWith()

    context.promptsEnabled = false
    expect(request(contents, [first, work]).callback).toHaveBeenCalledExactlyOnceWith()
  })

  it('sends only the picked certificate, remembers it per host, and forgets it on reset', () => {
    const session = {} as Session
    const contents = agentContents(session)
    const { callback } = request(contents, [first, work])
    expect(shownPrompt(contents)).toMatchObject({ kind: 'client-certificate', host: 'mtls.corp' })
    answer(contents, { allowed: true, kind: 'client-certificate', choiceId: 'sha256/work' })
    expect(callback).toHaveBeenCalledExactlyOnceWith(work)

    expect(request(agentContents(session), [first, work]).callback).toHaveBeenCalledWith(work)
    expect(
      request(agentContents(session), [first, work], 'https://other.corp').callback
    ).not.toHaveBeenCalled()

    resetPagePromptDecisions()
    expect(request(agentContents(session), [first, work]).callback).not.toHaveBeenCalled()
  })

  it("remembers Don't send, but not a prompt nobody answered", () => {
    const declined = agentContents()
    const refused = request(declined, [first])
    answer(declined, { allowed: false })
    expect(refused.callback).toHaveBeenCalledExactlyOnceWith()
    expect(request(agentContents(declined.session), [first]).callback).toHaveBeenCalledWith()

    const ignored = agentContents()
    const unanswered = request(ignored, [first])
    vi.advanceTimersByTime(120_000)
    expect(unanswered.callback).toHaveBeenCalledExactlyOnceWith()
    expect(request(agentContents(ignored.session), [first]).callback).not.toHaveBeenCalled()
  })

  it('sends nothing for an unknown choice, an off-screen answer, or another chat', () => {
    const forged = agentContents()
    const unknown = request(forged, [first])
    answer(forged, { allowed: true, kind: 'client-certificate', choiceId: 'sha256/forged' })
    expect(unknown.callback).toHaveBeenCalledExactlyOnceWith()

    const elsewhere = agentContents()
    const otherChat = request(elsewhere, [first])
    answer(elsewhere, { allowed: true, kind: 'client-certificate', choiceId: 'sha256/first' }, 'x')
    expect(otherChat.callback).not.toHaveBeenCalled()

    context.onScreen = false
    const hidden = agentContents()
    const offScreen = request(hidden, [first])
    answer(hidden, { allowed: true, kind: 'client-certificate', choiceId: 'sha256/first' })
    expect(offScreen.callback).toHaveBeenCalledExactlyOnceWith()
  })
})

describe('app links', () => {
  const topFrame = (origin = PAGE) => ({ parent: null, frameTreeNodeId: 1, origin }) as WebFrameMain

  beforeEach(() => {
    app.getApplicationNameForProtocol = vi.fn(() => 'Zoom')
    vi.mocked(shell.openExternal).mockClear()
    context.userActivated = true
  })

  it('refuses a launch a frame initiated, even one targeting the top document', () => {
    const contents = agentContents()
    const frame = {
      parent: topFrame(),
      frameTreeNodeId: 2,
      origin: 'https://ads.example',
    } as WebFrameMain
    requestExternalLaunch(contents, 'zoommtg://zoom.us/join', { initiator: frame })
    requestExternalLaunch(contents, 'zoommtg://zoom.us/join', {
      initiator: topFrame('https://ads.example'),
    })
    requestExternalLaunch(contents, 'zoommtg://zoom.us/join', { initiator: null })
    expect(pagePromptForContents(contents)).toBeUndefined()
    expect(appLaunchNoticeForContents(contents)).toBeUndefined()
  })

  it('asks after the top document is clicked, but only offers a popup passively', () => {
    const clicked = agentContents()
    requestExternalLaunch(clicked, 'zoommtg://zoom.us/join', { initiator: topFrame() })
    expect(pagePromptForContents(clicked)).toMatchObject({ kind: 'external-app', appName: 'Zoom' })

    const popup = agentContents()
    requestExternalLaunch(popup, 'zoommtg://zoom.us/join', 'popup')
    expect(pagePromptForContents(popup)).toBeUndefined()
    expect(appLaunchNoticeForContents(popup)).toMatchObject({ origin: PAGE, appName: 'Zoom' })
  })

  it('opens only the first link while its prompt is pending', async () => {
    const contents = agentContents()
    requestExternalLaunch(contents, 'zoommtg://zoom.us/join?id=1', { initiator: topFrame() })
    requestExternalLaunch(contents, 'zoommtg://zoom.us/join?id=2', { initiator: topFrame() })
    expect(appLaunchNoticeForContents(contents)).toBeUndefined()
    answer(contents, { allowed: true, kind: 'external-app', alwaysAllow: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith('zoommtg://zoom.us/join?id=1')
  })

  it('forgets "Always allow" on reset', async () => {
    const contents = agentContents()
    requestExternalLaunch(contents, 'zoommtg://zoom.us/join?id=1', { initiator: topFrame() })
    answer(contents, { allowed: true, kind: 'external-app', alwaysAllow: true })
    resetPagePromptDecisions()
    vi.advanceTimersByTime(20_000)
    requestExternalLaunch(contents, 'zoommtg://zoom.us/join?id=2', { initiator: topFrame() })
    await vi.advanceTimersByTimeAsync(0)
    expect(pagePromptForContents(contents)).toMatchObject({ kind: 'external-app' })
    expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith('zoommtg://zoom.us/join?id=1')
  })
})
