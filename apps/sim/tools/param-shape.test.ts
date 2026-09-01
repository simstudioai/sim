/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildJsonSchemaParamShapes,
  buildSubBlockForToolParam,
  buildSubBlocksFromJsonSchema,
  buildToolParamShapes,
  decodeToolParams,
  decodeToolParamValue,
  encodeToolParamValue,
  expandSubBlockValueToParams,
  getJsonSchemaValueShape,
  getSubBlockValueShape,
  getToolParamValueShape,
  subBlockTypeForValueType,
  type ToolParamValueShape,
} from '@/tools/param-shape'

const ALL_SHAPES: ToolParamValueShape[] = ['string', 'number', 'boolean', 'json']

describe('subBlockTypeForValueType', () => {
  it.each([
    ['string', 'short-input'],
    ['any', 'short-input'],
    ['number', 'short-input'],
    ['boolean', 'switch'],
    ['json', 'code'],
    ['array', 'code'],
    ['object', 'code'],
    ['file', 'file-upload'],
    ['file[]', 'file-upload'],
  ])('maps %s to %s', (paramType, expected) => {
    expect(subBlockTypeForValueType(paramType)).toBe(expected)
  })

  it('falls back to a text field for an unrecognized declaration', () => {
    expect(subBlockTypeForValueType('something-new')).toBe('short-input')
    expect(subBlockTypeForValueType(undefined)).toBe('short-input')
  })

  it('never synthesizes a control whose required config a tool param cannot supply', () => {
    const synthesized = ['string', 'number', 'boolean', 'json', 'array', 'object', 'file', 'file[]']
      .map(subBlockTypeForValueType)
      .filter((type, index, all) => all.indexOf(type) === index)

    // A slider needs min/max and a dropdown needs options; neither exists on a
    // ToolConfig param, so a bounded control must never be produced from one.
    expect(synthesized).not.toContain('slider')
    expect(synthesized).not.toContain('dropdown')
  })
})

describe('getSubBlockValueShape', () => {
  it.each([
    ['switch', 'boolean'],
    ['slider', 'number'],
    ['file-upload', 'json'],
    ['table', 'json'],
    ['checkbox-list', 'json'],
    ['grouped-checkbox-list', 'json'],
    ['short-input', 'string'],
    ['dropdown', 'string'],
    ['code', 'string'],
  ] as const)('reports %s as %s', (type, expected) => {
    expect(getSubBlockValueShape({ type })).toBe(expected)
  })

  it('treats any multiSelect control as an array', () => {
    expect(getSubBlockValueShape({ type: 'dropdown', multiSelect: true })).toBe('json')
  })

  it('treats a checkbox-list as the record of selections it now stores', () => {
    expect(getSubBlockValueShape({ type: 'checkbox-list' })).toBe('json')
  })
})

