/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'
import {
  type FormattableCodeLanguage,
  formatFunctionCode,
} from '@/lib/workflows/blocks/format-function-code'
import { createCombinedPattern } from '@/executor/utils/reference-validation'

interface SyntaxCase {
  name: string
  code: string
  preservedFragments?: string[]
}

interface JavaScriptRuntimeCase {
  name: string
  code: string
  input: unknown
}

const JAVASCRIPT_SYNTAX_CASES: SyntaxCase[] = [
  {
    name: 'nested destructuring and rest properties',
    code: "const {user:{name='unknown',roles=[]}={},...rest}=input;return {name,roles,rest};",
  },
  {
    name: 'async callbacks and await expressions',
    code: 'const responses=await Promise.all(urls.map(async(url)=>{const response=await fetch(url);return response.json()}));return responses;',
  },
  {
    name: 'optional chaining and nullish coalescing',
    code: "const city=user?.profile?.address?.city??'unknown';return city;",
  },
  {
    name: 'private class fields and default parameters',
    code: 'class Counter{#value=0;increment(step=1){this.#value+=step;return this.#value}}return new Counter().increment();',
  },
  {
    name: 'try catch switch and finally blocks',
    code: "try{switch(status){case 'ok':return {ok:true};default:throw new Error('bad')}}catch(error){return {ok:false,message:String(error)}}finally{cleanup?.()}",
  },
  {
    name: 'generator functions and loop control',
    code: 'function* chunks(items,size){for(let index=0;index<items.length;index+=size){yield items.slice(index,index+size)}}return [...chunks(values,2)];',
  },
  {
    name: 'regular expressions and template literals',
    code: `const slug=title.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');return \`\${prefix}:\${slug}\`;`,
  },
  {
    name: 'comments around chained array transformations',
    code: 'const active=items.filter((item)=>item.enabled)/* retain enabled entries */.map((item)=>item.value);// preserve source order\nreturn active;',
    preservedFragments: ['/* retain enabled entries */', '// preserve source order'],
  },
  {
    name: 'nested ternaries and logical assignment',
    code: "let label=config.label;label??=fallback;return status==='ready'?label:status==='pending'?'waiting':'unknown';",
  },
  {
    name: 'unicode identifiers and numeric separators',
    code: 'const π=3.141_592_653_589_793;const 半径=diameter/2;return π*半径**2;',
  },
  {
    name: 'bigint and bitwise operators',
    code: 'const shifted=(BigInt(value)<<8n)|0xffn;return shifted>>2n;',
  },
  {
    name: 'dynamic imports',
    code: "const module=await import('module-name');return module.default??module;",
  },
  {
    name: 'labeled loops',
    code: 'outer:for(const row of rows){for(const cell of row){if(cell===target){break outer}}}return target;',
  },
  {
    name: 'multiline object and method definitions',
    code: 'const service={value:1,get current(){return this.value},set current(value){this.value=value},run(){return this.current}};return service.run();',
  },
]

const PYTHON_SYNTAX_CASES: SyntaxCase[] = [
  {
    name: 'nested comprehensions',
    code: 'pairs={key:[item.value for item in items if item.enabled] for key,items in groups.items()}\nreturn pairs',
  },
  {
    name: 'await expressions',
    code: 'response=await client.fetch(url,timeout=30)\nreturn await response.json()',
  },
  {
    name: 'async for loops',
    code: 'results=[]\nasync for item in stream:\n results.append(await transform(item))\nreturn results',
  },
  {
    name: 'async context managers',
    code: 'async with client.session() as session:\n result=await session.run(query)\nreturn result',
  },
  {
    name: 'structural pattern matching',
    code: 'match event:\n case {"type":"created","payload":payload}: return payload\n case {"type":"deleted","id":item_id}: return {"deleted":item_id}\n case _: return None',
  },
  {
    name: 'try except else and finally blocks',
    code: 'try:\n value=run()\nexcept (ValueError,TypeError) as error:\n return {"ok":False,"error":str(error)}\nelse:\n return {"ok":True,"value":value}\nfinally:\n cleanup()',
  },
  {
    name: 'nested typed functions',
    code: 'def normalize(value:str|None,default:str="") -> str:\n return value.strip() if value else default\nreturn normalize(raw_value)',
  },
  {
    name: 'generators and yield from',
    code: 'def flatten(groups):\n for group in groups:\n  yield from group\nreturn list(flatten(values))',
  },
  {
    name: 'f strings and conversion flags',
    code: 'message=f"{user.name!r} has {len(items):03d} items"\nreturn message',
  },
  {
    name: 'assignment expressions',
    code: 'if (count:=len(items))>limit:\n return {"count":count,"overflow":True}\nreturn {"count":count,"overflow":False}',
  },
  {
    name: 'multiple context managers',
    code: 'with open(source) as input_file,open(destination,"w") as output_file:\n output_file.write(input_file.read())\nreturn destination',
  },
  {
    name: 'nested classes and properties',
    code: 'class Counter:\n def __init__(self,start=0): self._value=start\n @property\n def value(self): return self._value\n def increment(self,step=1):\n  self._value+=step\n  return self.value\nreturn Counter().increment()',
  },
  {
    name: 'comments and multiline strings',
    code: 'message="""line one\nline two"""\n# preserve this explanation\nreturn message.strip()',
    preservedFragments: ['# preserve this explanation', 'line one\nline two'],
  },
  {
    name: 'slices lambdas and sorted keys',
    code: 'middle=values[1:-1:2]\nreturn sorted(middle,key=lambda item:(item.priority,item.name.casefold()))',
  },
]

