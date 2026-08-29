/**
 * @vitest-environment node
 *
 * Guards every Spotify tool against path traversal through an LLM-writable
 * identifier that gets interpolated into the request path.
 *
 * `playlistId`, `albumId`, `artistId`, `trackId`, `showId`, `episodeId`,
 * `audiobookId`, and `userId` are `visibility: 'user-or-llm'`, so prompt
 * injection controls them. These call sites interpolated the raw value with no
 * encoding at all, so a value like `../users/victim/playlists` escaped its API
 * prefix once `fetch` normalized the URL, re-aiming the request — and the
 * user's Spotify OAuth token — at a different resource, including on the DELETE
 * routes that unfollow a playlist or remove its tracks.
 *
 * `encodeURIComponent` alone would not have closed it, which is why the bare
 * `.` and `..` vectors below are the point of this file: both are made of
 * unreserved characters, so they survive encoding untouched and the URL parser
 * then removes them as dot segments, popping one path segment off a fixed host.
 * Every assertion resolves the built URL with `new URL(...)` — the same
 * normalization `fetch` performs — rather than string-matching the template
 * output, because string matching is exactly what let this through.
 */
import { describe, expect, it } from 'vitest'
import * as spotifyTools from '@/tools/spotify/index'
import type { ToolConfig } from '@/tools/types'

/**
 * The bare `.` and `..` entries are the whole point: their omission is why an
 * `encodeURIComponent`-only fix would look correct while the hole stayed live.
 */
const TRAVERSAL_IDS = [
  '..',
  '.',
  '  ..  ',
  '../../users/victim',
  '..%2f..%2fusers/victim',
  '3n3Ppam7vgaVa1iaRUc9Lp/../../me/player/pause',
  '3n3Ppam7vgaVa1iaRUc9Lp?market=XX',
  '3n3Ppam7vgaVa1iaRUc9Lp#fragment',
  'tracks/../../../v1/me/tracks',
  '\\..\\..',
] as const

/**
 * Values a real Spotify caller supplies — base-62 resource ids and user ids;
 * none may be rejected, and none may reach the wire as a different value.
 */
const LEGITIMATE_IDS = [
  '3n3Ppam7vgaVa1iaRUc9Lp',
  '6rqhFgbbKwnb9MLmUQDhG6',
  '37i9dQZF1DXcBWIGoYBM5M',
  '4aawyAB9vmqN3uQ7FjRGTy',
  'spotify',
  'smedjan',
  'wizzler',
  '31vrxfguqhbrqrfnkwbcvpvvbhui',
  '..foo',
  'foo..',
] as const

const SAFE_ID = 'SAFEID'

type AnyTool = ToolConfig<any, any>

function isSpotifyTool(value: unknown): value is AnyTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnyTool).id === 'string' &&
    (value as AnyTool).id.startsWith('spotify_')
  )
}

/**
 * Builds a param object for a tool, filling every declared string param with
 * `value` so whichever one reaches the path is exercised.
 */
function buildParams(tool: AnyTool, value: string): Record<string, unknown> {
  const params: Record<string, unknown> = { accessToken: 'token' }
  for (const [name, def] of Object.entries(tool.params ?? {})) {
    if (name === 'accessToken') continue
    const type = (def as { type?: string }).type
    if (type === 'json' || type === 'array') {
      params[name] = []
    } else if (type === 'number') {
      params[name] = 1
    } else if (type === 'boolean') {
      params[name] = false
    } else {
      params[name] = value
    }
  }
  return params
}

function buildUrl(tool: AnyTool, value: string): URL {
  const url = tool.request?.url
  if (typeof url !== 'function') {
    throw new Error(`${tool.id} does not build its URL from params`)
  }
  return new URL(url(buildParams(tool, value) as any))
}

function segmentsOf(url: URL): string[] {
  return url.pathname.split('/')
}

const DYNAMIC_PATH_TOOLS = Object.values(spotifyTools)
  .filter(isSpotifyTool)
  .filter((tool) => typeof tool.request?.url === 'function')
  .filter((tool) => {
    try {
      return segmentsOf(buildUrl(tool, SAFE_ID)).includes(SAFE_ID)
    } catch {
      return false
    }
  })
  .map((tool) => ({ name: tool.id, tool }))

describe('spotify path-ID traversal safety', () => {
  it('covers every Spotify tool that interpolates an ID into its path', () => {
    expect(DYNAMIC_PATH_TOOLS.length).toBeGreaterThanOrEqual(24)
  })

  describe.each(DYNAMIC_PATH_TOOLS)('$name', ({ tool }) => {
    const baseline = segmentsOf(buildUrl(tool, SAFE_ID))

    it.each(TRAVERSAL_IDS)('cannot reshape the path with %j', (value) => {
      let url: URL
      try {
        url = buildUrl(tool, value)
      } catch {
        return
      }

      expect(url.origin).toBe('https://api.spotify.com')

      const actual = segmentsOf(url)
      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) return
        expect(actual[index]).toBe(segment)
      })
    })

    it.each(LEGITIMATE_IDS)('passes %j through unchanged', (value) => {
      const actual = segmentsOf(buildUrl(tool, value))

      expect(actual).toHaveLength(baseline.length)
      baseline.forEach((segment, index) => {
        if (segment === SAFE_ID) {
          expect(decodeURIComponent(actual[index])).toBe(value)
          return
        }
        expect(actual[index]).toBe(segment)
      })
    })

    it('rejects a bare dot-dot segment instead of silently popping a segment', () => {
      expect(() => buildUrl(tool, '..')).toThrow(/path traversal/)
    })

    it('rejects a bare dot segment', () => {
      expect(() => buildUrl(tool, '.')).toThrow(/path traversal/)
    })

    it('does not let the ID inject query parameters', () => {
      expect(
        buildUrl(tool, '3n3Ppam7vgaVa1iaRUc9Lp?market=XX').searchParams.get('market')
      ).not.toBe('XX')
    })
  })
})
