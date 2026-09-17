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
  ensureInstrumented,
  evaluateInIsolatedFrame,
  insertText,
  setColorScheme,
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

    await ensureInstrumented(contents, { onDialog: vi.fn() })

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

    await expect(ensureInstrumented(contents, { onDialog: vi.fn() })).rejects.toThrow(
      'setup acknowledgement lost'
    )
    await expect(ensureInstrumented(contents, { onDialog: vi.fn() })).resolves.toBeUndefined()

    expect(autoAttachAttempts).toBe(2)
  })

  it('dismisses an OOPIF dialog on the flattened child session', async () => {
    const contents = new WebContentsView().webContents
    const onDialog = vi.fn()
    await ensureInstrumented(contents, { onDialog })
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
    expect(onDialog).toHaveBeenCalledWith({ type: 'alert', message: 'Hello', handled: true })
  })

  it('accepts an OOPIF beforeunload dialog on the flattened child session', async () => {
    const contents = new WebContentsView().webContents
    const onDialog = vi.fn()
    await ensureInstrumented(contents, { onDialog })
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
      { type: 'beforeunload', message: 'Leave this page?' },
      'child-session'
    )
    await vi.waitFor(() => expect(onDialog).toHaveBeenCalled())

    expect(contents.debugger.sendCommand).toHaveBeenCalledWith(
      'Page.handleJavaScriptDialog',
      { accept: true },
      'child-session'
    )
    expect(onDialog).toHaveBeenCalledWith({
      type: 'beforeunload',
      message: 'Leave this page?',
      handled: true,
    })
  })

  it('reports an OOPIF dialog as unhandled when child and root commands fail', async () => {
    const contents = new WebContentsView().webContents
    const onDialog = vi.fn()
    await ensureInstrumented(contents, { onDialog })
    const listener = vi
      .mocked(contents.debugger.on)
      .mock.calls.find(([event]) => event === 'message')?.[1] as
      | ((event: unknown, method: string, params: unknown, sessionId?: string) => void)
      | undefined
    expect(listener).toBeTypeOf('function')
    vi.mocked(contents.debugger.sendCommand).mockClear()
    vi.mocked(contents.debugger.sendCommand).mockRejectedValue(new Error('dialog target closed'))

    listener?.(
      {},
      'Page.javascriptDialogOpening',
      { type: 'confirm', message: 'Continue?' },
      'child-session'
    )
    await vi.waitFor(() => expect(onDialog).toHaveBeenCalled())

    expect(vi.mocked(contents.debugger.sendCommand).mock.calls).toEqual([
      ['Page.handleJavaScriptDialog', { accept: false }, 'child-session'],
      ['Page.handleJavaScriptDialog', { accept: false }],
    ])
    expect(onDialog).toHaveBeenCalledWith({
      type: 'confirm',
      message: 'Continue?',
      handled: false,
    })
  })

  it('clicks through Chromium trusted mouse input', async () => {
    const contents = new WebContentsView().webContents

    await clickAt(contents, 120, 240)

    expect(vi.mocked(contents.debugger.sendCommand).mock.calls).toEqual([
      ['Input.dispatchMouseEvent', { type: 'mouseMoved', x: 120, y: 240, button: 'none' }],
      [
        'Input.dispatchMouseEvent',
        {
          type: 'mousePressed',
          x: 120,
          y: 240,
          button: 'left',
          buttons: 1,
          clickCount: 1,
        },
      ],
      [
        'Input.dispatchMouseEvent',
        {
          type: 'mouseReleased',
          x: 120,
          y: 240,
          button: 'left',
          buttons: 0,
          clickCount: 1,
        },
      ],
    ])
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
        clickCount: 1,
      },
    ])
  })

  it('best-effort releases the mouse when the press response is lost', async () => {
    const contents = new WebContentsView().webContents
    vi.mocked(contents.debugger.sendCommand)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('mouse press response lost'))
      .mockRejectedValueOnce(new Error('cleanup unavailable'))

    await expect(clickAt(contents, 36, 48)).rejects.toThrow('mouse press response lost')

    expect(vi.mocked(contents.debugger.sendCommand).mock.calls).toEqual([
      ['Input.dispatchMouseEvent', { type: 'mouseMoved', x: 36, y: 48, button: 'none' }],
      [
        'Input.dispatchMouseEvent',
        {
          type: 'mousePressed',
          x: 36,
          y: 48,
          button: 'left',
          buttons: 1,
          clickCount: 1,
        },
      ],
      [
        'Input.dispatchMouseEvent',
        {
          type: 'mouseReleased',
          x: 36,
          y: 48,
          button: 'left',
          buttons: 0,
          clickCount: 1,
        },
      ],
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

  it('routes OOPIF isolated-world creation and evaluation through its flattened session', async () => {
    const contents = new WebContentsView().webContents
    const { child, frameTree } = createOopifFrameFixture()
    await ensureInstrumented(contents, { onDialog: vi.fn() })
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
    vi.mocked(contents.debugger.sendCommand).mockClear()
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method) => {
      if (method === 'Page.getFrameTree') {
        return Promise.resolve({ frameTree })
      }
      if (method === 'Page.createIsolatedWorld') {
        return Promise.resolve({ executionContextId: 42 })
      }
      if (method === 'Runtime.evaluate') {
        return Promise.resolve({ result: { type: 'number', value: 4 } })
      }
      return Promise.resolve({})
    })

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
  })

  it('falls back to the root target when OOPIF isolated-world creation fails', async () => {
    const contents = new WebContentsView().webContents
    const { child, frameTree } = createOopifFrameFixture()
    await ensureInstrumented(contents, { onDialog: vi.fn() })
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

describe('browser-agent CDP theme', () => {
  it('emulates explicit light and dark preferences', async () => {
    const contents = new WebContentsView().webContents

    await setColorScheme(contents, 'dark')
    await setColorScheme(contents, 'light')

    expect(vi.mocked(contents.debugger.sendCommand).mock.calls).toEqual([
      [
        'Emulation.setEmulatedMedia',
        { features: [{ name: 'prefers-color-scheme', value: 'dark' }] },
      ],
      [
        'Emulation.setEmulatedMedia',
        { features: [{ name: 'prefers-color-scheme', value: 'light' }] },
      ],
    ])
  })

  it('clears the override for the system preference', async () => {
    const contents = new WebContentsView().webContents

    await setColorScheme(contents, 'system')

    expect(contents.debugger.sendCommand).toHaveBeenCalledWith('Emulation.setEmulatedMedia', {
      features: [],
    })
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

  it('crops the decoded image in memory without sending a CDP clip', async () => {
    const { contents, cropped, image } = captureFixture({ width: 4096, height: 2048 })

    const shot = await captureScreenshot(contents, { x: 100, y: 50, width: 200, height: 100 })

    expect(contents.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: true })
    expect(contents.debugger.sendCommand).not.toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.anything()
    )
    expect(image.crop).toHaveBeenCalledWith({ x: 200, y: 100, width: 400, height: 200 })
    expect(cropped.resize).not.toHaveBeenCalled()
    expect(shot).toEqual({
      dataUrl: `data:image/jpeg;base64,${Buffer.from('cropped').toString('base64')}`,
      scale: 2,
      viewport: { width: 2048, height: 1024 },
      imageSize: { width: 400, height: 200 },
      clip: { x: 100, y: 50, width: 200, height: 100 },
    })
  })

  it('reports the actual CSS crop after rounding a narrow fractional element to pixels', async () => {
    const { contents, cropped, image } = captureFixture({ width: 4096, height: 2048 })
    cropped.getSize.mockReturnValue({ width: 3, height: 201 })

    const shot = await captureScreenshot(contents, { x: 0.1, y: 0.2, width: 1.1, height: 100 })

    expect(image.crop).toHaveBeenCalledWith({ x: 0, y: 0, width: 3, height: 201 })
    expect(shot).toMatchObject({
      clip: { x: 0, y: 0, width: 1.5, height: 100.5 },
      imageSize: { width: 3, height: 201 },
      scale: 2,
    })
    expect(100 / shot.scale).toBe(50)
    expect(cropped.resize).not.toHaveBeenCalled()
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

  /**
   * A 2048px CSS viewport bounded to 1024px is scale 0.5, and the capture
   * arrives at device resolution (4096px on a 2x display). The resize is what
   * lands the image on the CSS-relative size the coordinate contract
   * (cssX = imageX / scale) assumes.
   */
  it('downscales the returned image to the CSS-relative size', async () => {
    const { contents, resized, image } = captureFixture({ width: 4096, height: 2048 })

    const shot = await captureScreenshot(contents)

    expect(image.resize).toHaveBeenCalledWith({ width: 1024, height: 512, quality: 'good' })
    expect(resized.toJPEG).toHaveBeenCalled()
    expect(shot).toEqual({
      dataUrl: `data:image/jpeg;base64,${Buffer.from('resized').toString('base64')}`,
      scale: 0.5,
      viewport: { width: 2048, height: 1024 },
      imageSize: { width: 1024, height: 512 },
    })
  })

  it('skips resizing when the capture already matches the target size', async () => {
    const { contents, image } = captureFixture({ width: 1024, height: 512 })

    const shot = await captureScreenshot(contents)

    expect(image.resize).not.toHaveBeenCalled()
    expect(shot).toEqual({
      dataUrl: 'data:image/jpeg;base64,c2lt',
      scale: 0.5,
      viewport: { width: 2048, height: 1024 },
      imageSize: { width: 1024, height: 512 },
    })
  })

  it('rejects an empty native capture', async () => {
    const { contents } = captureFixture(null)
    await expect(captureScreenshot(contents)).rejects.toThrow('empty image')
  })

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

    it('ignores a timed-out frame callback while a later subscription is active', async () => {
      const { contents, image } = captureFixture({ width: 1024, height: 512 }, 'fresh')
      const stale = captureFixture({ width: 1024, height: 512 }, 'stale').image
      vi.mocked(contents.capturePage).mockReturnValue(new Promise(() => {}))
      const frames = observeFrames(contents)
      const failed = expect(captureScreenshot(contents)).rejects.toThrow('frame capture timed out')
      await vi.advanceTimersByTimeAsync(10_000)
      await failed

      const recovered = captureScreenshot(contents)
      const settled = vi.fn()
      void recovered.then(settled)
      await vi.advanceTimersByTimeAsync(0)
      frames[0](stale)
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).not.toHaveBeenCalled()
      expect(contents.endFrameSubscription).toHaveBeenCalledOnce()
      frames[1](image)
      await expect(recovered).resolves.toMatchObject({
        dataUrl: `data:image/jpeg;base64,${Buffer.from('fresh').toString('base64')}`,
      })
      expect(contents.endFrameSubscription).toHaveBeenCalledTimes(2)
    })

    it.each(['resolve', 'reject'] as const)(
      'ignores a late native %s and resumes native captures afterward',
      async (outcome) => {
        const { contents, image } = captureFixture({ width: 1024, height: 512 }, 'current')
        const stale = captureFixture({ width: 1024, height: 512 }, 'stale').image
        let settleNative: () => void = () => {}
        vi.mocked(contents.capturePage).mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              settleNative = () =>
                outcome === 'resolve' ? resolve(stale) : reject(new Error('late failure'))
            })
        )
        const frames = observeFrames(contents)
        const capture = captureScreenshot(contents)
        const settled = vi.fn()
        void capture.then(settled)
        await vi.advanceTimersByTimeAsync(5_000)
        settleNative()
        await vi.advanceTimersByTimeAsync(0)
        expect(settled).not.toHaveBeenCalled()
        expect(contents.endFrameSubscription).not.toHaveBeenCalled()
        frames[0](image)
        await expect(capture).resolves.toMatchObject({
          dataUrl: `data:image/jpeg;base64,${Buffer.from('current').toString('base64')}`,
        })
        await expect(captureScreenshot(contents)).resolves.toMatchObject({
          dataUrl: `data:image/jpeg;base64,${Buffer.from('current').toString('base64')}`,
        })
        expect(contents.capturePage).toHaveBeenCalledTimes(2)
        expect(contents.beginFrameSubscription).toHaveBeenCalledOnce()
        expect(vi.getTimerCount()).toBe(0)
      }
    )

    it('rejects concurrent captures without replacing the active subscription or blocking another tab', async () => {
      const { contents, image } = captureFixture({ width: 1024, height: 512 })
      const other = captureFixture({ width: 1024, height: 512 })
      vi.mocked(contents.capturePage).mockReturnValue(new Promise(() => {}))
      const frames = observeFrames(contents)
      const capture = captureScreenshot(contents)
      await vi.advanceTimersByTimeAsync(0)
      await expect(captureScreenshot(contents)).rejects.toThrow('already in progress')
      expect(contents.capturePage).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(captureScreenshot(contents)).rejects.toThrow('already in progress')
      expect(contents.beginFrameSubscription).toHaveBeenCalledOnce()
      expect(contents.endFrameSubscription).not.toHaveBeenCalled()
      await expect(captureScreenshot(other.contents)).resolves.toMatchObject({
        imageSize: { width: 1024, height: 512 },
      })
      frames[0](image)
      await capture
      expect(contents.endFrameSubscription).toHaveBeenCalledOnce()
    })

    it.each(['cancel', 'destroy'] as const)(
      'releases frame resources on %s and ignores a subsequent frame',
      async (reason) => {
        const { contents, image } = captureFixture({ width: 1024, height: 512 })
        vi.mocked(contents.capturePage).mockReturnValue(new Promise(() => {}))
        const frames = observeFrames(contents)
        const controller = new AbortController()
        const removeAbort = vi.spyOn(controller.signal, 'removeEventListener')
        const failed = expect(
          captureScreenshot(contents, undefined, controller.signal)
        ).rejects.toThrow(reason === 'cancel' ? 'cancelled' : 'tab was closed')
        await vi.advanceTimersByTimeAsync(5_000)
        const destroyed = vi
          .mocked(contents.once)
          .mock.calls.filter(([event]) => String(event) === 'destroyed')
          .at(-1)?.[1] as unknown as (() => void) | undefined
        expect(destroyed).toBeDefined()
        if (reason === 'cancel') controller.abort()
        else {
          vi.mocked(contents.isDestroyed).mockReturnValue(true)
          destroyed?.()
        }
        await failed
        expect(contents.removeListener).toHaveBeenCalledWith('destroyed', destroyed)
        expect(removeAbort).toHaveBeenCalledTimes(2)
        expect(contents.endFrameSubscription).toHaveBeenCalledTimes(reason === 'cancel' ? 1 : 0)
        frames[0](image)
        await vi.advanceTimersByTimeAsync(0)
        expect(contents.endFrameSubscription).toHaveBeenCalledTimes(reason === 'cancel' ? 1 : 0)
        expect(vi.getTimerCount()).toBe(0)
        if (reason === 'cancel') {
          const recovered = captureScreenshot(contents)
          await vi.advanceTimersByTimeAsync(0)
          frames[1](image)
          await recovered
          expect(contents.capturePage).toHaveBeenCalledOnce()
          expect(contents.endFrameSubscription).toHaveBeenCalledTimes(2)
        }
      }
    )

    it.each(['beginFrameSubscription', 'invalidate'] as const)(
      'cleans up a synchronous %s failure and permits another frame attempt',
      async (method) => {
        const { contents, image } = captureFixture({ width: 1024, height: 512 })
        vi.mocked(contents.capturePage).mockReturnValue(new Promise(() => {}))
        const frames = observeFrames(contents)
        vi.mocked(contents[method]).mockImplementationOnce(() => {
          throw new Error('frame setup failed')
        })
        const failed = expect(captureScreenshot(contents)).rejects.toThrow('frame setup failed')
        await vi.advanceTimersByTimeAsync(5_000)
        await failed
        expect(contents.endFrameSubscription).toHaveBeenCalledOnce()
        expect(vi.getTimerCount()).toBe(0)

        const recovered = captureScreenshot(contents)
        await vi.advanceTimersByTimeAsync(0)
        frames.at(-1)?.(image)
        await expect(recovered).resolves.toMatchObject({ imageSize: { width: 1024, height: 512 } })
        expect(contents.capturePage).toHaveBeenCalledOnce()
        expect(contents.endFrameSubscription).toHaveBeenCalledTimes(2)
      }
    )
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

  it('does not start capture after cancellation or keep a synchronous failure pending', async () => {
    const { contents } = captureFixture({ width: 1024, height: 512 })
    const controller = new AbortController()
    controller.abort()
    await expect(captureScreenshot(contents, undefined, controller.signal)).rejects.toThrow()
    expect(contents.capturePage).not.toHaveBeenCalled()
    vi.mocked(contents.capturePage).mockImplementationOnce(() => {
      throw new Error('native failure')
    })
    await expect(captureScreenshot(contents)).rejects.toThrow('native failure')
    await expect(captureScreenshot(contents)).resolves.toMatchObject({
      imageSize: { width: 1024, height: 512 },
    })
  })

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

  it('refuses element cropping without verified CSS viewport metrics', async () => {
    const { contents } = captureFixture({ width: 1024, height: 512 })
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({ layoutViewport: { clientWidth: 2048, clientHeight: 1024 } })
      }
      return Promise.resolve(undefined)
    })

    await expect(
      captureScreenshot(contents, { x: 10, y: 10, width: 100, height: 50 })
    ).rejects.toThrow(/CSS viewport/)
    expect(contents.debugger.sendCommand).not.toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.anything()
    )
  })

  it('accepts stable finite scroll offsets around the capture', async () => {
    const { contents } = captureFixture({ width: 1024, height: 512 })
    vi.mocked(contents.debugger.sendCommand).mockImplementation((method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return Promise.resolve({
          cssLayoutViewport: {
            clientWidth: 2048,
            clientHeight: 1024,
            pageX: 12,
            pageY: 34,
          },
        })
      }
      return Promise.resolve(undefined)
    })

    await expect(captureScreenshot(contents)).resolves.toMatchObject({
      viewport: { width: 2048, height: 1024 },
      imageSize: { width: 1024, height: 512 },
    })
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