const JAVASCRIPT_RUNTIME_CASES: JavaScriptRuntimeCase[] = [
  {
    name: 'preserves arithmetic precedence',
    code: 'const scaled=(input.left+input.right*2)/(input.divisor||1);return {scaled,rounded:Math.round(scaled)};',
    input: { left: 3, right: 7, divisor: 2 },
  },
  {
    name: 'preserves destructuring defaults',
    code: "const {name='unknown',tags=[]}=input.user??{};return {name,tags:[...tags].sort()};",
    input: { user: { tags: ['beta', 'alpha'] } },
  },
  {
    name: 'preserves control flow',
    code: 'let total=0;for(const value of input.values){if(value<0)continue;if(value>input.limit)break;total+=value}return total;',
    input: { values: [-1, 2, 4, 20, 1], limit: 10 },
  },
  {
    name: 'preserves optional and nullish access',
    code: "return input.user?.profile?.name??input.fallback??'anonymous';",
    input: { user: { profile: null }, fallback: 'fallback-name' },
  },
  {
    name: 'preserves regex and template behavior',
    code: `const slug=input.title.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');return \`\${input.prefix}:\${slug}\`;`,
    input: { prefix: 'item', title: '  Hello, Formatter!  ' },
  },
  {
    name: 'preserves array transformation behavior',
    code: 'return input.values.filter((value)=>value%2===0).map((value,index)=>({index,value:value**2}));',
    input: { values: [1, 2, 3, 4, 5, 6] },
  },
  {
    name: 'preserves bitwise behavior',
    code: 'const packed=((input.red&255)<<16)|((input.green&255)<<8)|(input.blue&255);return {packed,unsigned:packed>>>0};',
    input: { red: 250, green: 128, blue: 5 },
  },
  {
    name: 'preserves switch and exception behavior',
    code: "try{switch(input.status){case 'ready':return {ok:true,value:input.value};case 'error':throw new Error(input.message);default:return {ok:false,value:null}}}catch(error){return {ok:false,error:error.message}}",
    input: { status: 'error', message: 'expected failure', value: 42 },
  },
]

const WORKFLOW_REFERENCES = [
  '<start.value>',
  '<block-1.items[0]>',
  '<loop.results[12].payload.value>',
  '<agent-name.output>',
  '<source.map.values>',
] as const

const ENV_REFERENCES = ['{{API_KEY}}', '{{ DEFAULT_VALUE }}', '{{nested_value_2}}'] as const
const COLLIDING_REFERENCE = '<start.value>'
const COLLIDING_TOKEN = '_0'.padEnd(COLLIDING_REFERENCE.length, '_')

const JAVASCRIPT_REFERENCE_CONTEXTS = [
  (reference: string, envReference: string) =>
    `const value=${reference};const fallback=${envReference};return value??fallback;`,
  (reference: string, envReference: string) =>
    `return {primary:${reference},fallback:${envReference}};`,
  (reference: string, envReference: string) =>
    `const values=[${reference},${envReference}];return values;`,
  (reference: string, envReference: string) =>
    `if(${reference}){return ${envReference}}return null;`,
  (reference: string, envReference: string) =>
    `return await Promise.resolve(${reference}??${envReference});`,
  (reference: string, envReference: string) =>
    `const lookup=new Map([['value',${reference}]]);return lookup.get('value')??${envReference};`,
] as const

