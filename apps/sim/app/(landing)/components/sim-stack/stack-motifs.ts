import { CLAUDE_MARK_PATH, GEMINI_MARK_PATH, OPENAI_MARK_PATH, XAI_MARK_POLYGONS } from '@sim/emcn'
import {
  ISO_INTEGRATE_PATHS,
  ISO_MONITOR_PATHS,
} from '@/app/(landing)/components/platform-suite/components/iso-marks/iso-mark-paths'

/** Draw the existing housing base first, followed by its inner plates and open panels. */
const GOVERNANCE = [0, 1, 2, 3, 5, 6, 7, 4, 8].map((index) => ISO_MONITOR_PATHS[index])
const DATA = [0, 3, 1, 2, 4, 5].map((index) => ISO_INTEGRATE_PATHS[index])

/** Simple outline marks sit directly on the slab's grid, without miniature bases or housings. */
export interface StackMotif {
  d: string
  x: number
  y: number
  scale: number
  fade?: { x1: number; y1: number; x2: number; y2: number }
}

/** Normalize the existing provider artwork into four evenly sized, unfilled marks. */
const MODELS: StackMotif[] = [
  { d: CLAUDE_MARK_PATH, x: -170, y: -170, scale: 1.32 },
  { d: OPENAI_MARK_PATH, x: 38, y: -170, scale: 5.5 },
  {
    d: XAI_MARK_POLYGONS.map((points) => `M${points.split(' ').join('L')}Z`).join(''),
    x: -104 - 420.945 * (132 / 481.45),
    y: 104 - 297.635 * (132 / 481.45),
    scale: 132 / 481.45,
  },
  { d: GEMINI_MARK_PATH, x: 38, y: 38, scale: 5.5 },
]

/** Selected workflow card: rounded body, connection swells, and the action-menu shoulder profile. */
const WORKFLOW_NODE = [
  'M-174 -76H174Q200 -76 200 -50V78Q200 104 174 104H-174Q-200 104 -200 78V-50Q-200 -76 -174 -76Z',
  'M-136 -76C-132.43 -76.15 -126.67 -77.73 -118.73 -89.22C-97.49 -120 -97.59 -120 -88 -120H130C139.59 -120 139.49 -120 160.73 -89.22C168.67 -77.73 174.43 -76.15 178 -76',
  'M-200 -14C-200 -8 -212 -8 -212 0V24C-212 32 -200 32 -200 38M-212 12H-246',
  'M200 -14C200 -8 212 -8 212 0V24C212 32 200 32 200 38M212 12H246',
] as const

/** Outlines from the workflow action bar's EMCN PlayOutline, Circle, Unlock, Duplicate, and Trash glyphs. */
const WORKFLOW_ACTIONS = [
  'M14.26 5.39C16.17 6.48 17.67 7.33 18.73 8.11C19.81 8.89 20.6 9.71 20.89 10.79C21.09 11.58 21.09 12.42 20.89 13.21C20.6 14.29 19.81 15.11 18.73 15.89C17.67 16.67 16.17 17.52 14.26 18.61C12.42 19.65 10.87 20.53 9.69 21.04C8.51 21.54 7.42 21.8 6.37 21.5C5.6 21.28 4.89 20.86 4.33 20.29C3.56 19.51 3.25 18.44 3.1 17.15C2.96 15.87 2.96 14.19 2.96 12.06V11.94C2.96 9.81 2.96 8.13 3.1 6.85C3.25 5.56 3.56 4.49 4.33 3.71C4.89 3.14 5.6 2.72 6.37 2.5C7.42 2.2 8.51 2.46 9.69 2.96C10.87 3.47 12.42 4.35 14.26 5.39Z',
  'M19.25 9.75A9 9 0 1 1 1.25 9.75A9 9 0 1 1 19.25 9.75Z',
  'M4.75 8.75H15.75Q17.75 8.75 17.75 10.75V16.75Q17.75 18.75 15.75 18.75H4.75Q2.75 18.75 2.75 16.75V10.75Q2.75 8.75 4.75 8.75ZM5.75 8.75V5.75C5.75 3.26 7.76 1.25 10.25 1.25C12.74 1.25 14.75 3.26 14.75 5.75',
  'M14.25 0.75H2.75C1.65 0.75 0.75 1.65 0.75 2.75V14.25M7.25 5.25H17.25Q19.25 5.25 19.25 7.25V17.25Q19.25 19.25 17.25 19.25H7.25Q5.25 19.25 5.25 17.25V7.25Q5.25 5.25 7.25 5.25Z',
  'M0.75 4.75H19.75M3.25 4.75V16.25C3.25 17.63 4.37 18.75 5.75 18.75H14.75C16.13 18.75 17.25 17.63 17.25 16.25V4.75M7.25 4.75V3.25C7.25 2.15 8.15 1.25 9.25 1.25H11.25C12.35 1.25 13.25 2.15 13.25 3.25V4.75',
] as const

const WORKFLOW_PLACEHOLDERS = ['M-150 -28H-20', 'M-150 28H70'] as const

const AGENTS: StackMotif[] = [
  ...outlinePaths(WORKFLOW_NODE).map((motif) => ({ ...motif, y: -50, scale: 1.12 })),
  ...WORKFLOW_ACTIONS.map((d, index) => ({
    d,
    x: (-77 + index * 46) * 1.12,
    y: -113 * 1.12 - 50,
    scale: 1.2 * 1.12,
  })),
  ...WORKFLOW_PLACEHOLDERS.map((d) => ({ d, x: 0, y: -50, scale: 1.12 })),
  {
    d: 'M-275.52 -36.56H-420',
    x: 0,
    y: 0,
    scale: 1,
    fade: { x1: -275.52, y1: -36.56, x2: -420, y2: -36.56 },
  },
  {
    d: 'M275.52 -36.56H420',
    x: 0,
    y: 0,
    scale: 1,
    fade: { x1: 275.52, y1: -36.56, x2: 420, y2: -36.56 },
  },
]

const OBSERVABILITY = [
  'M-175 0C-130 -80 -65 -115 0 -115C65 -115 130 -80 175 0C130 80 65 115 0 115C-65 115 -130 80 -175 0Z',
  'M56 0A56 56 0 1 1 -56 0A56 56 0 1 1 56 0Z',
] as const

function outlinePaths(paths: readonly string[]): StackMotif[] {
  return paths.map((d) => ({ d, x: 0, y: 0, scale: 1 }))
}

export const STACK_MOTIFS: readonly (readonly StackMotif[])[] = [
  outlinePaths(GOVERNANCE),
  outlinePaths(DATA),
  MODELS.map(({ d, x, y, scale }) => ({
    d,
    x: x * 1.4,
    y: y * 1.4,
    scale: scale * 1.4,
  })),
  AGENTS,
  outlinePaths(OBSERVABILITY),
]

/** All renderers use the same base-to-detail stroke timing. */
export function getStrokeProgress(progress: number, index: number, count: number) {
  return Math.min(1, Math.max(0, (progress * (count + 0.3) - index) / 1.3))
}
