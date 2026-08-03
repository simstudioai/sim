export const NOTE_COLOR_OPTIONS = [
  {
    id: 'white',
    label: 'White',
    fill: '#FFFFFF',
    hoverSilhouetteColor: undefined,
    selectedSilhouetteColor: undefined,
    textClassName: 'text-black/75 hover:text-[#171717]',
    placeholderClassName: 'text-black/45',
    inputPlaceholderClassName: 'placeholder:text-black/45',
    selectionClassName: 'selection:bg-black/15',
    swatchClassName: 'bg-white',
  },
  {
    id: 'light-gray',
    label: 'Light gray',
    fill: '#E5E5E5',
    hoverSilhouetteColor: '#D4D4D4',
    selectedSilhouetteColor: undefined,
    textClassName: 'text-black/75 hover:text-[#171717]',
    placeholderClassName: 'text-black/45',
    inputPlaceholderClassName: 'placeholder:text-black/45',
    selectionClassName: 'selection:bg-black/15',
    swatchClassName: 'bg-[#E5E5E5]',
  },
  {
    id: 'carbon',
    label: 'Graphite',
    fill: '#525252',
    hoverSilhouetteColor: undefined,
    selectedSilhouetteColor: '#3F3F3F',
    textClassName: 'text-white/75 hover:text-white',
    placeholderClassName: 'text-white/55',
    inputPlaceholderClassName: 'placeholder:text-white/55',
    selectionClassName: 'selection:bg-white/25',
    swatchClassName: 'bg-[#525252]',
  },
] as const

export type NoteColor = (typeof NOTE_COLOR_OPTIONS)[number]['id']

export const DEFAULT_NOTE_COLOR: NoteColor = 'carbon'

export function isNoteColor(value: unknown): value is NoteColor {
  return NOTE_COLOR_OPTIONS.some((option) => option.id === value)
}

export function getNoteColorOption(color: NoteColor) {
  return NOTE_COLOR_OPTIONS.find((option) => option.id === color) ?? NOTE_COLOR_OPTIONS[2]
}
