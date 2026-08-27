/**
 * @vitest-environment node
 */
import { spawnSync } from 'node:child_process'
import { hasPython3, PYTHON_SKIP_REASON } from '@sim/testing/environment'
import { afterEach, describe, expect, it } from 'vitest'
import {
  analyzeCodePlaceholders,
  type CodePlaceholderRuntimeBinding,
  compileCodePlaceholders,
} from '@/lib/execution/code-placeholders'
import { CodeLanguage } from '@/lib/execution/languages'

const installedGlobals = new Set<string>()

async function executeJavaScript(
  code: string,
  bindings: ReadonlyArray<{ name: string; value: string }>,
  runtimeBindings: readonly CodePlaceholderRuntimeBinding[] = []
): Promise<unknown> {
  for (const binding of bindings) {
    Object.defineProperty(globalThis, binding.name, {
      configurable: true,
      value: binding.value,
      writable: true,
    })
    installedGlobals.add(binding.name)
  }
  for (const binding of runtimeBindings) {
    const templateObjects: unknown[] = []
    const value = Object.freeze({
      RegExp,
      freeze: Object.freeze.bind(Object),
      defineProperty: Object.defineProperty.bind(Object),
      template: (index: number, create: () => unknown) =>
        templateObjects[index] ?? (templateObjects[index] = create()),
    })
    Object.defineProperty(globalThis, binding.name, {
      configurable: true,
      value,
      writable: false,
    })
    installedGlobals.add(binding.name)
  }
  return new Function(`return (async () => {\n${code}\n})()`)()
}

function executeShell(
  code: string,
  bindings: ReadonlyArray<{ name: string; value: string }>
): string {
  const result = spawnSync('/bin/bash', ['-c', code], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...Object.fromEntries(bindings.map(({ name, value }) => [name, value])),
    },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout
}

