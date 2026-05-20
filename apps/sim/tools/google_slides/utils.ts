import { generateRandomString } from '@sim/utils/random'

/** 1 point = 12700 EMU (English Metric Units). */
export const PT_TO_EMU = 12700

export interface OpaqueColor {
  rgbColor: { red: number; green: number; blue: number }
}

export interface TextRangeInput {
  rangeType?: 'ALL' | 'FROM_START_INDEX' | 'FIXED_RANGE'
  startIndex?: number
  endIndex?: number
}

export interface CellLocationInput {
  rowIndex?: number
  columnIndex?: number
}

/**
 * Convert a hex color string (`#RRGGBB`, `#RGB`, or bare hex) into the
 * Google Slides API's OpaqueColor shape with rgbColor scaled 0-1.
 * Returns null when input is empty/invalid.
 */
export function hexToOpaqueColor(input?: string | null): OpaqueColor | null {
  if (!input) return null
  let hex = input.trim().replace(/^#/, '')
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return {
    rgbColor: {
      red: r / 255,
      green: g / 255,
      blue: b / 255,
    },
  }
}

/**
 * Build a Slides API TextRange. Defaults to range type ALL.
 * `FROM_START_INDEX` requires startIndex; `FIXED_RANGE` requires both indices.
 */
export function buildTextRange(input: TextRangeInput | undefined) {
  const rangeType = input?.rangeType ?? 'ALL'
  if (rangeType === 'FROM_START_INDEX') {
    return { type: 'FROM_START_INDEX', startIndex: input?.startIndex ?? 0 }
  }
  if (rangeType === 'FIXED_RANGE') {
    return {
      type: 'FIXED_RANGE',
      startIndex: input?.startIndex ?? 0,
      endIndex: input?.endIndex ?? 0,
    }
  }
  return { type: 'ALL' }
}

/**
 * Build an optional cellLocation if both row and column indices are provided.
 * Slides API treats absence as targeting the shape itself (not a table cell).
 */
export function buildCellLocation(input: CellLocationInput | undefined) {
  if (input?.rowIndex === undefined || input?.columnIndex === undefined) return undefined
  return { rowIndex: input.rowIndex, columnIndex: input.columnIndex }
}

/** Generate a stable-enough object ID prefixed by kind. */
export function generateObjectId(kind: string): string {
  return `${kind}_${Date.now()}_${generateRandomString(7)}`
}

/** Convert a points value (or undefined) to an EMU Dimension object. */
export function ptToEmuDimension(pt: number | undefined, fallbackPt: number) {
  return {
    magnitude: (pt ?? fallbackPt) * PT_TO_EMU,
    unit: 'EMU',
  }
}

/** Build a standard PageElementProperties with size + transform from points. */
export function buildElementProperties(opts: {
  pageObjectId: string
  width?: number
  height?: number
  positionX?: number
  positionY?: number
  defaultWidth?: number
  defaultHeight?: number
  defaultX?: number
  defaultY?: number
}) {
  return {
    pageObjectId: opts.pageObjectId,
    size: {
      width: ptToEmuDimension(opts.width, opts.defaultWidth ?? 200),
      height: ptToEmuDimension(opts.height, opts.defaultHeight ?? 100),
    },
    transform: {
      scaleX: 1,
      scaleY: 1,
      translateX: (opts.positionX ?? opts.defaultX ?? 100) * PT_TO_EMU,
      translateY: (opts.positionY ?? opts.defaultY ?? 100) * PT_TO_EMU,
      unit: 'EMU',
    },
  }
}

/** Standard presentation URL for embedding in metadata. */
export function presentationUrl(presentationId: string): string {
  return `https://docs.google.com/presentation/d/${presentationId}/edit`
}

/** Standard fetch headers for Slides API JSON calls. */
export function authJsonHeaders(accessToken: string) {
  if (!accessToken) throw new Error('Access token is required')
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

/** Resolve the batchUpdate URL for a given presentation. */
export function batchUpdateUrl(presentationId: string | undefined): string {
  const id = presentationId?.trim()
  if (!id) throw new Error('Presentation ID is required')
  return `https://slides.googleapis.com/v1/presentations/${id}:batchUpdate`
}
