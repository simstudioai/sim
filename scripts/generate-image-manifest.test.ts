import { describe, expect, it } from 'vitest'
import { collectImages, pairSources } from './generate-image-manifest'

describe('collectImages', () => {
  it('finds images across every container key a pod spec can use', () => {
    const images = collectImages([
      {
        kind: 'Deployment',
        spec: {
          template: {
            spec: {
              initContainers: [{ image: 'ghcr.io/simstudioai/migrations:v1' }],
              containers: [{ image: 'ghcr.io/simstudioai/simstudio:v1' }],
              ephemeralContainers: [{ image: 'busybox:1.36' }],
            },
          },
        },
      },
    ])

    expect(images).toEqual([
      'busybox:1.36',
      'ghcr.io/simstudioai/migrations:v1',
      'ghcr.io/simstudioai/simstudio:v1',
    ])
  })

  it('reaches containers nested below a workload wrapper', () => {
    const images = collectImages([
      {
        kind: 'CronJob',
        spec: {
          jobTemplate: {
            spec: { template: { spec: { containers: [{ image: 'curlimages/curl:8.5.0' }] } } },
          },
        },
      },
    ])

    expect(images).toEqual(['curlimages/curl:8.5.0'])
  })
})

describe('pairSources', () => {
  it('strips the sentinel registry so the mirror path is what the chart resolves to', () => {
    const paired = pairSources(
      ['ghcr.io/simstudioai/simstudio:v1', 'redis:7-alpine'],
      ['mirror.invalid/simstudioai/simstudio:v1', 'mirror.invalid/redis:7-alpine']
    )

    // ghcr.io is the default registry and is replaced, so it must not survive.
    expect(paired).toEqual([
      { source: 'ghcr.io/simstudioai/simstudio:v1', mirror: 'simstudioai/simstudio:v1' },
      { source: 'redis:7-alpine', mirror: 'redis:7-alpine' },
    ])
  })

  it('fails when a source has no mirrored counterpart', () => {
    expect(() => pairSources(['redis:7-alpine'], [])).toThrow(/renders disagree/)
  })

  it('refuses to guess when two images share a name and tag', () => {
    // Last-write-wins would hand one image the other's mirror path — the silent
    // mis-mirror this inventory exists to prevent.
    expect(() =>
      pairSources(
        ['ghcr.io/simstudioai/redis:7-alpine', 'redis:7-alpine'],
        ['mirror.invalid/simstudioai/redis:7-alpine', 'mirror.invalid/redis:7-alpine']
      )
    ).toThrow(/share the name and tag/)
  })
})