function executePython(
  code: string,
  bindings: ReadonlyArray<{ name: string; value: string }>
): string {
  const prologue = [
    'import os as _sim_test_os',
    ...bindings.map(({ name }) => `${name} = _sim_test_os.environ[${JSON.stringify(name)}]`),
  ].join('\n')
  const result = spawnSync('python3', ['-c', `${prologue}\n${code}`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...Object.fromEntries(bindings.map(({ name, value }) => [name, value])),
    },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout
}

afterEach(() => {
  for (const name of installedGlobals) Reflect.deleteProperty(globalThis, name)
  installedGlobals.clear()
})

describe('code placeholder compiler', () => {
  it('preserves bare, quoted, embedded, template, string types, and one-pass JavaScript values', async () => {
    const value = 'a"\\\n{{OTHER}}'
    const compiled = await compileCodePlaceholders({
      code: [
        'const bare = {{KEY}}',
        'const quoted = "{{KEY}}"',
        'const embedded = "Bearer {{KEY}}"',
        'const template = `Token {{KEY}}`',
        'return { bare, quoted, embedded, template, numeric: {{NUM}}, boolean: {{BOOL}} }',
      ].join('\n'),
      language: CodeLanguage.JavaScript,
      environmentVariables: { KEY: value, NUM: '123', BOOL: 'true', OTHER: 'must-not-resolve' },
    })

    expect(compiled.code).not.toContain(value)
    expect(compiled.code).not.toContain('__var_')
    expect(compiled.resolvedSecretNames).toEqual(['KEY', 'NUM', 'BOOL'])
    await expect(
      executeJavaScript(compiled.code, compiled.bindings, compiled.runtimeBindings)
    ).resolves.toEqual({
      bare: value,
      quoted: value,
      embedded: `Bearer ${value}`,
      template: `Token ${value}`,
      numeric: '123',
      boolean: 'true',
    })
  })

  it('compiles JavaScript regex literals without escaping the bound pattern', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        'const RegExp = null',
        'const matcher = /^{{PATTERN}}$/im',
        'return [matcher.flags, matcher.test("aZZb")]',
      ].join('\n'),
      language: CodeLanguage.JavaScript,
      environmentVariables: { PATTERN: 'a.+b' },
    })

    expect(compiled.runtimeBindings).toEqual([
      expect.objectContaining({ kind: 'javascript-runtime' }),
    ])
    expect(compiled.code).not.toContain('a.+b')
    await expect(
      executeJavaScript(compiled.code, compiled.bindings, compiled.runtimeBindings)
    ).resolves.toEqual(['im', true])
  })

  it('captures the JavaScript regex intrinsic before user code mutates its prototype', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        'const originalConstructor = RegExp.prototype.constructor',
        'RegExp.prototype.constructor = null',
        'try {',
        '  return /^{{PATTERN}}$/.test("secret")',
        '} finally {',
        '  RegExp.prototype.constructor = originalConstructor',
        '}',
      ].join('\n'),
      language: CodeLanguage.JavaScript,
      environmentVariables: { PATTERN: 'secret' },
    })

    await expect(
      executeJavaScript(compiled.code, compiled.bindings, compiled.runtimeBindings)
    ).resolves.toBe(true)
  })

  it('rejects resolved placeholders in a static import without exposing the value', async () => {
    const secret = 'must-not-appear-in-the-diagnostic'
    const error = await compileCodePlaceholders({
      code: 'import value from "{{MODULE}}"',
      language: CodeLanguage.JavaScript,
      environmentVariables: { MODULE: secret },
    }).catch((caught) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain('is not supported')
    expect(String(error)).not.toContain(secret)
  })

  it('preserves tagged-template cooked, raw, substitution, and receiver semantics', async () => {
    const secret = 'quote"\\\n{{OTHER}}'
    const compiled = await compileCodePlaceholders({
      code: [
        'let calls = 0',
        'const receiver = {',
        '  tag(strings, value) {',
        '    return {',
        '      cooked: [...strings],',
        '      raw: [...strings.raw],',
        '      value,',
        '      calls,',
        '      receiver: this === receiver,',
        '      frozen: ({}).constructor.isFrozen(strings) && ({}).constructor.isFrozen(strings.raw),',
        '    }',
        '  },',
        '}',
        'const Object = null',
        'return receiver.tag`line\\n{{KEY}}:$' + '{++calls}:\\x41{{KEY}}`',
      ].join('\n'),
      language: CodeLanguage.JavaScript,
      environmentVariables: { KEY: secret, OTHER: 'must-not-resolve' },
    })

    expect(compiled.code).not.toContain(secret)
    await expect(
      executeJavaScript(compiled.code, compiled.bindings, compiled.runtimeBindings)
    ).resolves.toEqual({
      cooked: [`line\n${secret}:`, `:A${secret}`],
      raw: [`line\\n${secret}:`, `:\\x41${secret}`],
      value: 1,
      calls: 1,
      receiver: true,
      frozen: true,
    })
  })

  it('round-trips source-sensitive string and tagged-template characters', async () => {
    const sourceText = `</script>${String.fromCharCode(0x2028, 0x2029)}`
    const secret = `secret"\\\n${sourceText}`
    const literalText = `before ${sourceText} {{KEY}} after`
    const compiled = await compileCodePlaceholders({
      code: [
        `const quoted = ${JSON.stringify(literalText)}`,
        'const tag = (strings) => ({ cooked: strings[0], raw: strings.raw[0] })',
        `const tagged = tag\`${literalText}\``,
        'return { quoted, tagged }',
      ].join('\n'),
      language: CodeLanguage.JavaScript,
      environmentVariables: { KEY: secret },
    })

    const expected = `before ${sourceText} ${secret} after`
    expect(compiled.code).toContain('\\u003c/script\\u003e')
    expect(compiled.code).toContain('\\u2028\\u2029')
    expect(compiled.code).not.toContain('</script>')
    expect(compiled.code).not.toContain(String.fromCharCode(0x2028))
    expect(compiled.code).not.toContain(String.fromCharCode(0x2029))
    expect(compiled.code).not.toContain(secret)
    await expect(
      executeJavaScript(compiled.code, compiled.bindings, compiled.runtimeBindings)
    ).resolves.toEqual({
      quoted: expected,
      tagged: { cooked: expected, raw: expected },
    })
  })

  it('leaves JavaScript comments and missing placeholders untouched', async () => {
    const code = [
      '// {{COMMENT}}',
      'const missing = "{{MISSING}}"',
      'const mixed = "{{MISSING}}/{{KEY}}"',
      'const reverseMixed = "{{KEY}}/{{LONG_MISSING}}"',
      'const template = `{{MISSING}}/{{KEY}}`',
      'return { key: {{KEY}}, mixed, reverseMixed, template }',
    ].join('\n')
    const compiled = await compileCodePlaceholders({
      code,
      language: CodeLanguage.JavaScript,
      environmentVariables: { COMMENT: 'hidden', KEY: 'ok' },
    })

    expect(compiled.code).toContain('// {{COMMENT}}')
    expect(compiled.code).toContain('"{{MISSING}}"')
    expect(compiled.resolvedSecretNames).toEqual(['KEY'])
    await expect(executeJavaScript(compiled.code, compiled.bindings)).resolves.toEqual({
      key: 'ok',
      mixed: '{{MISSING}}/ok',
      reverseMixed: 'ok/{{LONG_MISSING}}',
      template: '{{MISSING}}/ok',
    })
  })

  it('keeps opaque binding names collision-free and applies env-over-param precedence', async () => {
    const compiled = await compileCodePlaceholders({
      code: 'return [{{A-B}}, {{A_B}}, {{__proto__}}]',
      language: CodeLanguage.JavaScript,
      params: Object.fromEntries([
        ['A-B', 1],
        ['A_B', false],
        ['__proto__', 'param'],
      ]),
      environmentVariables: Object.fromEntries([
        ['A-B', 'env'],
        ['A_B', 'two'],
        ['__proto__', 'safe'],
      ]),
      reservedNames: ['__sim_code_0_binding_0'],
    })

    expect(new Set(compiled.bindings.map((binding) => binding.name)).size).toBe(3)
    expect(compiled.bindings.every((binding) => !binding.name.includes('A_B'))).toBe(true)
    await expect(executeJavaScript(compiled.code, compiled.bindings)).resolves.toEqual([
      'env',
      'two',
      'safe',
    ])
  })

  it('produces identical compiler artifacts for identical inputs', async () => {
    const input = {
      code: [
        'const existing = __sim_code_0_binding_0',
        'const quoted = "Bearer {{TOKEN}}"',
        'const matcher = /^{{PATTERN}}$/i',
        'return [existing, quoted, matcher.source, {{MISSING}}]',
      ].join('\n'),
      language: CodeLanguage.JavaScript,
      environmentVariables: { TOKEN: 'secret', PATTERN: 'a.+b' },
      reservedNames: ['__sim_code_1_runtime_0'],
    } as const

    const first = await compileCodePlaceholders(input)
    const second = await compileCodePlaceholders(input)

    expect(second).toEqual(first)
  })

  it('keeps variable-length JavaScript parser sentinels scoped to their own syntax nodes', async () => {
    const compiled = await compileCodePlaceholders({
      code: 'const short = {{A}}; const long = "{{LONGER}}"; return [short, long]',
      language: CodeLanguage.JavaScript,
      environmentVariables: { A: 'short-value', LONGER: 'long-value' },
    })

    await expect(executeJavaScript(compiled.code, compiled.bindings)).resolves.toEqual([
      'short-value',
      'long-value',
    ])
  })

  it('keeps decoded JavaScript tokens and regex comment syntax collision-free', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        "const \\u005f\\u005fsim_code_0_binding_0 = 'shadow'",
        'const slash = /[//]/',
        'const tag = (strings) => strings[1]',
        'return [\\u005f\\u005fsim_code_0_binding_0, slash.test("/"), tag`head$' +
          '{1}\\x2400000\\x24{{KEY}}`]',
      ].join('\n'),
      language: CodeLanguage.JavaScript,
      environmentVariables: { KEY: 'secret' },
    })

    expect(compiled.bindings[0].name).not.toBe('__sim_code_0_binding_0')
    await expect(
      executeJavaScript(compiled.code, compiled.bindings, compiled.runtimeBindings)
    ).resolves.toEqual(['shadow', true, '$00000$secret'])
  })

  it('preserves tagged-template precedence when the tag result is constructed', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        'function Tag(strings) {',
        '  if (new.target) throw new Error("tag was constructed")',
        '  return class Result { constructor() { this.value = strings[0] } }',
        '}',
        'const instance = new Tag`{{KEY}}`',
        'return [instance.constructor.name, instance.value]',
      ].join('\n'),
      language: CodeLanguage.JavaScript,
      environmentVariables: { KEY: 'secret' },
    })

    await expect(
      executeJavaScript(compiled.code, compiled.bindings, compiled.runtimeBindings)
    ).resolves.toEqual(['Result', 'secret'])
  })

  it('rejects JavaScript placeholders used as write targets', async () => {
    for (const code of [
      '{{KEY}} = 1',
      '{{KEY}}++',
      'for ({{KEY}} of []) {}',
      '({ x: {{KEY}} } = { x: 1 })',
      '[{{KEY}}] = [1]',
      'for ({ x: {{KEY}} } of []) {}',
      '({ {{KEY}} } = {})',
    ]) {
      await expect(
        compileCodePlaceholders({
          code,
          language: CodeLanguage.JavaScript,
          environmentVariables: { KEY: 'secret' },
        })
      ).rejects.toThrow('is not supported')
    }

    const computedKey = await compileCodePlaceholders({
      code: 'let target; ({ [{{KEY}}]: target } = { secret: 7 }); return target',
      language: CodeLanguage.JavaScript,
      environmentVariables: { KEY: 'secret' },
    })
    await expect(executeJavaScript(computedKey.code, computedKey.bindings)).resolves.toBe(7)
  })

  it('uses unshadowable JavaScript bindings in optional access and destructuring keys', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        'const globalThis = {}',
        'const object = { field: 7 }',
        'const missing = null',
        'const { "{{KEY}}": picked } = object',
        'return [{{KEY}}, object?.{{KEY}}, missing?.{{KEY}}, picked]',
      ].join('\n'),
      language: CodeLanguage.JavaScript,
      environmentVariables: { KEY: 'field' },
    })

    await expect(executeJavaScript(compiled.code, compiled.bindings)).resolves.toEqual([
      'field',
      7,
      undefined,
      7,
    ])
  })

  it('keeps template interpolation active after an odd source backslash', async () => {
    const oneBackslash = await compileCodePlaceholders({
      code: 'return `\\{{KEY}}`',
      language: CodeLanguage.JavaScript,
      environmentVariables: { KEY: 'secret' },
    })
    const twoBackslashes = await compileCodePlaceholders({
      code: 'return `\\\\{{KEY}}`',
      language: CodeLanguage.JavaScript,
      environmentVariables: { KEY: 'secret' },
    })

    await expect(executeJavaScript(oneBackslash.code, oneBackslash.bindings)).resolves.toBe(
      'secret'
    )
    await expect(executeJavaScript(twoBackslashes.code, twoBackslashes.bindings)).resolves.toBe(
      '\\secret'
    )
    expect(oneBackslash.code).not.toContain(`\\\${${oneBackslash.bindings[0].name}}`)
  })

  it('leaves JavaScript shebang placeholders untouched', async () => {
    const compiled = await compileCodePlaceholders({
      code: '#!/usr/bin/env node {{COMMENT}}\nconst value = {{KEY}}',
      language: CodeLanguage.JavaScript,
      environmentVariables: { COMMENT: 'hidden', KEY: 'visible-at-runtime-only' },
    })

    expect(compiled.code).toContain('#!/usr/bin/env node {{COMMENT}}')
    expect(compiled.code).not.toContain('visible-at-runtime-only')
    expect(compiled.resolvedSecretNames).toEqual(['KEY'])
  })

  it('rejects malformed JavaScript instead of repairing it during placeholder compilation', async () => {
    await expect(
      compileCodePlaceholders({
        code: 'return "unterminated {{KEY}}',
        language: CodeLanguage.JavaScript,
        environmentVariables: { KEY: 'secret' },
      })
    ).rejects.toThrow('Invalid JavaScript syntax: Unterminated string literal')

    const compiled = await compileCodePlaceholders({
      code: 'return {{KEY}}',
      language: CodeLanguage.JavaScript,
      environmentVariables: { KEY: 'secret' },
    })
    await expect(executeJavaScript(compiled.code, compiled.bindings)).resolves.toBe('secret')
  })

  it('keeps matching secret names and values out of source in JavaScript and Python', async () => {
    const javascript = await compileCodePlaceholders({
      code: 'return {{Test}}',
      language: CodeLanguage.JavaScript,
      environmentVariables: { Test: 'Test' },
    })
    const python = await compileCodePlaceholders({
      code: 'def read():\n    return {{Test}}\nprint(read())',
      language: CodeLanguage.Python,
      environmentVariables: { Test: 'Test' },
    })

    expect(javascript.code).not.toContain('Test')
    expect(python.code).not.toContain('Test')
    await expect(executeJavaScript(javascript.code, javascript.bindings)).resolves.toBe('Test')
    expect(executePython(python.code, python.bindings)).toBe('Test\n')
  })

  it('preserves placeholders in Annex B HTML comments and normalizes them for modules', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        '<!-- {{OPEN_COMMENT}}',
        'const value = "<!-- {{KEY}}"',
        'const matcher = /<!-- {{PATTERN}}/',
        '  --> {{CLOSE_COMMENT}}',
        'return [value, matcher.test("<!-- token")]',
      ].join('\n'),
      language: CodeLanguage.JavaScript,
      environmentVariables: {
        OPEN_COMMENT: 'must-remain-a-comment',
        CLOSE_COMMENT: 'must-also-remain-a-comment',
        KEY: 'secret',
        PATTERN: 'token',
      },
    })

    expect(compiled.code).toMatch(/^\/\/\s+\{\{OPEN_COMMENT\}\}/)
    expect(compiled.code).toMatch(/^\s*\/\/\s+\{\{CLOSE_COMMENT\}\}/m)
    expect(compiled.resolvedSecretNames).toEqual(['KEY', 'PATTERN'])
    await expect(
      executeJavaScript(compiled.code, compiled.bindings, compiled.runtimeBindings)
    ).resolves.toEqual(['<!-- secret', true])

    const commentOnly = await compileCodePlaceholders({
      code: '<!-- ordinary comment\nreturn 1',
      language: CodeLanguage.JavaScript,
      environmentVariables: {},
    })
    expect(commentOnly.code).toMatch(/^\/\/\s+ordinary comment/)
    await expect(executeJavaScript(commentOnly.code, commentOnly.bindings)).resolves.toBe(1)
  })

  it('compiles Python bare, normal, raw, triple, bytes, f-string, and adjacent literals out of band', async () => {
    const value = 'quote" slash\\ newline\n{{OTHER}}'
    const compiled = await compileCodePlaceholders({
      code: [
        'bare = {{KEY}}',
        'normal = "Bearer {{KEY}}"',
        'raw = r"{{KEY}}\\path"',
        'triple = """{{KEY}}\nend"""',
        'binary = b"{{KEY}}"',
        'formatted = f"Token {{KEY}}"',
        'adjacent = ("{{KEY}}" "!")',
        '# {{COMMENT}}',
      ].join('\n'),
      language: CodeLanguage.Python,
      environmentVariables: { KEY: value, OTHER: 'must-not-resolve', COMMENT: 'hidden' },
    })

    expect(compiled.code).not.toContain(value)
    expect(compiled.code).not.toContain('__var_')
    expect(compiled.code).toContain(compiled.bindings[0].name)
    expect(compiled.code).not.toContain('__import__')
    expect(compiled.code).toContain('# {{COMMENT}}')
    expect(compiled.resolvedSecretNames).toEqual(['KEY'])
  })

  it('uses unshadowable Python bindings in strings, expressions, and format specs', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        'globals = lambda: {}',
        '__import__ = None',
        'normal = "{{KEY}}"',
        'bare = {{KEY}}',
        'formatted = f"{7:{{WIDTH}}}"',
        'print(repr((normal, bare, formatted)))',
      ].join('\n'),
      language: CodeLanguage.Python,
      environmentVariables: { KEY: 'secret-value', WIDTH: '03' },
    })

    expect(executePython(compiled.code, compiled.bindings)).toBe(
      "('secret-value', 'secret-value', '007')\n"
    )
  })

  it('accepts Python bare placeholders after value-taking keywords', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        'def returned():',
        '    return {{KEY}}',
        'def yielded():',
        '    yield {{KEY}}',
        'def raised():',
        '    try:',
        '        raise ValueError({{KEY}})',
        '    except ValueError as error:',
        '        return str(error)',
        'def selected():',
        '    assert {{FLAG}}',
        '    if {{FLAG}}:',
        '        return {{KEY}}',
        '    while {{EMPTY}}:',
        '        raise RuntimeError("unreachable")',
        'print(repr((returned(), next(yielded()), raised(), selected())))',
      ].join('\n'),
      language: CodeLanguage.Python,
      environmentVariables: { KEY: 'secret', FLAG: 'true', EMPTY: '' },
    })

    expect(executePython(compiled.code, compiled.bindings)).toBe(
      "('secret', 'secret', 'secret', 'secret')\n"
    )
  })

  it('distinguishes Python lambda identifiers, match guards, and soft keywords from names', async (ctx) => {
    if (!hasPython3()) ctx.skip(PYTHON_SKIP_REASON)
    const compiled = await compileCodePlaceholders({
      code: [
        'lambda_value = "prefix-"',
        'def my_lambda(value):',
        '    return value',
        'combined = lambda_value + {{KEY}}',
        'literal = "lambda" + {{KEY}}',
        'formatted = f\'{"lambda" + {{KEY}}}\'',
        'called = my_lambda({{KEY}})',
        'case = {{KEY}}',
        'match case:',
        '    case _ if {{FLAG}}:',
        '        guarded = {{KEY}}',
        'print(repr((combined, literal, formatted, called, case, guarded)))',
      ].join('\n'),
      language: CodeLanguage.Python,
      environmentVariables: { KEY: 'secret', FLAG: 'true' },
    })

    expect(executePython(compiled.code, compiled.bindings)).toBe(
      "('prefix-secret', 'lambdasecret', 'lambdasecret', 'secret', 'secret', 'secret')\n"
    )
  })

  it('keeps Python bindings stable inside class scopes', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        'class Box:',
        '    quoted = "{{KEY}}"',
        '    bare = {{KEY}}',
        '    formatted = f"value={{KEY}}"',
        '    def read(self):',
        '        return {{KEY}}',
        'print(repr((Box.quoted, Box.bare, Box.formatted, Box().read())))',
      ].join('\n'),
      language: CodeLanguage.Python,
      environmentVariables: { KEY: 'secret' },
    })

    expect(compiled.bindings.every(({ name }) => name.endsWith('__'))).toBe(true)
    expect(executePython(compiled.code, compiled.bindings)).toBe(
      "('secret', 'secret', 'value=secret', 'secret')\n"
    )
  })

  it('preserves Python raw-string escapes, alternate format flags, and dynamic attributes', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        'class Box:',
        '    field = "attribute"',
        'box = Box()',
        'print(r"before\\\"{{KEY}}")',
        'print(f"{255:#0{{WIDTH}}x}")',
        'print(box . {{FIELD}})',
      ].join('\n'),
      language: CodeLanguage.Python,
      environmentVariables: { KEY: 'secret', WIDTH: '6', FIELD: 'field' },
    })

    expect(executePython(compiled.code, compiled.bindings)).toBe(
      'before\\"secret\n0x00ff\nattribute\n'
    )
  })

  it('uses non-assignable Python runtime expressions and rejects write positions', async () => {
    for (const code of [
      '{{KEY}} = 1',
      'obj.{{KEY}} = 1',
      'del obj . {{KEY}}',
      'print(f"{({{KEY}} := 1)}")',
      'def build({{KEY}}): pass',
      'lambda first, {{KEY}}: first',
      'for first, {{KEY}} in []: pass',
      'match value:\n    case {{KEY}}: pass',
    ]) {
      await expect(
        compileCodePlaceholders({
          code,
          language: CodeLanguage.Python,
          environmentVariables: { KEY: 'secret' },
        })
      ).rejects.toThrow('is not supported')
    }
  })

  it('interpolates many Python placeholders without recursive source evaluation', async () => {
    const count = 500
    const compiled = await compileCodePlaceholders({
      code: `print("${'{{KEY}}'.repeat(count)}")`,
      language: CodeLanguage.Python,
      environmentVariables: { KEY: 'x' },
    })

    expect(executePython(compiled.code, compiled.bindings)).toBe(`${'x'.repeat(count)}\n`)
  })

  it('keeps placeholders inside nested dynamic format fields as expressions', async () => {
    const compiled = await compileCodePlaceholders({
      code: 'print(f"{7:{int({{WIDTH}})}}")',
      language: CodeLanguage.Python,
      environmentVariables: { WIDTH: '3' },
    })

    expect(compiled.code).not.toContain(`{${compiled.bindings[0].name}}`)
    expect(executePython(compiled.code, compiled.bindings)).toBe('  7\n')
  })

  it('supports quoted and embedded strings inside Python f-string expressions', async (ctx) => {
    if (!hasPython3()) ctx.skip(PYTHON_SKIP_REASON)
    const value = 'quote"\\\n{{OTHER}}'
    const compiled = await compileCodePlaceholders({
      code: [
        'import json',
        'quoted = f"{\'prefix {{KEY}} suffix\'}"',
        'same_quote = f"{ "same {{KEY}} suffix" }"',
        "adjacent = f\"{('left {{KEY}}' ' right {{KEY}}')}\"",
        'nested = f"{f\'nested {{KEY}}\'}"',
        'print(json.dumps([quoted, same_quote, adjacent, nested], separators=(",", ":")))',
      ].join('\n'),
      language: CodeLanguage.Python,
      environmentVariables: { KEY: value, OTHER: 'must-not-resolve' },
    })

    expect(compiled.code).not.toContain(value)
    expect(executePython(compiled.code, compiled.bindings)).toBe(
      `${JSON.stringify([
        `prefix ${value} suffix`,
        `same ${value} suffix`,
        `left ${value} right ${value}`,
        `nested ${value}`,
      ])}\n`
    )
  })

  it('keeps Python f-string operators valid and rejects unsafe conversion and debug positions', async () => {
    const valid = await compileCodePlaceholders({
      code: 'print(f"{1 != {{KEY}}}")',
      language: CodeLanguage.Python,
      environmentVariables: { KEY: '2' },
    })
    expect(executePython(valid.code, valid.bindings)).toBe('True\n')

    for (const code of ['print(f"{1!{{KEY}}}")', 'print(f"{ {{KEY}} =}")']) {
      const error = await compileCodePlaceholders({
        code,
        language: CodeLanguage.Python,
        environmentVariables: { KEY: 'must-not-appear' },
      }).catch((caught) => caught)
      expect(error).toBeInstanceOf(Error)
      expect(String(error)).toContain('is not supported')
      expect(String(error)).not.toContain('must-not-appear')
    }
  })

  it('ignores Python f-string comments and does not group adjacent strings across dedents', async (ctx) => {
    if (!hasPython3()) ctx.skip(PYTHON_SKIP_REASON)
    const code = [
      'def build():',
      '    value = "{{KEY}}"',
      'print("outside")',
      'commented = f"""{(',
      '  1 # {{COMMENT}}',
      ')}"""',
    ].join('\n')
    const compiled = await compileCodePlaceholders({
      code,
      language: CodeLanguage.Python,
      environmentVariables: { KEY: 'secret', COMMENT: 'hidden' },
    })

    expect(compiled.code).toContain('# {{COMMENT}}')
    expect(compiled.resolvedSecretNames).toEqual(['KEY'])
    expect(executePython(compiled.code, compiled.bindings)).toBe('outside\n')
  })

  it('preserves Python implicit string concatenation across comments inside brackets', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        'value = (',
        '    "prefix {{KEY}}"',
        '    # an intervening comment',
        '    " suffix {{KEY}}"',
        ')',
        'print(value)',
      ].join('\n'),
      language: CodeLanguage.Python,
      environmentVariables: { KEY: 'secret' },
    })

    expect(executePython(compiled.code, compiled.bindings)).toBe('prefix secret suffix secret\n')
  })

  it('compiles shell quote contexts and preserves comments', async () => {
    const secret = 'a"\\ newline\n$()`;*'
    const compiled = await compileCodePlaceholders({
      code: [
        "printf '<%s>\\n' {{BARE}}",
        'printf \'<%s>\\n\' "{{KEY}}"',
        "printf '<%s>\\n' '{{KEY}}'",
        "printf '<%s>\\n' $'{{KEY}}'",
        '# {{COMMENT}}',
        'echo {{MISSING}}',
      ].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { BARE: 'bare', KEY: secret, COMMENT: 'hidden' },
    })

    expect(compiled.code).not.toContain('a"\\')
    expect(compiled.code).toContain('# {{COMMENT}}')
    expect(compiled.code).not.toContain('echo {{MISSING}}')
    expect(compiled.resolvedSecretNames).toEqual(['BARE', 'KEY'])
    expect(executeShell(compiled.code, compiled.bindings)).toBe(
      `<bare>\n${`<${secret}>\n`.repeat(3)}\n`
    )
  })

  it('lowers supported missing shell placeholders to legacy empty values', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        "printf '<%s>\\n' {{MISSING}}",
        'printf \'<%s>\\n\' "{{MISSING}}"',
        "printf '<%s>\\n' '{{MISSING}}'",
        "printf '<%s>\\n' $'{{MISSING}}'",
        'printf \'<%s>\\n\' "before{{MISSING}}after"',
        "printf '<%s>\\n' 'before{{MISSING}}after'",
        "printf '<%s>\\n' prefix{{MISSING}}suffix",
        '# {{MISSING}}',
        "cat <<'PAYLOAD'",
        'quoted-{{MISSING}}-body',
        '$UNRELATED `printf unsafe`',
        'PAYLOAD',
        'cat <<PAYLOAD',
        'unquoted-{{MISSING}}-body',
        'PAYLOAD',
        "cat <<'{{DELIMITER}}'",
        'delimiter-body',
        '{{DELIMITER}}',
      ].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: {},
    })

    expect(compiled.bindings).toEqual([])
    expect(compiled.privateInputs).toEqual([])
    expect(compiled.resolvedSecretNames).toEqual([])
    expect(compiled.code).not.toContain("printf '<%s>\\n' {{MISSING}}")
    expect(compiled.code).not.toContain('quoted-{{MISSING}}-body')
    expect(compiled.code).not.toContain('unquoted-{{MISSING}}-body')
    expect(compiled.code).toContain('# {{MISSING}}')
    expect(compiled.code).toContain('$UNRELATED `printf unsafe`')
    expect(compiled.code).toContain("cat <<'{{DELIMITER}}'")
    expect(compiled.code).toContain('\n{{DELIMITER}}')
    expect(executeShell(compiled.code, compiled.bindings)).toBe(
      `${'<>\n'.repeat(4)}${'<beforeafter>\n'.repeat(2)}<prefixsuffix>\n` +
        'quoted--body\n$UNRELATED `printf unsafe`\nunquoted--body\ndelimiter-body\n'
    )
  })

  it('trims valid shell placeholder names and leaves invalid names literal', async () => {
    const compiled = await compileCodePlaceholders({
      code: ['printf \'<%s>\\n\' "{{ KEY }}"', 'printf \'<%s>\\n\' "{{API-KEY}}"'].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { KEY: 'secret', 'API-KEY': 'hyphen-secret' },
    })

    expect(compiled.bindings).toHaveLength(1)
    expect(compiled.resolvedSecretNames).toEqual(['KEY'])
    expect(executeShell(compiled.code, compiled.bindings)).toBe('<secret>\n<{{API-KEY}}>\n')
    await expect(
      analyzeCodePlaceholders('{{ KEY }} {{API-KEY}}', CodeLanguage.Shell)
    ).resolves.toEqual(['KEY'])
  })

  it('preserves legacy unquoted shell regex, word-splitting, and empty-value semantics', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        '[[ abc =~ {{PATTERN}} ]] && echo matched',
        'set -- {{WORDS}}',
        'printf "words=%s\\n" "$#"',
        'set -- before {{EMPTY}} after',
        'printf "empty=%s\\n" "$#"',
      ].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { PATTERN: 'a.*', WORDS: 'one two', EMPTY: '' },
    })

    expect(executeShell(compiled.code, compiled.bindings)).toBe('matched\nwords=2\nempty=2\n')
  })

  it('does not mistake shell arithmetic shifts for heredocs', async () => {
    const compiled = await compileCodePlaceholders({
      code: [': $(( x << 1 ))', '(( y = 1 << 2 ))', "printf '<%s>\\n' '{{KEY}}'"].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { KEY: 'secret-value' },
    })

    expect(compiled.privateInputs).toEqual([])
    expect(executeShell(compiled.code, compiled.bindings)).toBe('<secret-value>\n')
  })

  it('tracks nested shell command substitutions and their own quote contexts', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        'printf "<%s>\\n" "$(printf %s \'{{KEY}}\')"',
        'printf "<%s>\\n" "`printf %s \'{{KEY}}\'`"',
        'cat <<PAYLOAD',
        "$(printf %s '{{KEY}}')",
        "$'{{KEY}}'",
        "'{{KEY}}'",
        'PAYLOAD',
      ].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { KEY: 'a b$`' },
    })

    expect(compiled.code).not.toContain('__var_')
    expect(executeShell(compiled.code, compiled.bindings)).toBe(
      "<a b$`>\n<a b$`>\na b$`\n$'a b$`'\n'a b$`'\n"
    )
  })

  it('rejects shell NUL values without including the value in the diagnostic', async () => {
    const error = await compileCodePlaceholders({
      code: 'printf %s {{KEY}}',
      language: CodeLanguage.Shell,
      environmentVariables: { KEY: 'before\0after' },
    }).catch((caught) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain('cannot contain NUL')
    expect(String(error)).not.toContain('before')
    expect(String(error)).not.toContain('after')
  })

  it('renders quoted shell heredocs through a private file without enabling shell expansion', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        "cat <<'PAYLOAD'",
        'Bearer {{KEY}}',
        '$UNRELATED `touch /tmp/never` $(touch /tmp/never-either)',
        'PAYLOAD',
        'echo done',
      ].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { KEY: 'a"\\\n{{OTHER}}', OTHER: 'must-not-resolve' },
    })

    expect(compiled.privateInputs).toHaveLength(1)
    expect(compiled.privateInputs[0].content).toBe(
      'Bearer a"\\\n{{OTHER}}\n$UNRELATED `touch /tmp/never` $(touch /tmp/never-either)\n'
    )
    expect(compiled.code).toContain(`< "\${${compiled.privateInputs[0].environmentVariable}}"`)
    expect(compiled.code).not.toContain('$UNRELATED')
    expect(compiled.code).toContain('echo done')
    expect(compiled.resolvedSecretNames).toEqual(['KEY'])
  })

  it('deduplicates identical quoted shell heredoc payloads', async () => {
    const compiled = await compileCodePlaceholders({
      code: ["cat <<'ONE'", '{{KEY}}', 'ONE', "cat <<'TWO'", '{{KEY}}', 'TWO'].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { KEY: 'secret' },
    })

    expect(compiled.privateInputs).toHaveLength(1)
    const environmentVariable = compiled.privateInputs[0].environmentVariable
    expect(compiled.code.match(new RegExp(environmentVariable, 'g'))).toHaveLength(2)
  })

  it('recognizes ANSI-C, locale, and empty quoted shell heredoc delimiters', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        String.raw`cat <<$'PAY\x4cOAD'`,
        '{{FIRST}}',
        'PAYLOAD',
        'cat <<$"LOCALIZED"',
        '{{SECOND}}',
        'LOCALIZED',
        "cat <<''",
        '{{THIRD}}',
        '',
        '',
      ].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { FIRST: 'one', SECOND: 'two', THIRD: 'three' },
    })

    expect(compiled.privateInputs.map(({ content }) => content)).toEqual([
      'one\n',
      'two\n',
      'three\n',
    ])
    expect(compiled.code).not.toContain('PAYLOAD')
    expect(compiled.code).not.toContain('LOCALIZED')
    expect(compiled.resolvedSecretNames).toEqual(['FIRST', 'SECOND', 'THIRD'])
  })

  it('recognizes quoted shell heredoc delimiters across a continued header', async () => {
    const compiled = await compileCodePlaceholders({
      code: ['cat <<\\', "'PAYLOAD'", '{{KEY}}', 'PAYLOAD'].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { KEY: 'secret' },
    })

    expect(compiled.privateInputs).toHaveLength(1)
    expect(compiled.privateInputs[0].content).toBe('secret\n')
    expect(compiled.code).toContain(` \\\n`)
  })

  it('does not parse heredoc-looking text inside a multiline shell quote', async () => {
    const compiled = await compileCodePlaceholders({
      code: ['printf "%s\\n" "literal', "<<'PAYLOAD'", '{{KEY}}', 'PAYLOAD"'].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { KEY: 'secret' },
    })

    expect(compiled.privateInputs).toEqual([])
    expect(executeShell(compiled.code, compiled.bindings)).toBe(
      "literal\n<<'PAYLOAD'\nsecret\nPAYLOAD\n"
    )
  })

  it('rejects ambiguous shell parameter and parser-name positions', async () => {
    for (const code of ['printf %s $' + '{{KEY}}', 'for {{KEY}} in value; do :; done']) {
      await expect(
        compileCodePlaceholders({
          code,
          language: CodeLanguage.Shell,
          environmentVariables: { KEY: 'secret' },
        })
      ).rejects.toThrow('is not supported')
    }
  })

  it('renders quoted shell heredocs nested in double-quoted command substitutions', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        "output=\"$(cat <<'PAYLOAD'",
        'Bearer {{KEY}}',
        '$UNRELATED `printf unsafe` $(printf unsafe)',
        'PAYLOAD',
        ')"',
        'printf \'%s\\n\' "$output"',
      ].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { KEY: 'secret value' },
    })

    expect(compiled.privateInputs).toHaveLength(1)
    expect(compiled.privateInputs[0].content).toBe(
      'Bearer secret value\n$UNRELATED `printf unsafe` $(printf unsafe)\n'
    )
    expect(compiled.code).toContain(
      `output="$(cat < "\${${compiled.privateInputs[0].environmentVariable}}"`
    )
    expect(compiled.code).not.toContain('$UNRELATED')
  })

  it('keeps unquoted shell heredocs on native expansion semantics', async () => {
    const compiled = await compileCodePlaceholders({
      code: ['cat <<PAYLOAD', '{{KEY}}', '$UNRELATED', 'PAYLOAD'].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { KEY: 'secret' },
    })

    expect(compiled.privateInputs).toEqual([])
    expect(compiled.code).toContain(`\${${compiled.bindings[0].name}}`)
    expect(compiled.code).toContain('$UNRELATED')
  })

  it('keeps shell provenance in source order and rejects escaped placeholder contexts', async () => {
    const error = await compileCodePlaceholders({
      code: ['printf %s {{FIRST}}', 'cat <<PAYLOAD', '\\{{SECOND}}', 'PAYLOAD'].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { FIRST: 'first', SECOND: 'second' },
    }).catch((caught) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain('escaped shell sequence')
    expect(String(error)).not.toContain('first')
    expect(String(error)).not.toContain('second')
  })

  it('analyzes unsupported resolved syntax without failing missing-variable discovery', async () => {
    await expect(
      analyzeCodePlaceholders(
        ['// {{COMMENT}}', 'import value from "{{MODULE}}"', 'String.raw`{{TAGGED}}`'].join('\n'),
        CodeLanguage.JavaScript
      )
    ).resolves.toEqual(['MODULE', 'TAGGED'])
    await expect(
      analyzeCodePlaceholders("cat <<'{{DELIMITER}}'\nbody\n{{DELIMITER}}", CodeLanguage.Shell)
    ).resolves.toEqual(['DELIMITER'])
  })
})

