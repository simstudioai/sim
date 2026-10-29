import { ChevronRight } from '@sim/emcn/icons'
import { toArray, toRecord } from '@sim/utils/object'
import { CodeSample, Markdown } from '@/components/docs/markdown'
import { NeutralBadge } from '@/components/docs/primitives'
import { resolveReference } from '@/lib/content/openapi'

interface SchemaProps {
  schema: unknown
  document: Record<string, unknown>
  name?: string
  required?: boolean
  ancestors?: string[]
}
interface SchemaConstraintsProps {
  schema: Record<string, unknown>
}

function SchemaConstraints({ schema }: SchemaConstraintsProps) {
  const entries = [
    'format',
    'default',
    'const',
    'enum',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minLength',
    'maxLength',
    'pattern',
    'minItems',
    'maxItems',
    'uniqueItems',
    'minProperties',
    'maxProperties',
    'multipleOf',
    'nullable',
    'readOnly',
    'writeOnly',
  ].filter((key) => schema[key] !== undefined)
  return entries.length ? (
    <dl className='mt-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-docs-control'>
      {entries.map((key) => (
        <div key={key} className='contents'>
          <dt className='text-[var(--docs-muted)]'>{key}</dt>
          <dd className='min-w-0 break-words font-mono'>
            {typeof schema[key] === 'string' ? schema[key] : JSON.stringify(schema[key])}
          </dd>
        </div>
      ))}
    </dl>
  ) : null
}

/** Follows schemas on the server and makes recursive references explicit. */
export function ApiSchema({ schema: raw, document, name, required, ancestors = [] }: SchemaProps) {
  if (typeof raw === 'boolean')
    return (
      <p className='py-2 text-docs-control'>
        {raw ? 'Any value is accepted.' : 'No value is accepted.'}
      </p>
    )
  const original = toRecord(raw)
  const reference = typeof original.$ref === 'string' ? original.$ref : undefined
  if (reference && ancestors.includes(reference))
    return (
      <p className='py-2 text-[var(--docs-muted)] text-docs-control'>
        <code>{name}</code> references recursive schema <code>{reference.split('/').at(-1)}</code>.
        See the complete schema in the OpenAPI download.
      </p>
    )
  const next = reference ? [...ancestors, reference] : ancestors
  const schema = resolveReference(raw, document)
  const properties = Object.entries(toRecord(schema.properties))
  const requiredKeys = new Set(toArray(schema.required))
  const compositions = ['allOf', 'anyOf', 'oneOf'].filter((key) => Array.isArray(schema[key]))
  const nested =
    properties.length ||
    schema.items ||
    compositions.length ||
    typeof schema.additionalProperties === 'object'
  const type = Array.isArray(schema.type)
    ? schema.type.join(' | ')
    : typeof schema.type === 'string'
      ? schema.type
      : properties.length
        ? 'object'
        : (reference?.split('/').at(-1) ?? 'value')
  return (
    <div className='min-w-0 py-4'>
      {name && (
        <div className='mb-2 flex flex-wrap items-baseline gap-2 font-mono text-docs-control'>
          <span className='break-all text-[var(--docs-heading)]'>{name}</span>
          <span className='text-[var(--docs-muted)]'>{type}</span>
          {required && <span className='ml-auto text-[var(--docs-muted)]'>Required</span>}
          {schema.deprecated === true && <NeutralBadge>Deprecated</NeutralBadge>}
        </div>
      )}
      {typeof schema.description === 'string' && (
        <div className='text-[var(--docs-muted)] text-docs-table [&>p]:my-0 [&>p]:text-docs-table'>
          <Markdown>{schema.description}</Markdown>
        </div>
      )}
      <SchemaConstraints schema={schema} />
      {nested ? (
        <details open={!name} className='mt-3 [&[open]>summary>svg]:rotate-90'>
          <summary className='flex w-fit list-none items-center gap-2 rounded-md py-1 text-[var(--docs-muted)] text-docs-control focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] [&::-webkit-details-marker]:hidden'>
            <ChevronRight className='size-4 transition-transform' />
            {properties.length
              ? `${properties.length} ${properties.length === 1 ? 'field' : 'fields'}`
              : 'Schema details'}
          </summary>
          <div className='mt-1 min-w-0 border-[var(--docs-border)] border-l pl-4'>
            <div className='divide-y divide-[var(--docs-border)]'>
              {properties.map(([key, value]) => (
                <ApiSchema
                  key={key}
                  schema={value}
                  name={key}
                  required={requiredKeys.has(key)}
                  document={document}
                  ancestors={next}
                />
              ))}
            </div>
            {schema.items !== undefined && (
              <ApiSchema
                schema={schema.items}
                name='Array item'
                document={document}
                ancestors={next}
              />
            )}
            {compositions.map((key) => (
              <section key={key} className='mt-3'>
                <p className='text-[var(--docs-muted)] text-docs-control'>
                  {key === 'allOf' ? 'All of' : key === 'oneOf' ? 'Exactly one of' : 'Any of'}
                </p>
                {toArray(schema[key]).map((value, index) => (
                  <ApiSchema
                    key={`${key}-${index}`}
                    schema={value}
                    name={`Option ${index + 1}`}
                    document={document}
                    ancestors={next}
                  />
                ))}
              </section>
            ))}
            {typeof schema.additionalProperties === 'object' && (
              <ApiSchema
                schema={schema.additionalProperties}
                name='Additional properties'
                document={document}
                ancestors={next}
              />
            )}
          </div>
        </details>
      ) : null}
      {schema.additionalProperties === false && (
        <p className='mt-2 text-[var(--docs-muted)] text-docs-control'>
          Additional properties are not allowed.
        </p>
      )}
      {schema.example !== undefined && (
        <CodeSample title='Example' code={JSON.stringify(schema.example, null, 2)} />
      )}
    </div>
  )
}