describe('decodeToolParamValue', () => {
  it('leaves an already-typed value untouched for every shape', () => {
    const typed = [false, true, 0, 42, [], {}, null, undefined]
    for (const shape of ALL_SHAPES) {
      for (const value of typed) {
        expect(decodeToolParamValue(value, shape)).toBe(value)
      }
    }
  })

  it('is idempotent', () => {
    const inputs = ['', 'false', 'true', '0', '5', 'yes', '[1,2]', '{"a":1}', 'null', '{bad']
    for (const shape of ALL_SHAPES) {
      for (const raw of inputs) {
        const once = decodeToolParamValue(raw, shape)
        expect(decodeToolParamValue(once, shape)).toEqual(once)
      }
    }
  })

  it("preserves '' as the untouched-field sentinel for every shape", () => {
    for (const shape of ALL_SHAPES) {
      expect(decodeToolParamValue('', shape)).toBe('')
    }
  })

  it('never modifies a string-shaped value', () => {
    for (const raw of ['false', '0', '[1,2]', '{"a":1}', 'anything']) {
      expect(decodeToolParamValue(raw, 'string')).toBe(raw)
    }
  })

  it.each([
    ['true', true],
    ['True', true],
    ['  FALSE  ', false],
    ['false', false],
  ])('decodes the boolean token %s', (raw, expected) => {
    expect(decodeToolParamValue(raw, 'boolean')).toBe(expected)
  })

  it('leaves a boolean token the encoder never produces as a string', () => {
    for (const raw of ['yes', 'on', '1', '0', '<start.flag>', '{{FLAG}}']) {
      expect(decodeToolParamValue(raw, 'boolean')).toBe(raw)
    }
  })

  it.each([
    ['5', 5],
    ['  7 ', 7],
    ['0', 0],
    ['-1.5', -1.5],
    ['1e3', 1000],
  ])('decodes the number %s', (raw, expected) => {
    expect(decodeToolParamValue(raw, 'number')).toBe(expected)
  })

  it('never produces NaN', () => {
    for (const raw of ['abc', '<start.count>', '{{LIMIT}}', '1,2']) {
      expect(decodeToolParamValue(raw, 'number')).toBe(raw)
    }
  })

  it('decodes json only when it parses to an object or array', () => {
    expect(decodeToolParamValue('[1,2]', 'json')).toEqual([1, 2])
    expect(decodeToolParamValue('{"a":1}', 'json')).toEqual({ a: 1 })
    for (const raw of ['5', 'true', 'null', '"text"', '{bad', '<start.body>']) {
      expect(decodeToolParamValue(raw, 'json')).toBe(raw)
    }
  })

  it('never throws', () => {
    const hostile: unknown[] = ['{bad', Symbol('x'), Number.NaN, () => {}, new Date(0)]
    for (const shape of ALL_SHAPES) {
      for (const value of hostile) {
        expect(() => decodeToolParamValue(value, shape)).not.toThrow()
      }
    }
  })

  it('round-trips every sub-block value shape through the encoder', () => {
    const cases: Array<[{ type: string; multiSelect?: boolean }, unknown]> = [
      [{ type: 'switch' }, false],
      [{ type: 'switch' }, true],
      [{ type: 'slider' }, 0],
      [{ type: 'file-upload' }, [{ name: 'a.txt', key: 'k' }]],
      [{ type: 'table' }, [{ cells: { Key: 'k' } }]],
      [{ type: 'dropdown', multiSelect: true }, ['a', 'b']],
      [{ type: 'short-input' }, 'plain'],
    ]

    for (const [subBlock, value] of cases) {
      const shape = getSubBlockValueShape(subBlock as { type: never })
      expect(decodeToolParamValue(encodeToolParamValue(value), shape)).toEqual(value)
    }
  })
})

describe('buildToolParamShapes', () => {
  it('lets the sub-block win over the tool declaration', () => {
    // Jira's `deleteSubtasks`: a dropdown of 'true'/'false' backing a boolean param,
    // whose block `params` function compares it with `=== 'true'`. Decoding it to a
    // real boolean would silently invert the flag.
    const shapes = buildToolParamShapes([{ id: 'deleteSubtasks', type: 'dropdown' }], {
      deleteSubtasks: { type: 'boolean' },
    })
    expect(shapes.get('deleteSubtasks')).toBe('string')
  })

  it('uses the declared type when no sub-block collects the param', () => {
    const shapes = buildToolParamShapes([], { includeAttachments: { type: 'boolean' } })
    expect(shapes.get('includeAttachments')).toBe('boolean')
  })

  it('resolves a canonical id to the shape of the sub-block that collects it', () => {
    const shapes = buildToolParamShapes(
      [
        { id: 'toggleBasic', type: 'switch', canonicalParamId: 'flag' },
        { id: 'toggleAdvanced', type: 'short-input', canonicalParamId: 'flag' },
      ],
      { flag: { type: 'boolean' } }
    )
    expect(shapes.get('flag')).toBe('boolean')
  })

  it('prefers json when a canonical pair encodes two different ways', () => {
    // A file pair: an uploaded descriptor array on one side, a bare reference string
    // on the other. `json` handles both, because it keeps a non-object untouched.
    const shapes = buildToolParamShapes(
      [
        { id: 'attachmentFiles', type: 'file-upload', canonicalParamId: 'files' },
        { id: 'fileReferences', type: 'short-input', canonicalParamId: 'files' },
      ],
      { files: { type: 'file[]' } }
    )
    expect(shapes.get('files')).toBe('json')
    expect(decodeToolParamValue('file_abc123', 'json')).toBe('file_abc123')
  })

  it('shapes a sub-block the tool does not declare, since its params fn still reads it', () => {
    const shapes = buildToolParamShapes([{ id: 'notifyToggle', type: 'switch' }], {})
    expect(shapes.get('notifyToggle')).toBe('boolean')
  })
})

describe('decodeToolParams', () => {
  it('decodes only the keys it has a shape for', () => {
    const shapes = buildToolParamShapes([], {
      flag: { type: 'boolean' },
      count: { type: 'number' },
      body: { type: 'json' },
      name: { type: 'string' },
    })

    expect(
      decodeToolParams(
        { flag: 'false', count: '3', body: '{"a":1}', name: 'false', unknown: 'false' },
        shapes
      )
    ).toEqual({ flag: false, count: 3, body: { a: 1 }, name: 'false', unknown: 'false' })
  })
})