describe('direct environment reads', () => {
  it('reports a JavaScript read that never used a placeholder', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        'const a = environmentVariables.API_KEY',
        "const b = environmentVariables['OTHER_KEY']",
        'return { a, b }',
      ].join('\n'),
      language: CodeLanguage.JavaScript,
      environmentVariables: { API_KEY: 'a-value', OTHER_KEY: 'b-value', UNUSED: 'c-value' },
    })

    expect(compiled.resolvedSecretNames).toEqual(['API_KEY', 'OTHER_KEY'])
  })

  it('merges direct reads with placeholder resolutions in source order', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        'const a = environmentVariables.FIRST',
        'const b = "{{SECOND}}"',
        'return { a, b }',
      ].join('\n'),
      language: CodeLanguage.JavaScript,
      environmentVariables: { FIRST: 'one', SECOND: 'two' },
    })

    expect(compiled.resolvedSecretNames).toEqual(['FIRST', 'SECOND'])
  })

  it('ignores an identifier that is not a configured secret', async () => {
    const compiled = await compileCodePlaceholders({
      code: 'return environmentVariables.NOT_A_SECRET',
      language: CodeLanguage.JavaScript,
      environmentVariables: { API_KEY: 'a-value' },
    })

    expect(compiled.resolvedSecretNames).toEqual([])
  })

  /** A computed key is the boundary: statically unresolvable, so deliberately unreported. */
  it('does not guess a computed subscript', async () => {
    const compiled = await compileCodePlaceholders({
      code: ['const name = "API_KEY"', 'return environmentVariables[name]'].join('\n'),
      language: CodeLanguage.JavaScript,
      environmentVariables: { API_KEY: 'a-value' },
    })

    expect(compiled.resolvedSecretNames).toEqual([])
  })

  it('does not read off an unrelated object with a matching property', async () => {
    const compiled = await compileCodePlaceholders({
      code: ['const other = { API_KEY: 1 }', 'return other.API_KEY'].join('\n'),
      language: CodeLanguage.JavaScript,
      environmentVariables: { API_KEY: 'a-value' },
    })

    expect(compiled.resolvedSecretNames).toEqual([])
  })

  /**
   * Copilot mounts a secret only for an explicit placeholder. Analysis must not widen that,
   * or an identifier in a string would pull a value into agent-authored code.
   */
  it('never reports a direct read to the Copilot mount analyzer', async () => {
    const names = await analyzeCodePlaceholders(
      'return environmentVariables.API_KEY',
      CodeLanguage.JavaScript
    )

    expect(names).toEqual([])
  })
})

