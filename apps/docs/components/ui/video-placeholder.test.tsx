/** @vitest-environment jsdom */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoChapters } from '@/components/ui/video-chapters'
import { VideoPlaceholder } from '@/components/ui/video-placeholder'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderLesson() {
  act(() =>
    root.render(
      <>
        <VideoChapters chapters={[{ title: 'Run the workflow', time: '1:06' }]} />
        <VideoPlaceholder
          title='Tables'
          src='/lesson.mp4'
          captionsSrc='/captions/academy/tables-intro.en.vtt'
        />
      </>
    )
  )
}

describe('lesson playback', () => {
  it('loads an explicitly labelled caption track and moves focus to the player', () => {
    renderLesson()
    const play = host.querySelector<HTMLButtonElement>('[aria-label="Play Tables"]')!
    act(() => play.click())
    const video = host.querySelector('video')!
    const track = video.querySelector('track')!
    expect(document.activeElement).toBe(video)
    expect(track.kind).toBe('captions')
    expect(track.srclang).toBe('en')
    expect(track.label).toBe('English (auto-generated)')
    expect(track.getAttribute('src')).toBe('/captions/academy/tables-intro.en.vtt')
    expect(track.default).toBe(true)
  })

  it('starts at a selected chapter after metadata loads and reuses the player for later seeks', () => {
    renderLesson()
    const chapter = host.querySelector<HTMLButtonElement>('aside button')!
    expect(chapter.disabled).toBe(false)
    act(() => chapter.click())
    const video = host.querySelector('video')!
    act(() => video.dispatchEvent(new Event('loadedmetadata')))
    expect(video.currentTime).toBe(66)
    video.currentTime = 80
    act(() => chapter.click())
    expect(host.querySelector('video')).toBe(video)
    expect(video.currentTime).toBe(66)
    expect(video.play).toHaveBeenCalledTimes(2)
  })

  it('leaves chapters disabled when the lesson has no video', () => {
    act(() =>
      root.render(
        <>
          <VideoPlaceholder title='Future lesson' />
          <VideoChapters chapters={[{ title: 'Introduction', time: '0:00' }]} />
        </>
      )
    )
    expect(host.querySelector<HTMLButtonElement>('aside button')!.disabled).toBe(true)
    expect(host.querySelector('video')).toBeNull()
  })

  it('removes the chapter subscription when the player unmounts', () => {
    renderLesson()
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Play Tables"]')!.click())
    const video = host.querySelector('video')!
    act(() => root.render(null))
    act(() => window.dispatchEvent(new CustomEvent('academy:seek', { detail: { time: 66 } })))
    expect(video.play).not.toHaveBeenCalled()
  })
})
