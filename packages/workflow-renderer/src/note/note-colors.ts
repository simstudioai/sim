/**
 * The note palette, keyed by id so lookup is total by construction.
 *
 * Declared as a record rather than an array because every consumer either
 * resolves one entry by id or renders all of them in order — a record gives the
 * first without a fallback branch, and `Object.values` gives the second in
 * declaration order.
 */
const NOTE_COLOR_OPTIONS_BY_ID = {
  white: {
    id: 'white',
    label: 'White',
    fill: '#FFFFFF',
    hoverSilhouetteColor: undefined,
    selectedSilhouetteColor: undefined,
    textClassName: 'text-black/75 hover:text-[#171717]',
    placeholderClassName: 'text-black/45',
    selectionClassName: 'selection:bg-black/15',
    caretClassName: 'caret-black',
    swatchClassName: 'bg-white',
  },
  'light-gray': {
    id: 'light-gray',
    label: 'Light gray',
    fill: '#E5E5E5',
    hoverSilhouetteColor: '#D4D4D4',
    selectedSilhouetteColor: undefined,
    textClassName: 'text-black/75 hover:text-[#171717]',
    placeholderClassName: 'text-black/45',
    selectionClassName: 'selection:bg-black/15',
    caretClassName: 'caret-black',
    swatchClassName: 'bg-[#E5E5E5]',
  },
  carbon: {
    id: 'carbon',
    label: 'Graphite',
    fill: '#525252',
    hoverSilhouetteColor: undefined,
    selectedSilhouetteColor: '#3F3F3F',
    textClassName: 'text-white/75 hover:text-white',
    placeholderClassName: 'text-white/55',
    selectionClassName: 'selection:bg-white/25',
    caretClassName: 'caret-white',
    swatchClassName: 'bg-[#525252]',
  },
} as const

export type NoteColor = keyof typeof NOTE_COLOR_OPTIONS_BY_ID
export type NoteColorOption = (typeof NOTE_COLOR_OPTIONS_BY_ID)[NoteColor]

/** Every offered color, in the order the picker renders them. */
export const NOTE_COLOR_OPTIONS: readonly NoteColorOption[] =
  Object.values(NOTE_COLOR_OPTIONS_BY_ID)

export const DEFAULT_NOTE_COLOR: NoteColor = 'carbon'

/**
 * Whether a stored value is still one of the offered colors.
 *
 * `Object.hasOwn`, not `in`: the latter walks the prototype chain, so a stored
 * color of `"toString"` or `"constructor"` would pass and then resolve to an
 * inherited function whose every style field reads `undefined`. The value
 * survives sanitization by design, so it can arrive from an import, a copilot
 * edit, or the realtime socket without ever passing through the picker.
 */
export function isNoteColor(value: unknown): value is NoteColor {
  return typeof value === 'string' && Object.hasOwn(NOTE_COLOR_OPTIONS_BY_ID, value)
}

/**
 * The palette entry for a color.
 *
 * Callers narrow unknown stored values with {@link isNoteColor} first, so this
 * lookup is total — a fallback here would be a second, silently competing
 * default alongside {@link DEFAULT_NOTE_COLOR}.
 */
export function getNoteColorOption(color: NoteColor): NoteColorOption {
  return NOTE_COLOR_OPTIONS_BY_ID[color]
}
