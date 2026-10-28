import { describe, expect, it } from 'vitest'
import { planeListLabelsTool } from '@/tools/plane/list_labels'
import { planeListProjectPagesTool } from '@/tools/plane/list_project_pages'

const user = {
  id: 'user-id',
  first_name: 'Test',
  last_name: 'User',
  email: 'user@example.com',
  avatar: null,
  avatar_url: null,
  display_name: 'Test User',
}

const relations = [
  { field: 'created_by', expanded: user },
  { field: 'updated_by', expanded: user },
  { field: 'workspace', expanded: { id: 'workspace-id', name: 'Test', slug: 'test' } },
  {
    field: 'project',
    expanded: {
      id: 'project-id',
      identifier: 'TEST',
      name: 'Test project',
      cover_image: null,
      icon_prop: {},
      emoji: null,
      description: '',
      cover_image_url: null,
      archived_at: null,
    },
  },
  { field: 'parent', expanded: { id: 'parent-id', project_id: 'project-id' } },
]

const params = {
  apiKey: 'fixture-key',
  apiVersion: 'v1' as const,
  workspace_slug: 'test',
  project_id: 'project-id',
}

describe('Plane compatibility relation projection', () => {
  it.each(relations)(
    'preserves expanded and scalar label $field values',
    async ({ field, expanded }) => {
      const rows = [
        { id: 'expanded-label', name: 'Expanded', [field]: expanded },
        { id: 'scalar-label', name: 'Scalar', [field]: expanded.id },
        { id: 'null-label', name: 'Null', [field]: null },
      ]
      const result = await planeListLabelsTool.transformResponse?.(
        Response.json({ results: rows, next_page_results: false }),
        params
      )
      expect(result?.output).toMatchObject({ results: rows })
    }
  )

  it('preserves page parents, including nested provider content and scalar IDs', async () => {
    const parent = {
      id: 'parent-id',
      name: 'Parent',
      logo_props: { in_use: 'emoji', emoji: '1f4dd' },
    }
    const rows = [
      { id: 'child-id', name: 'Child', parent_id: 'parent-id', parent },
      { id: 'legacy-id', name: 'Legacy', parent: 'parent-id' },
      { id: 'root-id', name: 'Root', parent: null },
    ]
    const result = await planeListProjectPagesTool.transformResponse?.(
      Response.json({ results: rows, next_page_results: false }),
      params
    )
    expect(result?.output).toMatchObject({ results: rows })
  })

  it('preserves expanded page owner details alongside nullable and scalar owners', async () => {
    const rows = [
      { id: 'expanded-page', name: 'Expanded', owned_by: user },
      { id: 'scalar-page', name: 'Scalar', owned_by: user.id },
      { id: 'null-page', name: 'Null', owned_by: null },
    ]
    const result = await planeListProjectPagesTool.transformResponse?.(
      Response.json({ results: rows, next_page_results: false }),
      params
    )
    expect(result?.output).toMatchObject({ results: rows })
  })
})
