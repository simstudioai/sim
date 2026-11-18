import { describe, expect, it } from 'vitest'
import { generateTool } from '@/tools/gamma/generate'
import { generateFromTemplateTool } from '@/tools/gamma/generate_from_template'

describe('Gamma folder', () => {
  it('sends one folder as folderId, not the deprecated folderIds array', () => {
    const body = generateTool.request.body?.({
      apiKey: 'key',
      inputText: 'Quarterly review',
      textMode: 'generate',
      folderIds: ' folder_1 ',
    })
    expect(body).toMatchObject({ folderId: 'folder_1' })
    expect(body).not.toHaveProperty('folderIds')
  })

  it('rejects more than one folder ID', () => {
    expect(() =>
      generateFromTemplateTool.request.body?.({
        apiKey: 'key',
        gammaId: 'g_1',
        prompt: 'Refresh',
        folderIds: 'folder_1, folder_2',
      })
    ).toThrow('Gamma accepts one folder ID')
  })
})