const PYTHON_REFERENCE_CONTEXTS = [
  (reference: string, envReference: string) =>
    `value=${reference}\nfallback=${envReference}\nreturn value if value is not None else fallback`,
  (reference: string, envReference: string) =>
    `return {"primary":${reference},"fallback":${envReference}}`,
  (reference: string, envReference: string) =>
    `values=[${reference},${envReference}]\nreturn values`,
  (reference: string, envReference: string) =>
    `if ${reference}:\n return ${envReference}\nreturn None`,
  (reference: string, envReference: string) =>
    `return ${reference} if ${reference} is not None else ${envReference}`,
  (reference: string, envReference: string) =>
    `value=await resolve(${reference})\nreturn value if value is not None else ${envReference}`,
  (reference: string, envReference: string) =>
    `for item in ${reference}:\n print(item)\nreturn ${envReference}`,
] as const

function extractPlaceholders(code: string): string[] {
  return code.match(createCombinedPattern()) ?? []
}

async function expectStableFormatting(
  code: string,
  language: FormattableCodeLanguage
): Promise<string> {
  const firstResult = await formatFunctionCode(code, language)

  expect(firstResult.error).toBeNull()
  expect(firstResult.changed).toBe(firstResult.code !== code)

  const secondResult = await formatFunctionCode(firstResult.code, language)
  expect(secondResult).toEqual({
    code: firstResult.code,
    changed: false,
    error: null,
  })

  return firstResult.code
}

function executeJavaScriptBody(code: string, input: unknown): unknown {
  const execute = new Function('input', code) as (value: unknown) => unknown
  return execute(structuredClone(input))
}

async function executeAsyncJavaScriptBody(code: string, input: unknown): Promise<unknown> {
  const execute = new Function('input', `return (async () => {${code}})();`) as (
    value: unknown
  ) => Promise<unknown>
  return execute(structuredClone(input))
}