describe('direct environment reads in Python', () => {
  it('reports subscript and get() reads', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        "a = environmentVariables['API_KEY']",
        "b = environmentVariables.get('OTHER_KEY')",
        'return {"a": a, "b": b}',
      ].join('\n'),
      language: CodeLanguage.Python,
      environmentVariables: { API_KEY: 'a-value', OTHER_KEY: 'b-value', UNUSED: 'c-value' },
    })

    expect(compiled.resolvedSecretNames).toEqual(['API_KEY', 'OTHER_KEY'])
  })

  it('ignores a read written inside a string or comment', async () => {
    const compiled = await compileCodePlaceholders({
      code: [
        'doc = "environmentVariables[\'API_KEY\']"',
        "# environmentVariables['API_KEY']",
        'return doc',
      ].join('\n'),
      language: CodeLanguage.Python,
      environmentVariables: { API_KEY: 'a-value' },
    })

    expect(compiled.resolvedSecretNames).toEqual([])
  })

  it('does not match a longer identifier that merely ends in the binding name', async () => {
    const compiled = await compileCodePlaceholders({
      code: "return myenvironmentVariables['API_KEY']",
      language: CodeLanguage.Python,
      environmentVariables: { API_KEY: 'a-value' },
    })

    expect(compiled.resolvedSecretNames).toEqual([])
  })

  it('does not guess a computed subscript', async () => {
    const compiled = await compileCodePlaceholders({
      code: ['name = "API_KEY"', 'return environmentVariables[name]'].join('\n'),
      language: CodeLanguage.Python,
      environmentVariables: { API_KEY: 'a-value' },
    })

    expect(compiled.resolvedSecretNames).toEqual([])
  })
})

