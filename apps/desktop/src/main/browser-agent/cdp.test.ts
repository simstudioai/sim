import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => import('@/test/electron-mock'))

import {
  type NativeImage,
  type nativeImage,
  type WebContents,
  WebContentsView,
  type WebFrameMain,
} from 'electron'
import {
  captureScreenshot,
  clickAt,
  dragPointer,
  ensureInstrumented,
  evaluateInIsolatedFrame,
  insertText,
  PRIMARY_CLICK,
  releaseFileInput,
  resolveFileInput,
  setFileInputFiles,
} from '@/main/browser-agent/cdp'

function createOopifFrameFixture() {
  const top = {
    name: '',
    url: 'https://app.example/',
    origin: 'https://app.example',
    parent: null,
    frames: [] as WebFrameMain[],
    top: null,
  } as unknown as WebFrameMain
  const child = {
    name: 'account-menu',
    url: 'https://accounts.example/menu',
    origin: 'https://accounts.example',
    parent: top,
    frames: [] as WebFrameMain[],
    top,
  } as unknown as WebFrameMain
  ;(top.frames as WebFrameMain[]).push(child)

  return {
    child,
    frameTree: {
      frame: { id: 'top', url: 'https://app.example/' },
      childFrames: [
        {
          frame: {
            id: 'child',
            parentId: 'top',
            name: 'account-menu',
            url: 'https://accounts.example/menu',
          },
        },
      ],
    },
  }
}

