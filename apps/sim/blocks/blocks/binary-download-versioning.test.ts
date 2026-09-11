import { describe, expect, it } from 'vitest'
import { BoxBlock, BoxV2Block } from '@/blocks/blocks/box'
import { DropboxBlock, DropboxV2Block } from '@/blocks/blocks/dropbox'
import { DubBlock, DubV2Block } from '@/blocks/blocks/dub'
import {
  MicrosoftDataverseBlock,
  MicrosoftDataverseV2Block,
} from '@/blocks/blocks/microsoft_dataverse'
import { ServiceNowBlock, ServiceNowV2Block } from '@/blocks/blocks/servicenow'
import type { BlockConfig } from '@/blocks/types'

const cases: {
  legacy: BlockConfig
  current: BlockConfig
  operation: string
  toolId: string
  content: string
}[] = [
  {
    legacy: BoxBlock,
    current: BoxV2Block,
    operation: 'download_file',
    toolId: 'box_download_file',
    content: 'content',
  },
  {
    legacy: DropboxBlock,
    current: DropboxV2Block,
    operation: 'dropbox_download',
    toolId: 'dropbox_download',
    content: 'content',
  },
  {
    legacy: DubBlock,
    current: DubV2Block,
    operation: 'get_qr_code',
    toolId: 'dub_get_qr_code',
    content: 'content',
  },
  {
    legacy: MicrosoftDataverseBlock,
    current: MicrosoftDataverseV2Block,
    operation: 'download_file',
    toolId: 'microsoft_dataverse_download_file',
    content: 'fileContent',
  },
  {
    legacy: ServiceNowBlock,
    current: ServiceNowV2Block,
    operation: 'servicenow_download_attachment',
    toolId: 'servicenow_download_attachment',
    content: 'content',
  },
]

describe.each(cases)(
  '$current.type download versioning',
  ({ legacy, current, operation, toolId, content }) => {
    it('preserves saved blocks and changes only the download tool for new blocks', () => {
      expect(legacy.hideFromToolbar).toBe(true)
      expect(legacy.sunset).toEqual({ status: 'legacy', replacedBy: current.type })
      expect(current.hideFromToolbar).toBe(false)
      expect(current.sunset).toBeUndefined()
      expect(current.subBlocks).toBe(legacy.subBlocks)
      expect(current.tools.config?.params).toBe(legacy.tools.config?.params)
      expect(legacy.tools.config?.tool({ operation })).toBe(toolId)
      expect(current.tools.config?.tool({ operation })).toBe(`${toolId}_v2`)
      expect(current.tools.access).toEqual(
        legacy.tools.access.map((id) => (id === toolId ? `${id}_v2` : id))
      )
    })

    it('removes the download content output while preserving unrelated outputs', () => {
      expect(legacy.outputs).toHaveProperty(content)
      if (current.type === 'servicenow_v2') {
        expect(current.outputs.content).toEqual({
          type: 'string',
          description: 'HTML body of a knowledge article',
        })
      } else {
        expect(current.outputs).not.toHaveProperty(content)
      }
      expect(current.outputs.file).toEqual(legacy.outputs.file)
    })
  }
)
