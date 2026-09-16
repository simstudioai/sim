import { describe, expect, it } from 'vitest'
import {
  RESOURCE_HEADER_CLASSES,
  resourceTabWidthClass,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-tabs/resource-tab-controls'

describe('resource header geometry', () => {
  it('moves the action cluster beside the collapse target without moving the toggle', () => {
    expect(RESOURCE_HEADER_CLASSES.layout).toContain('[--resource-header-end-inset:16px]')
    expect(RESOURCE_HEADER_CLASSES.layout).toContain('[--resource-header-fixed-reserve:52px]')
    expect(RESOURCE_HEADER_CLASSES.layout).toContain('[--resource-header-toggle-hit-size:40px]')
    expect(RESOURCE_HEADER_CLASSES.layout).toContain('[--resource-header-toggle-size:30px]')
    expect(RESOURCE_HEADER_CLASSES.endPosition).toBe('right-[var(--resource-header-end-inset)]')
  })

  it('tightens the title cap one small step per added tab down to the floor', () => {
    expect(RESOURCE_HEADER_CLASSES.stripGeometry).not.toContain('--tab-strip-max-tab-width')
    expect(resourceTabWidthClass(1)).toBe('[--tab-strip-max-tab-width:200px]')
    expect(resourceTabWidthClass(2)).toBe('[--tab-strip-max-tab-width:200px]')
    expect(resourceTabWidthClass(3)).toBe('[--tab-strip-max-tab-width:180px]')
    expect(resourceTabWidthClass(4)).toBe('[--tab-strip-max-tab-width:160px]')
    expect(resourceTabWidthClass(9)).toBe('[--tab-strip-max-tab-width:160px]')
  })
})
