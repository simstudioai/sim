/**
 * Static content for the get_platform_actions tool.
 * Contains the Sim platform quick reference and keyboard shortcuts.
 */
export const PLATFORM_ACTIONS_CONTENT = `# Sim Platform Quick Reference & Keyboard Shortcuts

## Keyboard Shortcuts
**Mod** = Cmd (macOS) / Ctrl (Windows/Linux). Shortcuts work when canvas is focused.

### Workflow Actions
| Shortcut | Action |
|----------|--------|
| Mod+Enter | Run workflow (or cancel if running) |
| Mod+Z | Undo |
| Mod+Shift+Z | Redo |
| Mod+C | Copy selected blocks |
| Mod+X | Cut selected blocks |
| Mod+V | Paste blocks |
| Delete/Backspace | Delete selected blocks or edges |
| Shift+L | Auto-layout canvas |
| Mod+Shift+F | Fit to view |
| Mod+Shift+Enter | Accept Copilot changes |

### Panel Navigation
| Shortcut | Action |
|----------|--------|
| Mod+F | Open workflow search and replace |
| Mod+Alt+F | Focus Toolbar search |

### Global Navigation
| Shortcut | Action |
|----------|--------|
| Mod+K | Open search |
| Mod+Shift+A | Add new agent workflow |
| Mod+Shift+P | Create workflow |
| Mod+B | Toggle sidebar |
| Mod+L | Go to logs |

### Utility
| Shortcut | Action |
|----------|--------|
| Mod+D | Clear terminal console |

### Mouse Controls
| Action | Control |
|--------|---------|
| Pan/move canvas | Left-drag on empty space (hand mode, the default), middle-drag, scroll, or trackpad |
| Select multiple blocks | Shift+drag to draw a selection box. In cursor mode, left-drag on empty space draws it instead |
| Drag block | Left-drag on block header |
| Add to selection | Mod+Click or Shift+Click on blocks |

## Quick Reference — Workspaces
| Action | How |
|--------|-----|
| Create workspace | Click workspace dropdown → New Workspace |
| Switch workspaces | Click workspace dropdown → Select workspace |
| Invite teammates | Sidebar → Invite |
| Rename/Duplicate/Export/Delete workspace | Right-click workspace → action |

## Quick Reference — Workflows
| Action | How |
|--------|-----|
| Create workflow | Click + button in sidebar |
| Reorder/move workflows | Drag workflow up/down or onto a folder |
| Import workflow | Click import button in sidebar → Select file |
| Multi-select workflows | Mod+Click or Shift+Click workflows in sidebar |
| Open in new tab | Right-click workflow → Open in New Tab |
| Rename/Duplicate/Export/Delete | Right-click workflow → action |

## Quick Reference — Blocks
| Action | How |
|--------|-----|
| Add a block | Drag from Toolbar panel, or right-click canvas → Add Block |
| Multi-select blocks | Mod+Click or Shift+Click additional blocks, or Shift+drag a selection box |
| Copy/Paste blocks | Mod+C / Mod+V |
| Duplicate/Delete blocks | Right-click → action |
| Rename a block | Click block name in header |
| Enable/Disable block | Right-click → Enable/Disable |
| Lock/Unlock block | Hover block → Click lock icon (Admin only) |
| Toggle handle orientation | Right-click → Toggle Handles |
| Open a block in the Editor panel | Right-click → Open Editor |
| Move a block out of a loop/parallel | Right-click → Remove from Subflow |
| Configure a block | Select block → use Editor panel on right |

## Quick Reference — Connections
| Action | How |
|--------|-----|
| Create connection | Drag from output handle to input handle |
| Delete connection | Click edge to select → Delete key |
| Use output in another block | Drag connection tag into input field |

## Quick Reference — Running & Testing
| Action | How |
|--------|-----|
| Run workflow | Click Run Workflow button or Mod+Enter |
| Stop workflow | Click Stop button or Mod+Enter while running |
| Test with chat | Use Chat panel on the right side |
| Run from block | Hover block → Click play button, or right-click → Run from block |
| Run until block | Right-click block → Run until block |
| View execution logs | Open terminal panel at bottom, or Mod+L |
| Filter/Search/Copy/Clear logs | Terminal panel controls |

## Quick Reference — Deployment
| Action | How |
|--------|-----|
| Deploy workflow | Click Deploy button in panel |
| Update deployment | Click Update when changes are detected |
| Revert deployment | Previous versions in Deploy tab → Promote to live |
| Copy API endpoint | Deploy tab → API → Copy API cURL |

## Quick Reference — Variables
| Action | How |
|--------|-----|
| Add/Edit/Delete workflow variable | Panel → Variables → Add Variable |
| Add environment variable | Settings → Environment Variables → Add |
| Reference workflow variable | Use <variable.variableName> syntax |
| Reference environment variable | Use {{ENV_VAR}} syntax |
`