describe('direct environment reads in shell', () => {
  it('reports bare and braced parameter expansions', async () => {
    const compiled = await compileCodePlaceholders({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a JS template
      code: ['echo "$API_KEY"', 'curl -H "Authorization: ${OTHER_KEY}"'].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { API_KEY: 'a-value', OTHER_KEY: 'b-value', UNUSED: 'c-value' },
    })

    expect(compiled.resolvedSecretNames).toEqual(['API_KEY', 'OTHER_KEY'])
  })

  it('keeps the name when a default is supplied', async () => {
    const compiled = await compileCodePlaceholders({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a JS template
      code: 'echo "${API_KEY:-fallback}"',
      language: CodeLanguage.Shell,
      environmentVariables: { API_KEY: 'a-value' },
    })

    expect(compiled.resolvedSecretNames).toEqual(['API_KEY'])
  })

  /** Single quotes suppress expansion, so the secret is never read. */
  it('ignores a single-quoted expansion', async () => {
    const compiled = await compileCodePlaceholders({
      code: "echo '$API_KEY'",
      language: CodeLanguage.Shell,
      environmentVariables: { API_KEY: 'a-value' },
    })

    expect(compiled.resolvedSecretNames).toEqual([])
  })

  it('ignores an escaped expansion and positional parameters', async () => {
    const compiled = await compileCodePlaceholders({
      code: ['echo "\\$API_KEY"', 'echo "$1 $@ $$"'].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { API_KEY: 'a-value' },
    })

    expect(compiled.resolvedSecretNames).toEqual([])
  })

  /** A quoted delimiter makes the body literal, so nothing in it expands. */
  it('ignores an expansion inside a quoted heredoc but reports an unquoted one', async () => {
    const quoted = await compileCodePlaceholders({
      code: ["cat <<'EOF'", '$API_KEY', 'EOF'].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { API_KEY: 'a-value' },
    })
    const unquoted = await compileCodePlaceholders({
      code: ['cat <<EOF', '$API_KEY', 'EOF'].join('\n'),
      language: CodeLanguage.Shell,
      environmentVariables: { API_KEY: 'a-value' },
    })

    expect(quoted.resolvedSecretNames).toEqual([])
    expect(unquoted.resolvedSecretNames).toEqual(['API_KEY'])
  })

  it('ignores a shell variable that is not a configured secret', async () => {
    const compiled = await compileCodePlaceholders({
      code: 'echo "$PATH $HOME"',
      language: CodeLanguage.Shell,
      environmentVariables: { API_KEY: 'a-value' },
    })

    expect(compiled.resolvedSecretNames).toEqual([])
  })
})