describe('getToolParamValueShape', () => {
  it.each([
    ['boolean', 'boolean'],
    ['number', 'number'],
    ['json', 'json'],
    ['array', 'json'],
    ['object', 'json'],
    ['file', 'json'],
    ['file[]', 'json'],
    ['string', 'string'],
    ['any', 'string'],
    [undefined, 'string'],
  ])('maps %s to %s', (paramType, expected) => {
    expect(getToolParamValueShape(paramType)).toBe(expected)
  })
})

describe('buildSubBlockForToolParam', () => {
  it('carries the param description as the placeholder on a text field', () => {
    const subBlock = buildSubBlockForToolParam(
      'issueKey',
      { type: 'string', required: true, visibility: 'user-or-llm', description: 'e.g. PROJ-123' },
      'Issue Key',
      false
    )
    expect(subBlock).toMatchObject({
      id: 'issueKey',
      title: 'Issue Key',
      type: 'short-input',
      required: true,
      paramVisibility: 'user-or-llm',
      placeholder: 'e.g. PROJ-123',
    })
  })

  it('marks a credential-shaped param as a password field', () => {
    expect(buildSubBlockForToolParam('apiKey', { type: 'string' }, 'API Key', true).password).toBe(
      true
    )
  })

  it('never sets password on a control that would silently ignore it', () => {
    expect(
      buildSubBlockForToolParam('secretPayload', { type: 'json' }, 'Secret Payload', true).password
    ).toBeUndefined()
  })

  it('defaults visibility the same way the registry does', () => {
    expect(
      buildSubBlockForToolParam('a', { type: 'string', required: true }, 'A', false)
    ).toMatchObject({ paramVisibility: 'user-or-llm' })
    expect(buildSubBlockForToolParam('b', { type: 'string' }, 'B', false)).toMatchObject({
      paramVisibility: 'user-only',
    })
  })

  it('configures a file field for one or many', () => {
    expect(buildSubBlockForToolParam('f', { type: 'file' }, 'F', false)).toMatchObject({
      type: 'file-upload',
      multiple: false,
      acceptedTypes: '*',
    })
    expect(buildSubBlockForToolParam('f', { type: 'file[]' }, 'F', false).multiple).toBe(true)
  })

  it('never carries a condition, so a synthesized field renders unconditionally', () => {
    expect(buildSubBlockForToolParam('a', { type: 'string' }, 'A', false).condition).toBeUndefined()
  })
})

describe('buildSubBlocksFromJsonSchema', () => {
  const identity = (id: string) => id

  it('uses the constraints a JSON Schema carries and a tool param cannot', () => {
    const subBlocks = buildSubBlocksFromJsonSchema(
      {
        properties: {
          flag: { type: 'boolean' },
          mode: { type: 'string', enum: ['fast', 'slow'] },
          bounded: { type: 'integer', minimum: 1, maximum: 10 },
          unbounded: { type: 'number' },
          body: { type: 'object' },
          note: { type: 'string', maxLength: 500 },
          name: { type: 'string' },
        },
        required: ['flag'],
      },
      identity
    )
    const byId = new Map(subBlocks.map((sb) => [sb.id, sb]))

    expect(byId.get('flag')).toMatchObject({ type: 'switch', paramVisibility: 'user-or-llm' })
    expect(byId.get('mode')).toMatchObject({
      type: 'dropdown',
      options: [
        { label: 'fast', id: 'fast' },
        { label: 'slow', id: 'slow' },
      ],
    })
    expect(byId.get('bounded')).toMatchObject({ type: 'slider', min: 1, max: 10, integer: true })
    expect(byId.get('unbounded')).toMatchObject({ type: 'short-input' })
    expect(byId.get('body')).toMatchObject({ type: 'code', language: 'json' })
    expect(byId.get('note')).toMatchObject({ type: 'long-input' })
    expect(byId.get('name')).toMatchObject({ type: 'short-input', paramVisibility: 'user-only' })
  })

  it('tolerates a nullable union type', () => {
    const [subBlock] = buildSubBlocksFromJsonSchema(
      { properties: { flag: { type: ['boolean', 'null'] } } },
      identity
    )
    expect(subBlock.type).toBe('switch')
  })

  it('tolerates a schema an MCP server sent with the wrong shapes', () => {
    expect(() =>
      buildSubBlocksFromJsonSchema(
        {
          properties: { a: null, b: 'nope', c: { type: 5, minimum: 'x' } } as never,
          required: 'all' as never,
        },
        identity
      )
    ).not.toThrow()
  })

  it('returns nothing for a schema with no properties', () => {
    expect(buildSubBlocksFromJsonSchema(undefined, identity)).toEqual([])
    expect(buildSubBlocksFromJsonSchema({}, identity)).toEqual([])
  })

  it('decodes a scalar as its control stores it, and a structured value as JSON', () => {
    const schema = {
      properties: { flag: { type: 'boolean' }, body: { type: 'object' }, name: { type: 'string' } },
    }
    const shapes = buildJsonSchemaParamShapes(schema)
    const byId = new Map(buildSubBlocksFromJsonSchema(schema, identity).map((sb) => [sb.id, sb]))

    // A scalar control writes its own type, so the two agree.
    for (const paramId of ['flag', 'name']) {
      expect(getSubBlockValueShape(byId.get(paramId)!)).toBe(shapes.get(paramId))
    }

    // A structured value deliberately does NOT: it renders in a code editor, whose store
    // value is the raw JSON text, but the tool needs it parsed. Deriving the shape from
    // the control here is what left MCP object args undecoded.
    expect(byId.get('body')!.type).toBe('code')
    expect(getSubBlockValueShape(byId.get('body')!)).toBe('string')
    expect(shapes.get('body')).toBe('json')
  })
})

