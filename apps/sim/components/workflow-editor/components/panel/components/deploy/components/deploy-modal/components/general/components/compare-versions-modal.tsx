'use client'

/** One side of a comparison: the editor draft or a numbered deployment version. */
export type CompareSide = { kind: 'draft' } | { kind: 'version'; version: number }