describe('browser-agent CDP instrumentation', () => {
  it('leaves file chooser dialogs native so users can upload files', async () => {
    const contents = new WebContentsView().webContents

    await ensureInstrumented(contents, { onDialog: vi.fn(), dialogResponse: () => null })

    expect(contents.debugger.sendCommand).toHaveBeenCalledWith('Page.enable', undefined)
    expect(contents.debugger.sendCommand).not.toHaveBeenCalledWith(
      'Page.setInterceptFileChooserDialog',
      expect.anything()
    )
  })

  it('retries protocol setup after a transient instrumentation failure', async () => {
    const contents = new WebContentsView().webContents
    vi.mocked(contents.debugger.isAttached).mockReturnValue(true)
    let autoAttachAttempts = 0
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method) => {
      if (method === 'Target.setAutoAttach' && autoAttachAttempts++ === 0) {
        return Promise.reject(new Error('setup acknowledgement lost'))
      }
      return Promise.resolve({})
    })

    await expect(
      ensureInstrumented(contents, { onDialog: vi.fn(), dialogResponse: () => null })
    ).rejects.toThrow('setup acknowledgement lost')
    await expect(
      ensureInstrumented(contents, { onDialog: vi.fn(), dialogResponse: () => null })
    ).resolves.toBeUndefined()

    expect(autoAttachAttempts).toBe(2)
  })

  it('dismisses an OOPIF dialog on the flattened child session', async () => {
    const contents = new WebContentsView().webContents
    const onDialog = vi.fn()
    await ensureInstrumented(contents, { onDialog, dialogResponse: () => null })
    const listener = vi
      .mocked(contents.debugger.on)
      .mock.calls.find(([event]) => event === 'message')?.[1] as
      | ((event: unknown, method: string, params: unknown, sessionId?: string) => void)
      | undefined
    expect(listener).toBeTypeOf('function')
    vi.mocked(contents.debugger.sendCommand).mockClear()

    listener?.(
      {},
      'Page.javascriptDialogOpening',
      { type: 'alert', message: 'Hello' },
      'child-session'
    )
    await vi.waitFor(() => expect(onDialog).toHaveBeenCalled())

    expect(contents.debugger.sendCommand).toHaveBeenCalledWith(
      'Page.handleJavaScriptDialog',
      { accept: false },
      'child-session'
    )
    expect(onDialog).toHaveBeenCalledWith({
      type: 'alert',
      message: 'Hello',
      handled: true,
      accepted: false,
    })
  })

  it('answers dialogs with the running action requested response', async () => {
    const contents = new WebContentsView().webContents
    const onDialog = vi.fn()
    const dialogResponse = vi.fn(() => ({ accept: true }))
    await ensureInstrumented(contents, { onDialog, dialogResponse })
    const listener = vi
      .mocked(contents.debugger.on)
      .mock.calls.find(([event]) => event === 'message')?.[1] as
      | ((event: unknown, method: string, params: unknown, sessionId?: string) => void)
      | undefined
    vi.mocked(contents.debugger.sendCommand).mockClear()

    listener?.({}, 'Page.javascriptDialogOpening', { type: 'alert', message: 'Saved' })
    await vi.waitFor(() => expect(onDialog).toHaveBeenCalledTimes(1))
    listener?.({}, 'Page.javascriptDialogOpening', { type: 'confirm', message: 'Delete?' })
    await vi.waitFor(() => expect(onDialog).toHaveBeenCalledTimes(2))

    expect(vi.mocked(contents.debugger.sendCommand).mock.calls).toEqual([
      ['Page.handleJavaScriptDialog', { accept: true }],
      ['Page.handleJavaScriptDialog', { accept: true }],
    ])
    expect(onDialog).toHaveBeenLastCalledWith({
      type: 'confirm',
      message: 'Delete?',
      handled: true,
      accepted: true,
    })
  })

  it('releases the button when a timed drag is aborted mid-route', async () => {
    const contents = new WebContentsView().webContents
    const types = () =>
      vi
        .mocked(contents.debugger.sendCommand)
        .mock.calls.filter(([method]) => method === 'Input.dispatchMouseEvent')
        .map(([, params]) => toRecord(params).type)
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const drag = dragPointer(
        contents,
        { x: 0, y: 0 },
        { x: 500, y: 0 },
        { via: [], durationMs: 5_000 },
        controller.signal
      )
      const settled = expect(drag).rejects.toMatchObject({ name: 'AbortError' })
      await vi.advanceTimersByTimeAsync(100)
      controller.abort()
      await settled
      expect(types().at(-1)).toBe('mouseReleased')
      expect(types().filter((type) => type === 'mouseMoved').length).toBeLessThan(20)
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases a held button as soon as its click is aborted', async () => {
    const contents = new WebContentsView().webContents
    const types = () =>
      vi.mocked(contents.debugger.sendCommand).mock.calls.map(([, params]) => toRecord(params).type)
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const hold = { ...PRIMARY_CLICK, holdMs: 10_000 }
      const click = clickAt(contents, 5, 6, false, hold, controller.signal)
      await vi.advanceTimersByTimeAsync(100)
      expect(types()).toEqual(['mousePressed'])

      controller.abort()
      await expect(click).rejects.toMatchObject({ name: 'AbortError' })
      expect(types()).toEqual(['mousePressed', 'mouseReleased'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases the mouse after a partial click failure', async () => {
    const contents = new WebContentsView().webContents
    vi.mocked(contents.debugger.sendCommand)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('frame navigated'))
      .mockResolvedValueOnce({})

    await expect(clickAt(contents, 12, 24)).rejects.toThrow('frame navigated')

    expect(vi.mocked(contents.debugger.sendCommand).mock.calls.at(-1)).toEqual([
      'Input.dispatchMouseEvent',
      {
        type: 'mouseReleased',
        x: 12,
        y: 24,
        button: 'left',
        buttons: 0,
        modifiers: 0,
        clickCount: 1,
      },
    ])
  })

  it('times out a hung press and sends cleanup before the tool watchdog can release', async () => {
    vi.useFakeTimers()
    try {
      const contents = new WebContentsView().webContents
      vi.mocked(contents.debugger.sendCommand)
        .mockResolvedValueOnce({})
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValueOnce({})

      const click = clickAt(contents, 20, 30)
      const rejection = expect(click).rejects.toThrow('did not acknowledge input within 5 seconds')
      await vi.advanceTimersByTimeAsync(5_000)

      await rejection
      expect(vi.mocked(contents.debugger.sendCommand).mock.calls.at(-1)).toEqual([
        'Input.dispatchMouseEvent',
        expect.objectContaining({ type: 'mouseReleased', x: 20, y: 30 }),
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a hung text insertion acknowledgement', async () => {
    vi.useFakeTimers()
    try {
      const contents = new WebContentsView().webContents
      vi.mocked(contents.debugger.sendCommand).mockImplementationOnce(() => new Promise(() => {}))

      const insertion = insertText(contents, 'hello')
      const rejection = expect(insertion).rejects.toThrow(
        'did not acknowledge input within 5 seconds'
      )
      await vi.advanceTimersByTimeAsync(5_000)

      await rejection
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['complete', 'split', 'worker', 'detached', 'ambiguous'])(
    'routes OOPIF evaluation through its session (%s tree)',
    async (treeKind) => {
      const contents = new WebContentsView().webContents
      const { child, frameTree } = createOopifFrameFixture()
      await ensureInstrumented(contents, { onDialog: vi.fn(), dialogResponse: () => null })
      const listener = vi
        .mocked(contents.debugger.on)
        .mock.calls.find(([event]) => event === 'message')?.[1] as
        | ((event: unknown, method: string, params: unknown, sessionId?: string) => void)
        | undefined
      expect(listener).toBeTypeOf('function')

      listener?.(
        {},
        'Target.attachedToTarget',
        {
          sessionId: 'child-session',
          targetInfo: { targetId: 'child', type: 'iframe' },
        },
        undefined
      )
      expect(contents.debugger.sendCommand).toHaveBeenCalledWith(
        'Target.setAutoAttach',
        { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
        'child-session'
      )
      if (treeKind === 'worker' || treeKind === 'detached') {
        listener?.({}, 'Target.attachedToTarget', {
          sessionId: 'unavailable-session',
          targetInfo: {
            targetId: 'unavailable',
            type: treeKind === 'worker' ? 'worker' : 'iframe',
          },
        })
      }
      vi.mocked(contents.debugger.sendCommand).mockClear()
      vi.mocked(contents.debugger.sendCommand).mockImplementation((method, _params, sessionId) => {
        if (method === 'Page.getFrameTree') {
          if (sessionId === 'unavailable-session')
            return Promise.reject(new Error('Target unavailable'))
          return Promise.resolve({
            frameTree:
              treeKind === 'complete'
                ? frameTree
                : sessionId
                  ? frameTree.childFrames[0]
                  : { frame: frameTree.frame },
          })
        }
        if (method === 'Page.createIsolatedWorld') {
          return Promise.resolve({ executionContextId: 42 })
        }
        if (method === 'Runtime.evaluate') {
          return Promise.resolve({ result: { type: 'number', value: 4 } })
        }
        return Promise.resolve({})
      })

      if (treeKind === 'ambiguous') {
        /** An omitted twin must not be mistaken for the only frame in a partial tree. */
        child.parent?.frames.push(createOopifFrameFixture().child)
        await expect(evaluateInIsolatedFrame(contents, child, '2 + 2')).rejects.toThrow(
          'Could not map'
        )
        expect(
          vi
            .mocked(contents.debugger.sendCommand)
            .mock.calls.some(([method]) => method === 'Runtime.evaluate')
        ).toBe(false)
        return
      }
      await expect(evaluateInIsolatedFrame(contents, child, '2 + 2')).resolves.toBe(4)

      expect(
        vi
          .mocked(contents.debugger.sendCommand)
          .mock.calls.filter(([method]) =>
            ['Page.createIsolatedWorld', 'Runtime.evaluate'].includes(method)
          )
      ).toEqual([
        [
          'Page.createIsolatedWorld',
          {
            frameId: 'child',
            worldName: 'sim-browser-agent',
            grantUniveralAccess: false,
          },
          'child-session',
        ],
        [
          'Runtime.evaluate',
          {
            expression: '2 + 2',
            contextId: 42,
            returnByValue: true,
            awaitPromise: true,
            userGesture: false,
          },
          'child-session',
        ],
      ])
    }
  )

  it('falls back to the root target when OOPIF isolated-world creation fails', async () => {
    const contents = new WebContentsView().webContents
    const { child, frameTree } = createOopifFrameFixture()
    await ensureInstrumented(contents, { onDialog: vi.fn(), dialogResponse: () => null })
    const listener = vi
      .mocked(contents.debugger.on)
      .mock.calls.find(([event]) => event === 'message')?.[1] as
      | ((event: unknown, method: string, params: unknown, sessionId?: string) => void)
      | undefined
    expect(listener).toBeTypeOf('function')

    listener?.(
      {},
      'Target.attachedToTarget',
      {
        sessionId: 'child-session',
        targetInfo: { targetId: 'child', type: 'iframe' },
      },
      undefined
    )
    vi.mocked(contents.debugger.sendCommand).mockClear()
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method, _params, sessionId) => {
      if (method === 'Page.getFrameTree') {
        return Promise.resolve({ frameTree })
      }
      if (method === 'Page.createIsolatedWorld') {
        if (sessionId === 'child-session') {
          return Promise.reject(new Error('No frame with given id found'))
        }
        return Promise.resolve({ executionContextId: 84 })
      }
      if (method === 'Runtime.evaluate') {
        return Promise.resolve({ result: { type: 'string', value: 'root fallback' } })
      }
      return Promise.resolve({})
    })

    await expect(evaluateInIsolatedFrame(contents, child, 'location.href')).resolves.toBe(
      'root fallback'
    )

    expect(
      vi
        .mocked(contents.debugger.sendCommand)
        .mock.calls.filter(([method]) =>
          ['Page.createIsolatedWorld', 'Runtime.evaluate'].includes(method)
        )
    ).toEqual([
      [
        'Page.createIsolatedWorld',
        {
          frameId: 'child',
          worldName: 'sim-browser-agent',
          grantUniveralAccess: false,
        },
        'child-session',
      ],
      [
        'Page.createIsolatedWorld',
        {
          frameId: 'child',
          worldName: 'sim-browser-agent',
          grantUniveralAccess: false,
        },
      ],
      [
        'Runtime.evaluate',
        {
          expression: 'location.href',
          contextId: 84,
          returnByValue: true,
          awaitPromise: true,
          userGesture: false,
        },
      ],
    ])
  })
})

describe('browser-agent file input handles', () => {
  async function fileInputFixture(childSession = false) {
    const contents = new WebContentsView().webContents
    const { child, frameTree } = createOopifFrameFixture()
    await ensureInstrumented(contents, { onDialog: vi.fn(), dialogResponse: () => null })
    if (childSession) {
      const onMessage = vi.mocked(contents.debugger.on).mock.calls[0]?.[1] as
        | ((event: unknown, method: string, params: unknown, sessionId?: string) => void)
        | undefined
      onMessage?.({}, 'Target.attachedToTarget', {
        sessionId: 'child-session',
        targetInfo: { targetId: 'child', type: 'iframe' },
      })
    }
    const document: { defaultView: { document: unknown } | null } = { defaultView: null }
    document.defaultView = { document }
    const input = {
      tagName: 'INPUT',
      type: 'file',
      isConnected: true,
      ownerDocument: document,
      multiple: true,
      accept: 'application/pdf',
      matches: vi.fn(() => false),
      files: [] as Array<{ name: string; size: number }>,
    }
    const wrapper = { input, document }
    const behavior = {
      rejectEvaluation: false,
      rejectSet: false,
      rejectReadback: false,
      beforeSet: async () => {},
      beforeReadback: async () => {},
      afterInputValidation: () => {},
      afterSet: () => {},
    }
    const send = vi.mocked(contents.debugger.sendCommand)
    send.mockClear().mockImplementation(async (method, params) => {
      if (method === 'Page.getFrameTree') return { frameTree }
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 42 }
      if (method === 'Runtime.evaluate') {
        if (behavior.rejectEvaluation) {
          return {
            result: { objectId: 'exception' },
            exceptionDetails: { exception: { objectId: 'exception', description: 'Ref expired' } },
          }
        }
        return { result: { objectId: 'wrapper' } }
      }
      if (method === 'Runtime.callFunctionOn') {
        expect(params?.objectId).toBe('wrapper')
        const args = params?.arguments as Array<{ value: unknown }>
        if (args[0].value === 'files') await behavior.beforeReadback()
        if (behavior.rejectReadback && args[0].value === 'files') {
          throw new Error('Execution context was destroyed')
        }
        try {
          const inspect = new Function(`return (${params?.functionDeclaration})`)() as (
            ...args: unknown[]
          ) => unknown
          const result = inspect.apply(
            wrapper,
            args.map((arg) => arg.value)
          )
          if (result === input) {
            behavior.afterInputValidation()
            return { result: { objectId: 'original-input' } }
          }
          return { result: { value: result } }
        } catch (error) {
          return {
            result: { objectId: 'exception' },
            exceptionDetails: {
              exception: { objectId: 'exception', description: getErrorMessage(error) },
            },
          }
        }
      }
      if (method === 'DOM.setFileInputFiles') {
        await behavior.beforeSet()
        if (behavior.rejectSet) throw new Error('Input target disappeared')
        expect(params).toEqual({ files: ['/staged/a.pdf'], objectId: 'original-input' })
        input.files = [{ name: 'a.pdf', size: 12 }]
        behavior.afterSet()
      }
      return {}
    })
    return {
      contents,
      frame: childSession ? child : child.parent!,
      input,
      document,
      send,
      behavior,
    }
  }

  it.each([false, true])(
    'keeps capture, dispatch, readback and release in the original session (OOPIF: %s)',
    async (childSession) => {
      const { contents, frame, input, send } = await fileInputFixture(childSession)
      const handle = await resolveFileInput(contents, frame, 'captureUploadInput(4)')
      expect(handle).toMatchObject({ multiple: true, accept: 'application/pdf' })
      expect(input.matches).toHaveBeenCalledWith(':disabled')

      try {
        await expect(setFileInputFiles(contents, handle, ['/staged/a.pdf'])).resolves.toEqual({
          files: [{ name: 'a.pdf', size: 12 }],
        })
      } finally {
        await releaseFileInput(contents, handle)
      }

      const sessionId = childSession ? 'child-session' : undefined
      const protocolCalls = send.mock.calls.filter(([method]) => method !== 'Page.getFrameTree')
      expect(protocolCalls.every((call) => call[2] === sessionId)).toBe(true)
      expect(send.mock.calls.some(([method]) => /Search|DOM.getDocument/.test(method))).toBe(false)
      expect(send.mock.calls.find(([method]) => method === 'Runtime.evaluate')?.[1]).toEqual({
        expression: 'captureUploadInput(4)',
        contextId: 42,
        returnByValue: false,
        awaitPromise: true,
        userGesture: false,
      })
      expect(
        send.mock.calls
          .filter(([method]) => method === 'Runtime.releaseObject')
          .map(([, params]) => params?.objectId)
      ).toEqual(['original-input', 'wrapper'])
    }
  )

  it.each([
    'detached',
    'disabled',
    'adopted',
    'document-replaced',
    'document-closed',
    'type',
    'multiple',
  ])('refuses a captured input changed before dispatch (%s)', async (change) => {
    const { contents, frame, input, document, send } = await fileInputFixture()
    const handle = await resolveFileInput(contents, frame, 'captureUploadInput(4)')
    if (change === 'detached') input.isConnected = false
    if (change === 'disabled') input.matches.mockReturnValue(true)
    if (change === 'adopted') input.ownerDocument = { defaultView: null }
    if (change === 'document-replaced') document.defaultView = { document: {} }
    if (change === 'document-closed') document.defaultView = null
    if (change === 'type') input.type = 'text'
    if (change === 'multiple') input.multiple = false
    const onDispatch = vi.fn()
    try {
      await expect(
        setFileInputFiles(
          contents,
          handle,
          ['/staged/a.pdf', '/staged/b.pdf'],
          undefined,
          onDispatch
        )
      ).rejects.toThrow(/upload input|upload target/)
      expect(onDispatch).not.toHaveBeenCalled()
      expect(send.mock.calls.some(([method]) => method === 'DOM.setFileInputFiles')).toBe(false)
    } finally {
      await releaseFileInput(contents, handle)
    }
    expect(send).toHaveBeenCalledWith('Runtime.releaseObject', { objectId: 'wrapper' })
    expect(
      send.mock.calls.filter(
        ([method, params]) => method === 'Runtime.releaseObject' && params?.objectId === 'exception'
      )
    ).toHaveLength(1)
  })

  it.each(['evaluation', 'metadata'] as const)('releases handles when %s fails', async (phase) => {
    const { contents, frame, input, behavior, send } = await fileInputFixture()
    if (phase === 'evaluation') behavior.rejectEvaluation = true
    else input.matches.mockReturnValue(true)

    await expect(resolveFileInput(contents, frame, 'captureUploadInput(4)')).rejects.toThrow()
    const released = send.mock.calls
      .filter(([method]) => method === 'Runtime.releaseObject')
      .map(([, params]) => params?.objectId)
    expect(released).toEqual(phase === 'evaluation' ? ['exception'] : ['exception', 'wrapper'])
  })

  it('reports pending dispatch while acknowledgement is held, then acknowledges before readback', async () => {
    const { contents, frame, behavior, send } = await fileInputFixture()
    const handle = await resolveFileInput(contents, frame, 'captureUploadInput(4)')
    let acknowledge: () => void = () => {}
    let releaseReadback: () => void = () => {}
    const acknowledgement = new Promise<void>((resolve) => {
      acknowledge = resolve
    })
    const readback = new Promise<void>((resolve) => {
      releaseReadback = resolve
    })
    behavior.beforeSet = () => acknowledgement
    behavior.beforeReadback = () => readback
    const onDispatch = vi.fn()
    const pending = setFileInputFiles(contents, handle, ['/staged/a.pdf'], undefined, onDispatch)
    try {
      await vi.waitFor(() =>
        expect(send.mock.calls.some(([method]) => method === 'DOM.setFileInputFiles')).toBe(true)
      )
      expect(onDispatch.mock.calls).toEqual([['pending']])
      acknowledge()
      await vi.waitFor(() => expect(onDispatch.mock.calls).toEqual([['pending'], ['acknowledged']]))
      expect(send.mock.calls.some(([method]) => method === 'Runtime.releaseObject')).toBe(false)
      releaseReadback()
      await expect(pending).resolves.toEqual({ files: [{ name: 'a.pdf', size: 12 }] })
      expect(onDispatch.mock.calls).toEqual([['pending'], ['acknowledged']])
    } finally {
      acknowledge()
      releaseReadback()
      await pending
      await releaseFileInput(contents, handle)
    }
  })
})

/**
 * The browser panel shows a LIVE view, so a capture must not perturb the page.
 * Chromium serves `clip` by applying device-emulation params to the widget and
 * syncing visual properties, which the user sees as the page rescaling and
 * snapping back. Resolution is bounded on the returned image instead.
 */
describe('browser-agent screenshot capture', () => {
  function captureFixture(
    imageSize: { width: number; height: number } | null,
    imageContent = 'sim'
  ) {
    const contents = new WebContentsView().webContents
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({ cssLayoutViewport: { clientWidth: 2048, clientHeight: 1024 } })
      }
      return Promise.resolve(undefined)
    })
    const resized = {
      getSize: vi.fn(() => ({ width: 1024, height: 512 })),
      toJPEG: vi.fn(() => Buffer.from('resized')),
    }
    const cropped = {
      getSize: vi.fn(() => ({ width: 400, height: 200 })),
      resize: vi.fn(() => resized),
      toJPEG: vi.fn(() => Buffer.from('cropped')),
    }
    const image = {
      isEmpty: vi.fn(() => imageSize === null),
      getSize: vi.fn(() => imageSize ?? { width: 0, height: 0 }),
      crop: vi.fn(() => cropped),
      resize: vi.fn(() => resized),
      toJPEG: vi.fn(() => Buffer.from(imageContent)),
    } as unknown as ReturnType<typeof nativeImage.createFromBuffer>
    vi.mocked(contents.capturePage).mockResolvedValue(image)
    return { contents, resized, cropped, image }
  }

  it('never sends a clip, which would emulate the live page for the capture', async () => {
    const { contents } = captureFixture({ width: 4096, height: 2048 })

    await captureScreenshot(contents)

    expect(contents.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: true })
    expect(contents.debugger.sendCommand).not.toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.anything()
    )
  })

  it.each([
    {
      requested: { x: -10, y: -20, width: 30, height: 40 },
      crop: { x: 0, y: 0, width: 40, height: 40 },
      captured: { x: 0, y: 0, width: 20, height: 20 },
    },
    {
      requested: { x: 2040, y: 1020, width: 30, height: 40 },
      crop: { x: 4080, y: 2040, width: 16, height: 8 },
      captured: { x: 2040, y: 1020, width: 8, height: 4 },
    },
  ])(
    'reports only the encoded portion of a crop clamped to the viewport: $requested',
    async ({ requested, crop, captured }) => {
      const { contents, cropped, image } = captureFixture({ width: 4096, height: 2048 })
      cropped.getSize.mockReturnValue({ width: crop.width, height: crop.height })

      const shot = await captureScreenshot(contents, requested)

      expect(image.crop).toHaveBeenCalledWith(crop)
      expect(shot).toMatchObject({
        clip: captured,
        imageSize: { width: crop.width, height: crop.height },
        scale: 2,
      })
    }
  )

  describe('stalled native capture recovery', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    function observeFrames(contents: WebContents) {
      const frames: Array<(image: NativeImage) => void> = []
      vi.mocked(contents.beginFrameSubscription).mockImplementation((...args: unknown[]) => {
        const callback = args.at(-1) as (image: NativeImage) => void
        frames.push((image) => callback(image))
      })
      return frames
    }

    it('recovers repeatedly with fresh frames without overlapping native surface copies', async () => {
      const { contents } = captureFixture({ width: 1024, height: 512 })
      vi.mocked(contents.capturePage).mockReturnValue(new Promise(() => {}))
      const frames = observeFrames(contents)

      for (let index = 0; index < 5; index++) {
        const { image } = captureFixture({ width: 1024, height: 512 }, `frame-${index}`)
        const capture = captureScreenshot(contents)
        await vi.advanceTimersByTimeAsync(index === 0 ? 5_000 : 0)
        expect(contents.capturePage).toHaveBeenCalledOnce()
        expect(contents.beginFrameSubscription).toHaveBeenLastCalledWith(
          false,
          expect.any(Function)
        )
        expect(frames).toHaveLength(index + 1)
        frames[index](image)
        await expect(capture).resolves.toMatchObject({
          dataUrl: `data:image/jpeg;base64,${Buffer.from(`frame-${index}`).toString('base64')}`,
          imageSize: { width: 1024, height: 512 },
        })
        expect(contents.endFrameSubscription).toHaveBeenCalledTimes(index + 1)
        expect(vi.getTimerCount()).toBe(0)
      }
      const registered = vi
        .mocked(contents.once)
        .mock.calls.filter(([event]) => String(event) === 'destroyed')
      for (const [, listener] of registered) {
        expect(contents.removeListener).toHaveBeenCalledWith('destroyed', listener)
      }
      expect(contents.reload).not.toHaveBeenCalled()
      expect(contents.loadURL).not.toHaveBeenCalled()
    })

    it('bounds both waits and allows another frame attempt after a timeout', async () => {
      const { contents, image } = captureFixture({ width: 1024, height: 512 })
      vi.mocked(contents.capturePage).mockReturnValue(new Promise(() => {}))
      const frames = observeFrames(contents)
      const failed = expect(captureScreenshot(contents)).rejects.toThrow('frame capture timed out')
      await vi.advanceTimersByTimeAsync(9_999)
      expect(contents.endFrameSubscription).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await failed
      expect(contents.endFrameSubscription).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)

      const recovered = captureScreenshot(contents)
      await vi.advanceTimersByTimeAsync(0)
      expect(contents.capturePage).toHaveBeenCalledOnce()
      frames[1](image)
      await expect(recovered).resolves.toMatchObject({ imageSize: { width: 1024, height: 512 } })
      expect(contents.endFrameSubscription).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  it.each(['cancel', 'destroy'] as const)(
    'releases capture listeners and timer on %s',
    async (reason) => {
      vi.useFakeTimers()
      try {
        const { contents } = captureFixture({ width: 1024, height: 512 })
        vi.mocked(contents.capturePage).mockReturnValue(new Promise(() => {}))
        const controller = new AbortController()
        const failed = expect(
          captureScreenshot(contents, undefined, controller.signal)
        ).rejects.toThrow(reason === 'cancel' ? 'cancelled' : 'tab was closed')
        await vi.advanceTimersByTimeAsync(0)
        const destroyed = vi
          .mocked(contents.once)
          .mock.calls.find(([event]) => String(event) === 'destroyed')?.[1] as unknown as
          | (() => void)
          | undefined
        expect(destroyed).toBeDefined()
        if (reason === 'cancel') controller.abort()
        else destroyed?.()
        await failed
        expect(contents.removeListener).toHaveBeenCalledWith('destroyed', destroyed)
        expect(vi.getTimerCount()).toBe(0)
      } finally {
        vi.useRealTimers()
      }
    }
  )

  it('does not expose deprecated device-pixel metrics as a CSS viewport', async () => {
    const { contents } = captureFixture({ width: 1024, height: 512 })
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({ layoutViewport: { clientWidth: 2048, clientHeight: 1024 } })
      }
      return Promise.resolve(undefined)
    })

    const shot = await captureScreenshot(contents)

    expect(shot.viewport).toBeNull()
    expect(shot.imageSize).toEqual({ width: 1024, height: 512 })
  })

  it.each([
    [
      'dimensions',
      { cssLayoutViewport: { clientWidth: 2048, clientHeight: 1024 } },
      { cssLayoutViewport: { clientWidth: 1024, clientHeight: 512 } },
    ],
    [
      'metric units',
      { cssLayoutViewport: { clientWidth: 2048, clientHeight: 1024 } },
      { layoutViewport: { clientWidth: 2048, clientHeight: 1024 } },
    ],
    [
      'horizontal scroll offset',
      { cssLayoutViewport: { clientWidth: 2048, clientHeight: 1024, pageX: 0, pageY: 20 } },
      { cssLayoutViewport: { clientWidth: 2048, clientHeight: 1024, pageX: 10, pageY: 20 } },
    ],
    [
      'vertical scroll offset',
      { cssLayoutViewport: { clientWidth: 2048, clientHeight: 1024, pageX: 10, pageY: 20 } },
      { cssLayoutViewport: { clientWidth: 2048, clientHeight: 1024, pageX: 10, pageY: 30 } },
    ],
    [
      'offset validity',
      { cssLayoutViewport: { clientWidth: 2048, clientHeight: 1024, pageX: 0, pageY: 0 } },
      {
        cssLayoutViewport: {
          clientWidth: 2048,
          clientHeight: 1024,
          pageX: 0,
          pageY: Number.NaN,
        },
      },
    ],
    ['availability', {}, {}],
  ])(
    'rejects a capture when viewport %s change during native capture',
    async (_label, before, after) => {
      const { contents } = captureFixture({ width: 1024, height: 512 })
      let metricsRead = 0
      vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
        if (method === 'Page.getLayoutMetrics') {
          metricsRead++
          return Promise.resolve(metricsRead === 1 ? before : after)
        }
        return Promise.resolve(undefined)
      })

      await expect(captureScreenshot(contents)).rejects.toThrow(/viewport changed/)
    }
  )
})