describe('expandSubBlockValueToParams', () => {
  const options = [
    { label: 'Gather Links', id: 'gatherLinks' },
    { label: 'No Cache', id: 'noCache' },
    { label: 'Include Values', id: 'includeValues', defaultChecked: true },
  ]
  const subBlock = { type: 'checkbox-list' as const, options }

  it('projects a checkbox-list onto one param per option', () => {
    expect(expandSubBlockValueToParams(subBlock, { gatherLinks: true, noCache: false })).toEqual({
      gatherLinks: true,
      noCache: false,
      includeValues: true,
    })
  })

  it('omits an untouched option rather than sending false', () => {
    // Asana un-completes a task on an explicit `false`, so "never touched" has to stay
    // absent. Only an option declaring a default is sent without user input.
    expect(expandSubBlockValueToParams(subBlock, null)).toEqual({ includeValues: true })
    expect(expandSubBlockValueToParams(subBlock, {})).toEqual({ includeValues: true })
  })

  it('lets an explicit choice override a declared default', () => {
    expect(expandSubBlockValueToParams(subBlock, { includeValues: false })).toEqual({
      includeValues: false,
    })
  })

  it('never emits an option the block does not declare', () => {
    expect(
      expandSubBlockValueToParams(subBlock, { gatherLinks: true, staleOption: true })
    ).not.toHaveProperty('staleOption')
  })

  it('returns null for every other sub-block type, leaving one-key behavior alone', () => {
    for (const type of ['short-input', 'switch', 'table', 'file-upload', 'dropdown'] as const) {
      expect(expandSubBlockValueToParams({ type, options: undefined }, 'x')).toBeNull()
    }
  })

  it('tolerates a malformed stored value', () => {
    for (const value of ['nonsense', 42, [], undefined]) {
      expect(() => expandSubBlockValueToParams(subBlock, value)).not.toThrow()
    }
  })
})

describe('decodeToolParams with a checkbox-list', () => {
  const checkboxSubBlock = {
    id: 'readUrlOptions',
    type: 'checkbox-list' as const,
    options: [
      { label: 'Gather Links', id: 'gatherLinks' },
      { label: 'No Cache', id: 'noCache' },
    ],
  }

  it('decodes the stringified record and expands it onto the tool params', () => {
    const shapes = buildToolParamShapes([checkboxSubBlock], {
      gatherLinks: { type: 'boolean' },
      noCache: { type: 'boolean' },
    })

    expect(
      decodeToolParams({ readUrlOptions: '{"gatherLinks":true,"noCache":false}' }, shapes, [
        checkboxSubBlock,
      ])
    ).toEqual({ gatherLinks: true, noCache: false })
  })

  it('drops the container key, which no tool declares', () => {
    const shapes = buildToolParamShapes([checkboxSubBlock], {})
    const result = decodeToolParams({ readUrlOptions: '{"gatherLinks":true}' }, shapes, [
      checkboxSubBlock,
    ])
    expect(result).not.toHaveProperty('readUrlOptions')
  })
})

