import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'
import { WORDMARK_PATHS, WORDMARK_VIEW_BOX } from '@/lib/branding/wordmark'
import { STACK_LAYERS } from '@/app/(landing)/components/sim-stack/stack-content'
import {
  STACK_DARK_INK,
  STACK_ENGRAVING,
  STACK_INK,
} from '@/app/(landing)/components/sim-stack/stack-layout'
import {
  getStrokeProgress,
  STACK_MOTIFS,
  type StackMotif,
} from '@/app/(landing)/components/sim-stack/stack-motifs'

export interface StackTextureOptions {
  size: number
  anisotropy: number
}

/** Cache geometry once; scroll changes only the stroke offset and the existing texture. */
export function createStackEngraving(
  index: number,
  fontFamily: string,
  options: StackTextureOptions
) {
  const canvas = document.createElement('canvas')
  canvas.width = options.size
  canvas.height = options.size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Stack engraving requires a 2D canvas')
  const isWordmark = index === STACK_LAYERS.length - 1
  const source: readonly StackMotif[] = isWordmark
    ? WORDMARK_PATHS.map((d) => ({ d, x: 0, y: 0, scale: 1 }))
    : STACK_MOTIFS[index]
  const paths = source.map(({ d, x, y, scale, fade }) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    element.setAttribute('d', d)
    const path = new Path2D()
    path.addPath(new Path2D(d), new DOMMatrix([scale, 0, 0, scale, x, y]))
    return {
      path,
      length: element.getTotalLength() * scale,
      fade: fade && {
        x1: fade.x1 * scale + x,
        y1: fade.y1 * scale + y,
        x2: fade.x2 * scale + x,
        y2: fade.y2 * scale + y,
      },
    }
  })
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = options.anisotropy
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  const createInkGradient = (
    x: number,
    y: number,
    width: number,
    height: number,
    dark: boolean
  ) => {
    const ink = dark ? STACK_DARK_INK : STACK_INK
    const gradient = context.createRadialGradient(x, y, 0, x, y, Math.max(width, height) / 2)
    gradient.addColorStop(0, ink.inner)
    gradient.addColorStop(1, ink.outer)
    return gradient
  }
  let lastProgress = -1
  let lastCompact = false
  let lastLabel = -1
  let lastDark = false
  const draw = (progress: number, compact = false, labelProgress = 1, dark = false) => {
    const next = Math.round(progress * 240) / 240
    const label = Math.round(labelProgress * 240) / 240
    if (
      next === lastProgress &&
      compact === lastCompact &&
      label === lastLabel &&
      dark === lastDark
    )
      return
    lastDark = dark
    lastLabel = label
    lastProgress = next
    lastCompact = compact
    context.resetTransform()
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.scale(options.size / 360, options.size / 360)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.save()
    if (isWordmark) {
      context.translate(
        STACK_ENGRAVING.x - (WORDMARK_VIEW_BOX.width * STACK_ENGRAVING.wordmarkScale) / 2,
        STACK_ENGRAVING.y - (WORDMARK_VIEW_BOX.height * STACK_ENGRAVING.wordmarkScale) / 2
      )
      context.scale(STACK_ENGRAVING.wordmarkScale, STACK_ENGRAVING.wordmarkScale)
      context.fillStyle = createInkGradient(
        WORDMARK_VIEW_BOX.width / 2,
        WORDMARK_VIEW_BOX.height / 2,
        WORDMARK_VIEW_BOX.width,
        WORDMARK_VIEW_BOX.height,
        dark
      )
      context.strokeStyle = context.fillStyle
      context.lineWidth = 2.8
    } else {
      context.translate(STACK_ENGRAVING.x, STACK_ENGRAVING.y)
      context.scale(STACK_ENGRAVING.scale, STACK_ENGRAVING.scale)
      context.strokeStyle = createInkGradient(
        0,
        0,
        STACK_ENGRAVING.gradientRadius * 2,
        STACK_ENGRAVING.gradientRadius * 2,
        dark
      )
      context.lineWidth = compact ? 6.4 : 4
    }
    paths.forEach(({ path, length, fade }, pathIndex) => {
      const drawn = getStrokeProgress(next, pathIndex, paths.length)
      if (drawn === 0) return
      context.save()
      if (fade) {
        const ink = dark ? STACK_DARK_INK : STACK_INK
        const gradient = context.createLinearGradient(fade.x1, fade.y1, fade.x2, fade.y2)
        gradient.addColorStop(0, ink.outer)
        gradient.addColorStop(1, `${ink.outer}00`)
        context.strokeStyle = gradient
      }
      context.setLineDash([length, length])
      context.lineDashOffset = length * (1 - drawn)
      context.stroke(path)
      if (isWordmark && next > 0.85) {
        context.globalAlpha = (next - 0.85) / 0.15
        context.fill(path)
        context.globalAlpha = 1
      }
      context.restore()
    })
    context.restore()
    if (!isWordmark && label > 0) {
      context.font = `400 17px ${fontFamily}`
      context.textAlign = 'center'
      context.globalAlpha = label * label * (3 - 2 * label)
      const title = STACK_LAYERS[index].title
      const metrics = context.measureText(title)
      const width = metrics.width
      context.fillStyle = createInkGradient(
        STACK_ENGRAVING.x,
        STACK_ENGRAVING.labelY +
          (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2,
        width,
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
        dark
      )
      context.fillText(title, STACK_ENGRAVING.x, STACK_ENGRAVING.labelY)
      if (label < 1) {
        const sweep = STACK_ENGRAVING.x - width * 0.8 + label * width * 1.6
        const shimmer = context.createLinearGradient(
          sweep - width * 0.25,
          0,
          sweep + width * 0.25,
          0
        )
        shimmer.addColorStop(0, 'rgba(217, 222, 229, 0)')
        shimmer.addColorStop(0.5, '#d9dee5')
        shimmer.addColorStop(1, 'rgba(217, 222, 229, 0)')
        context.fillStyle = shimmer
        context.fillText(title, STACK_ENGRAVING.x, STACK_ENGRAVING.labelY)
      }
    }
    context.globalAlpha = 1
    texture.needsUpdate = true
  }
  draw(0, false, 0)
  return { texture, draw }
}