const directReadEnv = { API_KEY: 'a-value' }
const directReadNames = async (code: string, language: CodeLanguage) =>
  (await compileCodePlaceholders({ code, language, environmentVariables: directReadEnv }))
    .resolvedSecretNames

describe('direct environment read edge cases', () => {
  it('ignores a Python attribute on an unrelated object with the same name', async () => {
    expect(
      await directReadNames("return other.environmentVariables['API_KEY']", CodeLanguage.Python)
    ).toEqual([])
  })

  it('reads a Python subscript split across lines', async () => {
    expect(
      await directReadNames("x = environmentVariables[\n  'API_KEY'\n]", CodeLanguage.Python)
    ).toEqual(['API_KEY'])
  })

  /** The whole f-string is one token, so the read is missed — a miss, never a false claim. */
  it('does not report a Python f-string read', async () => {
    expect(
      await directReadNames('x = f"{environmentVariables[\'API_KEY\']}"', CodeLanguage.Python)
    ).toEqual([])
  })

  it('ignores a commented-out shell expansion', async () => {
    expect(await directReadNames('# echo "$API_KEY"', CodeLanguage.Shell)).toEqual([])
  })

  it('does not prefix-match a longer shell name', async () => {
    expect(await directReadNames('echo "$API_KEYS"', CodeLanguage.Shell)).toEqual([])
  })

  it('does not guess a shell indirect expansion', async () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a JS template
    expect(await directReadNames('echo "${!API_KEY}"', CodeLanguage.Shell)).toEqual([])
  })

  it('ignores a double-quoted expansion nested in single quotes', async () => {
    expect(await directReadNames(`echo '"$API_KEY"'`, CodeLanguage.Shell)).toEqual([])
  })
})