describe('buildJsonSchemaParamShapes', () => {
  it('reads the shape from the schema, not the control it renders as', () => {
    // An `object` renders in a code editor whose store value is raw JSON text, so
    // asking the control would answer 'string' and the MCP server would be handed
    // undecoded text.
    const shapes = buildJsonSchemaParamShapes({
      properties: {
        obj: { type: 'object' },
        arr: { type: 'array' },
        flag: { type: 'boolean' },
        count: { type: 'integer' },
        name: { type: 'string' },
      },
    })

    expect(Object.fromEntries(shapes)).toEqual({
      obj: 'json',
      arr: 'json',
      flag: 'boolean',
      count: 'number',
      name: 'string',
    })
  })

  it('normalizes a nullable union the same way the control does', () => {
    const schema = {
      properties: {
        nullableObj: { type: ['object', 'null'] },
        nullableInt: { type: ['integer', 'null'], minimum: 1, maximum: 10 },
      },
    }
    const shapes = buildJsonSchemaParamShapes(schema)
    const controls = new Map(
      buildSubBlocksFromJsonSchema(schema, (id) => id).map((sb) => [sb.id, sb.type])
    )

    expect(shapes.get('nullableObj')).toBe('json')
    expect(controls.get('nullableObj')).toBe('code')
    expect(shapes.get('nullableInt')).toBe('number')
    expect(controls.get('nullableInt')).toBe('slider')
  })

  it('reads an enum from its declared type before its members', () => {
    // A dropdown stores `String(option)`, so a numeric enum read as text would send
    // '1' where the server expects 1.
    const shapes = buildJsonSchemaParamShapes({
      properties: {
        declaredInt: { type: 'integer', enum: [1, 2, 3] },
        declaredBool: { type: 'boolean', enum: [true, false] },
        declaredStr: { type: 'string', enum: ['a', 'b'] },
      },
    })

    expect(shapes.get('declaredInt')).toBe('number')
    expect(shapes.get('declaredBool')).toBe('boolean')
    expect(shapes.get('declaredStr')).toBe('string')
  })

  it('infers an untyped enum from its members', () => {
    const shapes = buildJsonSchemaParamShapes({
      properties: {
        nums: { enum: [1, 2] },
        bools: { enum: [true, false] },
        strs: { enum: ['x', 'y'] },
        structured: { enum: [{ a: 1 }] },
        mixed: { enum: [1, 'x'] },
        // `every` is vacuously true on an empty enum — this must not read as numeric.
        empty: { enum: [] },
      },
    })

    expect(shapes.get('nums')).toBe('number')
    expect(shapes.get('bools')).toBe('boolean')
    expect(shapes.get('strs')).toBe('string')
    expect(shapes.get('structured')).toBe('json')
    expect(shapes.get('mixed')).toBe('string')
    expect(shapes.get('empty')).toBe('string')
  })

  it('round-trips a numeric enum through the dropdown it renders as', () => {
    const property = { type: 'integer', enum: [1, 2, 3] }
    const [subBlock] = buildSubBlocksFromJsonSchema({ properties: { n: property } }, (id) => id)

    expect(subBlock.type).toBe('dropdown')
    // The dropdown stores the stringified member; the shape decodes it back.
    expect(decodeToolParamValue('2', getJsonSchemaValueShape(property))).toBe(2)
  })

  it('normalizes a legacy string left by a control that has since changed type', () => {
    // A union-typed property used to render as a text field and now renders as a switch;
    // its stored 'false' must not tick the box.
    expect(
      decodeToolParamValue('false', getJsonSchemaValueShape({ type: ['boolean', 'null'] }))
    ).toBe(false)
    expect(decodeToolParamValue(true, getJsonSchemaValueShape({ type: 'boolean' }))).toBe(true)
  })
})

describe('enum members that are not plain strings', () => {
  it('keeps a nullable enum as text so a real null member survives the decode', () => {
    const shape = getJsonSchemaValueShape({ enum: ['a', null] })

    expect(shape).toBe('string')
    // The dropdown persists the member itself, so `null` arrives already typed and the
    // decode must not touch it.
    expect(decodeToolParamValue(null, shape)).toBeNull()
  })

  it('decodes a numeric enum member that is still stored as its stringified form', () => {
    expect(
      decodeToolParamValue('1', getJsonSchemaValueShape({ type: 'integer', enum: [1, 2] }))
    ).toBe(1)
  })
})