describe('formatFunctionCode safety', () => {
  describe('JavaScript syntax corpus', () => {
    it.each(JAVASCRIPT_SYNTAX_CASES)('formats and stabilizes $name', async (testCase) => {
      const formattedCode = await expectStableFormatting(testCase.code, CodeLanguage.JavaScript)

      for (const fragment of testCase.preservedFragments ?? []) {
        expect(formattedCode).toContain(fragment)
      }
    })

    it.each(JAVASCRIPT_RUNTIME_CASES)('$name', async ({ code, input }: JavaScriptRuntimeCase) => {
      const expectedResult = executeJavaScriptBody(code, input)
      const formattedCode = await expectStableFormatting(code, CodeLanguage.JavaScript)

      expect(executeJavaScriptBody(formattedCode, input)).toEqual(expectedResult)
    })

    it('preserves async runtime behavior', async () => {
      const code =
        'const values=await Promise.all(input.values.map(async(value)=>await Promise.resolve(value*input.multiplier)));return values;'
      const input = { values: [1, 3, 5], multiplier: 4 }
      const expectedResult = await executeAsyncJavaScriptBody(code, input)
      const formattedCode = await expectStableFormatting(code, CodeLanguage.JavaScript)

      await expect(executeAsyncJavaScriptBody(formattedCode, input)).resolves.toEqual(
        expectedResult
      )
    })

    it.each([
      ['chained comparison', 'return left<value>right;', 'return left < value > right;'],
      [
        'logical comparison',
        'return left<value&&value>right;',
        'return left < value && value > right;',
      ],
      ['signed shifts', 'return (left<<bits)>>right;', 'return (left << bits) >> right;'],
      ['unsigned shift', 'return value>>>bits;', 'return value >>> bits;'],
    ])('keeps %s as JavaScript syntax', async (_name, code, expected) => {
      await expect(formatFunctionCode(code, CodeLanguage.JavaScript)).resolves.toEqual({
        code: expected,
        changed: code !== expected,
        error: null,
      })
    })
  })

  describe('Python syntax corpus', () => {
    it.each(PYTHON_SYNTAX_CASES)('formats and stabilizes $name', async (testCase) => {
      const formattedCode = await expectStableFormatting(testCase.code, CodeLanguage.Python)

      for (const fragment of testCase.preservedFragments ?? []) {
        expect(formattedCode).toContain(fragment)
      }
    })

    it.each([
      ['chained comparison', 'return left<value>right', 'return left < value > right'],
      ['signed shifts', 'return (left<<bits)>>right', 'return (left << bits) >> right'],
      ['less than or equal', 'return left<=value', 'return left <= value'],
    ])('keeps %s as Python syntax', async (_name, code, expected) => {
      await expect(formatFunctionCode(code, CodeLanguage.Python)).resolves.toEqual({
        code: expected,
        changed: code !== expected,
        error: null,
      })
    })
  })

  describe('Sim placeholder preservation', () => {
    it('preserves every JavaScript reference across varied grammar contexts', async () => {
      for (const [referenceIndex, reference] of WORKFLOW_REFERENCES.entries()) {
        const envReference = ENV_REFERENCES[referenceIndex % ENV_REFERENCES.length]

        for (const buildCode of JAVASCRIPT_REFERENCE_CONTEXTS) {
          const code = buildCode(reference, envReference)
          const formattedCode = await expectStableFormatting(code, CodeLanguage.JavaScript)

          expect(extractPlaceholders(formattedCode)).toEqual(extractPlaceholders(code))
        }
      }
    })

    it('preserves every Python reference across varied grammar contexts', async () => {
      for (const [referenceIndex, reference] of WORKFLOW_REFERENCES.entries()) {
        const envReference = ENV_REFERENCES[referenceIndex % ENV_REFERENCES.length]

        for (const buildCode of PYTHON_REFERENCE_CONTEXTS) {
          const code = buildCode(reference, envReference)
          const formattedCode = await expectStableFormatting(code, CodeLanguage.Python)

          expect(extractPlaceholders(formattedCode)).toEqual(extractPlaceholders(code))
        }
      }
    })

    it.each([
      [
        CodeLanguage.JavaScript,
        `const literal="<start.value> {{API_KEY}}";// <comment.value> {{COMMENT_ENV}}\nreturn \`prefix:\${literal}:<template.value>:{{TEMPLATE_ENV}}\`;`,
      ],
      [
        CodeLanguage.Python,
        'literal="<start.value> {{API_KEY}}"\n# <comment.value> {{COMMENT_ENV}}\nreturn f"prefix:{literal}:<template.value>:{{TEMPLATE_ENV}}"',
      ],
    ] as const)(
      'preserves placeholders inside strings, templates, and comments for %s',
      async (language, code) => {
        const formattedCode = await expectStableFormatting(code, language)

        expect(extractPlaceholders(formattedCode)).toEqual(extractPlaceholders(code))
      }
    )

    it.each([
      [
        CodeLanguage.JavaScript,
        `const collision='${COLLIDING_TOKEN}';return {collision,value:${COLLIDING_REFERENCE},env:{{TOKEN}}};`,
      ],
      [
        CodeLanguage.Python,
        `collision="${COLLIDING_TOKEN}"\nreturn {"collision":collision,"value":${COLLIDING_REFERENCE},"env":{{TOKEN}}}`,
      ],
    ] as const)('avoids placeholder-token collisions for %s', async (language, code) => {
      const formattedCode = await expectStableFormatting(code, language)

      expect(extractPlaceholders(formattedCode)).toEqual(extractPlaceholders(code))
      expect(formattedCode).toContain(COLLIDING_TOKEN)
    })

    it.each([CodeLanguage.JavaScript, CodeLanguage.Python] as const)(
      'restores a large mixed reference set for %s',
      async (language) => {
        const referenceCount = 512
        const entries = Array.from({ length: referenceCount }, (_, index) => [
          `<block-${index}.items[${index % 7}]>`,
          `{{ENV_${index}}}`,
        ])
        const code =
          language === CodeLanguage.JavaScript
            ? `return [${entries.flat().join(',')}];`
            : `return [${entries.flat().join(',')}]`

        const formattedCode = await expectStableFormatting(code, language)
        expect(extractPlaceholders(formattedCode)).toEqual(extractPlaceholders(code))
      }
    )
  })

  describe('fail-open behavior', () => {
    it.each([
      'if (',
      'const = 1',
      'return {',
      'const value = "unterminated',
      'function broken( {',
      'return /unterminated',
    ])('returns invalid JavaScript unchanged: %j', async (code) => {
      const result = await formatFunctionCode(code, CodeLanguage.JavaScript)

      expect(result.code).toBe(code)
      expect(result.changed).toBe(false)
      expect(result.error).toEqual(expect.any(String))
    })

    it.each([
      'if (',
      'def broken(',
      'return {"value":',
      'try:\n    run()',
      'value = "unterminated',
      'for item in:\n    pass',
    ])('returns invalid Python unchanged: %j', async (code) => {
      const result = await formatFunctionCode(code, CodeLanguage.Python)

      expect(result.code).toBe(code)
      expect(result.changed).toBe(false)
      expect(result.error).toEqual(expect.any(String))
    })
  })
})