describe('touching a configured name reports it, whatever the code does with it', () => {
  /**
   * `environmentVariables` is a plain object deserialized from the run payload, not a handle on
   * the stored secret: writing to it changes nothing outside the sandbox and is discarded when
   * the run ends. Telling a write apart from a read therefore buys almost nothing, so the
   * detector does not try — the same rule every language here follows.
   */
  it.each([
    ['property assignment', "environmentVariables.API_KEY = 'x'"],
    ['subscript assignment', "environmentVariables['API_KEY'] = 'x'"],
    ['compound assignment', "environmentVariables.API_KEY += 'x'"],
    ['delete', 'delete environmentVariables.API_KEY'],
  ])('javascript: %s', async (_label, code) => {
    expect(await directReadNames(code, CodeLanguage.JavaScript)).toEqual(['API_KEY'])
  })

  it.each([
    ['subscript assignment', "environmentVariables['API_KEY'] = 'x'"],
    ['del', "del environmentVariables['API_KEY']"],
    ['nested read inside a del', "del environmentVariables[environmentVariables['API_KEY']]"],
  ])('python: %s', async (_label, code) => {
    expect(await directReadNames(code, CodeLanguage.Python)).toEqual(['API_KEY'])
  })
})

describe('a shadowing local does not suppress reads', () => {
  /**
   * A read off a shadowing local is reported rather than discarded. Dropping it was file-wide,
   * so a helper with its own `environmentVariables` silently removed genuine reads elsewhere in
   * the source — and a dropped read never reaches the output matcher, leaving a real secret
   * unmasked. Reporting one costs only an exact value the code never emits.
   */
  it('reports a read that a helper-scoped binding would previously have discarded', async () => {
    const code = [
      'function helper(environmentVariables) { return environmentVariables.API_KEY }',
      'return helper({}) + environmentVariables.API_KEY',
    ].join('\n')
    expect(await directReadNames(code, CodeLanguage.JavaScript)).toEqual(['API_KEY'])
  })

  it.each([
    [
      'const declaration',
      "const environmentVariables = { API_KEY: 'x' }\nreturn environmentVariables.API_KEY",
    ],
    ['bare for-of target', 'for (environmentVariables of rows) log(environmentVariables.API_KEY)'],
    [
      'bare reassignment',
      "environmentVariables = { API_KEY: 'x' }\nreturn environmentVariables.API_KEY",
    ],
  ])('javascript reports despite a shadow: %s', async (_label, code) => {
    expect(await directReadNames(code, CodeLanguage.JavaScript)).toEqual(['API_KEY'])
  })

  it.each([
    ['assignment', "environmentVariables = {'API_KEY': 'x'}\nk = environmentVariables['API_KEY']"],
    [
      'def parameter',
      "def read(environmentVariables):\n    return environmentVariables['API_KEY']",
    ],
  ])('python reports despite a shadow: %s', async (_label, code) => {
    expect(await directReadNames(code, CodeLanguage.Python)).toEqual(['API_KEY'])
  })
})

