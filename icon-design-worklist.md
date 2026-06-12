# Icon Design Worklist

Goal: redesign the core icon set in `@/components/emcn/icons` before the lucide→emcn migration, so the app lands on the final look in a single visual change.

Three things feed the worklist:
1. **Existing emcn icons** — already in the barrel; redesign in place (one file each, auto-propagates).
2. **lucide-only icons** — 57 glyphs with no emcn equivalent yet; must be designed before they can be migrated.
3. **Dead exports** — drop, don't design.

---

## TIER 0 — Don't design these

### Dead emcn exports (19) — delete or repurpose, nothing renders them
`DocumentAttachment, Fingerprint, Hand, HexSimple, KeySquare, LogIn, Mic, NoWrap, PillsRing, Redo, Slash, ThumbsDown, ThumbsUp, TrashOutline, UserPlus, Wordmark, ZoomIn, ZoomOut` (+ `Play`, superseded by `PlayOutline`)

### lucide name-aliases of an existing emcn glyph (8) — no design, just add alias export + migrate
| lucide name | maps to emcn | lucide uses |
|---|---|---|
| `XIcon` | `X` | 1 |
| `SendIcon` | `Send` | 1 |
| `ServerIcon` | `Server` | 1 |
| `WrenchIcon` | `Wrench` | 1 |
| `Tag` | `TagIcon` | 2 |
| `AlertTriangle` | `TriangleAlert` | 5 |
| `AlertCircle` | `CircleAlert` | 5 |
| `CheckCircle2` | `CircleCheck` | 7 |

---

## TIER 1 — Core glyphs (redesign FIRST; they define the app's character)

These already exist in emcn and appear everywhere. Lock the design language here before anything fans out. Grouped by visual family.

### Arrows & chevrons (most-touched family)
| icon | emcn uses | + lucide migration |
|---|---|---|
| `ChevronDown` | 21 | +24 |
| `ArrowLeft` | 14 | +5 |
| `ArrowUp` | 11 | +15 |
| `ArrowDown` | 10 | +6 |
| `ArrowRight` | 6 | +7 |
| `ArrowUpDown` | 1 | +1 |

### Actions / controls
| icon | emcn uses | + lucide migration |
|---|---|---|
| `Search` | 44 | +14 |
| `Plus` | 27 | +29 |
| `X` | 16 | +31 |
| `Check` | 16 | +23 |
| `Pencil` | 16 | +7 |
| `Trash` | 25 | — |
| `Settings` | 11 | +2 |
| `MoreHorizontal` | 9 | +9 |
| `Send` | 13 | — |
| `Download` | 18 / `Upload` 17 | — |
| `Duplicate` | 11 | — |

### Files / folders / data
| icon | emcn uses | + lucide migration |
|---|---|---|
| `File` | 23 | +1 |
| `Files` | 18 | — |
| `Folder` | 15 | +3 |
| `Table` | 21 | +1 |
| `Database` | 19 | +3 |
| `Library` | 12 | +1 |
| `Clipboard` | 4 | +12 |

### Status / object primitives
| icon | emcn uses | + lucide migration |
|---|---|---|
| `Eye` 10 / `EyeOff` 1 | | +7 / +7 |
| `Lock` 7 / `Unlock` 3 | | +3 / +2 |
| `Key` | 9 | +1 |
| `Info` | 5 | +10 |
| `Square` | 7 | +2 |
| `Calendar` 10 / `Clock` 2 | | +4 (Clock) |
| `Loader` | 10 | — |
| `User` 10 / `Users` 5 | | +1 / +2 |
| `Link` | 10 | — |

### Type markers (designed as a set — keep visually unified)
`TypeText` 4 · `TypeNumber` 4 · `TypeBoolean` 4 · `TypeJson` 2

### Media / misc high-use
`PlayOutline` 15 · `Pause` 4 (+3) · `Bell` 2 (+2) · `Paperclip` 1 (+5) · `RefreshCw` 3 (+5) · `Pin` 3 (+2) / `PinOff` 2 (+1)

---

## TIER 2 — lucide-only, derivable from a TIER 1 glyph (low design — rotate/compose/variant)

Design these as transforms of the core set, not from scratch.

| lucide icon | uses | derive from |
|---|---|---|
| `ChevronRight` | 18 | rotate `ChevronDown` |
| `ChevronUp` | 9 | rotate `ChevronDown` |
| `ChevronLeft` | 6 | rotate `ChevronDown` |
| `ChevronsUpDown` | 4 | double `ChevronDown` |
| `MoreVertical` | 2 | rotate `MoreHorizontal` |
| `ArrowLeftRight` | 5 | variant of `ArrowUpDown` |
| `ArrowUpLeft` | 1 | diagonal arrow variant |
| `RotateCcw` | 4 | variant of `RefreshCw` / `Undo` |
| `XCircle` | 3 | `X` in circle (status family) |
| `PauseCircle` | 1 | `Pause` in circle |
| `CircleOff` | 2 | `Circle` variant |
| `Circle` | 5 | primitive |
| `Minus` | 1 | primitive |
| `Settings2` | 1 | variant of `Settings` |
| `KeyRound` | 1 | variant of `Key` |
| `LibraryBig` | 1 | variant of `Library` |
| `FolderOpen` | 1 | variant of `Folder` |
| `FileText` | 4 | variant of `File` |
| `MicOff` | 1 | variant of `Mic` |
| `Filter` | 1 | reconcile with emcn `ListFilter` |
| `Image` | 2 | reconcile with emcn `ImageUp` |
| `ExternalLink` | 8 | reconcile with emcn `SquareArrowUpRight` |

---

## TIER 3 — Genuinely new glyphs to design from scratch

No emcn equivalent, not derivable. These are the real net-new design load.

### Higher use (design early)
`RepeatIcon` (10) · `SplitIcon` (10) · `Wand2` (4) · `GraduationCap` (3)

### Single-use new glyphs (23)
`Bot` · `Building2` · `Camera` · `Compass` · `FormInput` · `GitBranch` · `Github` · `Globe` · `Hash` · `History` · `MessageCircle` · `Moon` · `Music` · `Phone` · `Rss` · `Scan` · `Scissors` · `SendToBack` · `Share2` · `Sparkles` · `Sun` · `Webhook` · `Workflow`

> Note: `Github` is a brand logo — check whether it should live in `components/icons.tsx` (brand set) rather than the emcn UI set.

---

## Effort summary

| Tier | What | Count | Design load |
|---|---|---|---|
| 0 | dead exports + name-aliases | 19 + 8 | none |
| 1 | core emcn glyphs (redesign in place) | ~45 | the bulk of the *quality* work |
| 2 | lucide-only, derived from core | 22 | low (transforms) |
| 3 | lucide-only, net-new | 27 | the bulk of the *net-new* work |

Recommended order: **Tier 1 first** (locks the language) → Tier 2 (cheap, falls out of Tier 1) → Tier 3 (independent, can run in parallel with a designer) → Tier 0 cleanup folded into the migration PRs.