describe('a dot in prose is not a qualifier', () => {
  /**
   * The receiver walk crosses whitespace so a parenthesized `other.` on a previous line is
   * seen — but a comment or string can also end in a period, and landing on THAT dot must not
   * discard the read below it. The lexer decides which dots are code.
   */
  /** The read sits at line start, so the walk reaches the previous line's final character. */
  it.each([
    ['comment ending in a period', "# Load the value.\nenvironmentVariables['API_KEY']"],
    ['docstring ending in a period', '"""Reads the key."""\nenvironmentVariables[\'API_KEY\']'],
    ['string ending in a period', "s = 'done.'\nenvironmentVariables['API_KEY']"],
  ])('%s', async (_label, code) => {
    expect(await directReadNames(code, CodeLanguage.Python)).toEqual(['API_KEY'])
  })

  it('still discards a real cross-line attribute access', async () => {
    expect(
      await directReadNames(
        "k = (other.\n     environmentVariables['API_KEY'])",
        CodeLanguage.Python
      )
    ).toEqual([])
  })
})

describe('literal computed pattern keys resolve like subscripts', () => {
  it.each([
    ['string literal', "const { ['API_KEY']: key } = environmentVariables\nreturn key"],
    ['template literal', 'const { [`API_KEY`]: key } = environmentVariables\nreturn key'],
    ['parenthesized literal', "const { [('API_KEY')]: key } = environmentVariables\nreturn key"],
  ])('%s', async (_label, code) => {
    expect(await directReadNames(code, CodeLanguage.JavaScript)).toEqual(['API_KEY'])
  })

  /** A non-literal computed key stays the runtime-name boundary a computed subscript has. */
  it('does not attribute an identifier computed key', async () => {
    expect(
      await directReadNames(
        'const { [k]: v } = environmentVariables\nreturn v',
        CodeLanguage.JavaScript
      )
    ).toEqual([])
  })
})

describe('destructured environment reads are reads', () => {
  /**
   * `const { API_KEY } = environmentVariables` delivers the value by name with no property-
   * or element-access node in the AST, so the member-access walk alone missed it — and a
   * missed read leaves an emitted value unmasked.
   */
  it.each([
    ['shorthand', 'const { API_KEY } = environmentVariables\nreturn API_KEY'],
    ['renamed', 'const { API_KEY: key } = environmentVariables\nreturn key'],
    ['with a default', "const { API_KEY = 'x' } = environmentVariables\nreturn API_KEY"],
    ['string-literal key', "const { 'API_KEY': key } = environmentVariables\nreturn key"],
    ['assignment form', 'let key\n;({ API_KEY: key } = environmentVariables)\nreturn key'],
  ])('%s', async (_label, code) => {
    expect(await directReadNames(code, CodeLanguage.JavaScript)).toEqual(['API_KEY'])
  })

  it.each([
    [
      'parameter default',
      'function f({ API_KEY } = environmentVariables) { return API_KEY }\nreturn f()',
    ],
    [
      'arrow parameter default',
      'const f = ({ API_KEY } = environmentVariables) => API_KEY\nreturn f()',
    ],
    [
      'binding-element default',
      'const { config: { API_KEY } = environmentVariables } = payload\nreturn API_KEY',
    ],
    ['parenthesized initializer', 'const { API_KEY } = (environmentVariables)\nreturn API_KEY'],
    [
      'double-parenthesized initializer',
      'const { API_KEY } = ((environmentVariables))\nreturn API_KEY',
    ],
    ['parenthesized member access', 'return (environmentVariables).API_KEY'],
    ['parenthesized subscript', "return (environmentVariables)['API_KEY']"],
  ])('receiver rule covers: %s', async (_label, code) => {
    expect(await directReadNames(code, CodeLanguage.JavaScript)).toEqual(['API_KEY'])
  })

  /**
   * The environment wrapped in a container and read back out is data flow, not a receiver —
   * the same documented boundary as an alias (`const e = environmentVariables`) or a computed
   * key. Attribution stops where the receiver stops being demonstrably the environment
   * object; following containers has no fixed point.
   */
  it('does not follow the environment through an array literal', async () => {
    expect(
      await directReadNames(
        'for (const { API_KEY } of [environmentVariables]) log(API_KEY)',
        CodeLanguage.JavaScript
      )
    ).toEqual([])
  })

  it('reports every configured name for a rest grab', async () => {
    const compiled = await compileCodePlaceholders({
      code: 'const { ...all } = environmentVariables\nreturn all',
      language: CodeLanguage.JavaScript,
      environmentVariables: { API_KEY: 'a-value-123456', OTHER_KEY: 'b-value-123456' },
    })
    expect(compiled.resolvedSecretNames).toEqual(['API_KEY', 'OTHER_KEY'])
  })

  it.each([
    ['different receiver', 'const { API_KEY } = other\nreturn API_KEY'],
    ['computed key', 'const { [k]: v } = environmentVariables\nreturn v'],
    ['unconfigured name', 'const { NOT_CONFIGURED } = environmentVariables\nreturn NOT_CONFIGURED'],
  ])('does not attribute: %s', async (_label, code) => {
    expect(await directReadNames(code, CodeLanguage.JavaScript)).toEqual([])
  })
})

describe('shell backslash escaping is parity, not presence', () => {
  /**
   * `\\$KEY` is an escaped backslash followed by a LIVE expansion — bash prints `\` plus the
   * value — while `\$KEY` is an escaped dollar and stays literal. Checking only the adjacent
   * character read the even case as escaped and dropped a real read from usage and masking.
   */
  it.each([
    ['no backslash', 'echo "$API_KEY"', ['API_KEY']],
    ['one (escaped dollar)', 'echo "\\$API_KEY"', []],
    ['two (escaped backslash, live expansion)', 'echo "\\\\$API_KEY"', ['API_KEY']],
    ['three (escaped both)', 'echo "\\\\\\$API_KEY"', []],
    ['four (two literal backslashes, live expansion)', 'echo "\\\\\\\\$API_KEY"', ['API_KEY']],
    ['unquoted even run', 'echo \\\\$API_KEY', ['API_KEY']],
  ])('%s', async (_label, code, expected) => {
    expect(await directReadNames(code, CodeLanguage.Shell)).toEqual(expected)
  })
})

describe('shell true positives survive the fail-closed rule', () => {
  it.each([
    ['bare unquoted', 'echo $API_KEY'],
    ['assignment', 'export FOO=$API_KEY'],
    ['inside double quotes', 'curl -H "Authorization: Bearer $API_KEY"'],
    ['command substitution', 'X=$(echo $API_KEY)'],
    ['backticks', 'X=`echo $API_KEY`'],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a JS template
    ['braced', 'echo ${API_KEY}'],
    ['second line', 'set -e\necho $API_KEY'],
    ['trailing comment on another line', 'echo $API_KEY # note'],
  ])('%s', async (_label, code) => {
    expect(await directReadNames(code, CodeLanguage.Shell)).toEqual(['API_KEY'])
  })
})

describe('python true positives survive the dot guard', () => {
  it.each([
    ['subscript', "x = environmentVariables['API_KEY']"],
    ['get', "x = environmentVariables.get('API_KEY')"],
    ['in a call', "print(environmentVariables['API_KEY'])"],
    ['after open paren', "x = str(environmentVariables['API_KEY'])"],
    ['double quotes', 'x = environmentVariables["API_KEY"]'],
  ])('%s', async (_label, code) => {
    expect(await directReadNames(code, CodeLanguage.Python)).toEqual(['API_KEY'])
  })
})
