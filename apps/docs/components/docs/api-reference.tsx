import { toArray, toRecord } from '@sim/utils/object'
import { ApiSchema } from '@/components/docs/api-schema'
import { CodeSample, Markdown } from '@/components/docs/markdown'
import { MethodBadge, NeutralBadge } from '@/components/docs/primitives'
import { SamplePanels } from '@/components/docs/sample-panels'
import { CopyButton } from '@/components/ui/copy-button'
import { Tab, Tabs } from '@/components/ui/tabs'
import {
  getOperationSpec,
  requestSamples,
  resolveReference,
  resolveSchema,
  responseSamples,
} from '@/lib/content/openapi'
import type { OperationReference } from '@/lib/content/types'

interface ApiReferenceProps {
  reference: OperationReference
}
interface MediaContentProps {
  content: unknown
  document: Record<string, unknown>
  prefix: string
}

function MediaContent({ content, document, prefix }: MediaContentProps) {
  const entries = Object.entries(toRecord(content))
  const panels = entries.map(([type, raw]) => {
    const media = toRecord(raw)
    return (
      <Tab key={type} value={type}>
        {media.schema !== undefined && <ApiSchema schema={media.schema} document={document} />}
        {media.example !== undefined && (
          <CodeSample
            title='Example'
            language={type.includes('json') ? 'json' : 'text'}
            code={
              typeof media.example === 'string'
                ? media.example
                : JSON.stringify(media.example, null, 2)
            }
          />
        )}
        {Object.entries(toRecord(media.examples)).map(([name, value]) => {
          const example = resolveReference(value, document)
          return (
            <section key={name} className='mt-4'>
              <h4 className='text-docs-control'>
                {typeof example.summary === 'string' ? example.summary : name}
              </h4>
              {typeof example.description === 'string' && (
                <Markdown>{example.description}</Markdown>
              )}
              {example.value !== undefined && (
                <CodeSample
                  language={type.includes('json') ? 'json' : 'text'}
                  code={
                    typeof example.value === 'string'
                      ? example.value
                      : JSON.stringify(example.value, null, 2)
                  }
                />
              )}
              {typeof example.externalValue === 'string' && (
                <a
                  href={example.externalValue}
                  className='text-[var(--docs-link)] text-docs-control'
                >
                  Read external example
                </a>
              )}
            </section>
          )
        })}
        {media.encoding !== undefined && (
          <CodeSample title='Encoding' code={JSON.stringify(media.encoding, null, 2)} />
        )}
      </Tab>
    )
  })
  return entries.length ? (
    <Tabs items={entries.map(([type]) => type)} aria-label={`${prefix} content type`}>
      {panels}
    </Tabs>
  ) : (
    <p className='my-3 text-[var(--docs-muted)] text-docs-control'>No response body.</p>
  )
}

export function ApiReference({ reference }: ApiReferenceProps) {
  const document = getOperationSpec(reference)
  const operation = reference.operation
  const schemes = toRecord(toRecord(document.components).securitySchemes)
  const security = toArray(operation.security ?? document.security)
  const request = resolveReference(operation.requestBody, document)
  const parameters = toArray(operation.parameters).map((parameter) =>
    resolveReference(parameter, document)
  )
  const statuses = Object.entries(toRecord(operation.responses))
  return (
    <div className='min-w-0 space-y-8'>
      <div className='flex min-w-0 items-center gap-3'>
        <MethodBadge method={reference.method} />
        <code className='min-w-0 flex-1 break-all font-mono text-docs-control'>
          {reference.path}
        </code>
        <CopyButton text={reference.path} />
      </div>
      {operation.deprecated === true && <NeutralBadge>Deprecated operation</NeutralBadge>}
      {typeof operation.description === 'string' &&
        operation.description !== operation['x-sim-docs-intro'] && (
          <Markdown>{operation.description}</Markdown>
        )}
      <span id='authorization' className='block' />
      <section id='authentication'>
        <h2 className='mb-3 font-medium text-[var(--docs-heading)] text-docs-h3'>Authentication</h2>
        {security.length ? (
          <div className='space-y-3'>
            {security.map((item, index) => (
              <div key={`security-${index}`}>
                {index > 0 && (
                  <p className='my-2 text-[var(--docs-muted)] text-docs-caption'>Alternatively</p>
                )}
                {Object.entries(toRecord(item)).length ? (
                  Object.entries(toRecord(item)).map(([name, scopes]) => {
                    const scheme = resolveReference(schemes[name], document)
                    return (
                      <div key={name} className='space-y-2 text-docs-table'>
                        <div className='[&>p]:my-0 [&>p]:text-docs-table'>
                          <Markdown>
                            {typeof scheme.description === 'string'
                              ? scheme.description
                              : name === 'apiKey'
                                ? 'API key'
                                : name === 'oauthBearer'
                                  ? 'OAuth access token'
                                  : name}
                          </Markdown>
                        </div>
                        {scheme.type === 'apiKey' && (
                          <p>
                            Send <code className='font-mono'>{String(scheme.name)}</code> in the
                            request {String(scheme.in)}.
                          </p>
                        )}
                        {(scheme.type === 'oauth2' || scheme.scheme === 'bearer') && (
                          <p>
                            <code className='break-all font-mono'>
                              Authorization: Bearer YOUR_ACCESS_TOKEN
                            </code>
                          </p>
                        )}
                        {toArray(scopes).length > 0 && (
                          <p>
                            Required scopes: <code>{toArray(scopes).join(', ')}</code>
                          </p>
                        )}
                        {scheme.flows !== undefined && (
                          <details>
                            <summary className='text-docs-control'>OAuth flows</summary>
                            <CodeSample code={JSON.stringify(scheme.flows, null, 2)} />
                          </details>
                        )}
                      </div>
                    )
                  })
                ) : (
                  <p className='text-docs-table'>Anonymous access is permitted.</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className='text-docs-table'>No authentication required.</p>
        )}
        {typeof operation['x-oauth-scope'] === 'string' && (
          <p className='mt-3 text-docs-table'>
            OAuth scope: <code>{operation['x-oauth-scope']}</code>.
          </p>
        )}
      </section>
      {['path', 'query', 'header', 'cookie'].map((location) => {
        const fields = parameters.filter((parameter) => parameter.in === location)
        return fields.length ? (
          <section key={location} id={`${location}-parameters`}>
            <span id={`parameters-${location}`} className='block' />
            <h2 className='mb-3 font-medium text-[var(--docs-heading)] text-docs-h2'>
              {location[0].toUpperCase() + location.slice(1)} parameters
            </h2>
            <div className='divide-y divide-[var(--docs-border)]'>
              {fields.map((parameter) => (
                <div key={String(parameter.name)}>
                  <ApiSchema
                    name={String(parameter.name)}
                    required={parameter.required === true}
                    schema={{
                      ...resolveReference(parameter.schema, document),
                      description: parameter.description ?? toRecord(parameter.schema).description,
                      deprecated: parameter.deprecated,
                    }}
                    document={document}
                  />
                  {parameter.content !== undefined && (
                    <MediaContent
                      content={parameter.content}
                      document={document}
                      prefix={String(parameter.name)}
                    />
                  )}
                  {parameter.example !== undefined && (
                    <CodeSample title='Example' code={JSON.stringify(parameter.example, null, 2)} />
                  )}
                </div>
              ))}
            </div>
          </section>
        ) : null
      })}
      {operation.requestBody !== undefined && (
        <section id='request-body'>
          <h2 className='mb-3 font-medium text-[var(--docs-heading)] text-docs-h2'>Request body</h2>
          {request.required === true && <NeutralBadge>Required</NeutralBadge>}
          {typeof request.description === 'string' && <Markdown>{request.description}</Markdown>}
          <MediaContent content={request.content} document={document} prefix='Request' />
        </section>
      )}
      {typeof operation['x-sim-docs-details'] === 'string' && (
        <section id='behavior'>
          <h2 className='mb-3 font-medium text-[var(--docs-heading)] text-docs-h2'>Behavior</h2>
          <Markdown>{operation['x-sim-docs-details']}</Markdown>
        </section>
      )}
      <span id='response-body' className='block' />
      <section id='responses'>
        <h2 className='mb-3 font-medium text-[var(--docs-heading)] text-docs-h2'>Responses</h2>
        <Tabs items={statuses.map(([status]) => status)} aria-label='Response status'>
          {statuses.map(([status, value]) => {
            const response = resolveReference(value, document)
            return (
              <Tab key={status} value={status} id={`response-${status}`}>
                <h3 className='sr-only'>{status}</h3>
                {typeof response.description === 'string' && (
                  <Markdown>{response.description}</Markdown>
                )}
                <MediaContent
                  content={response.content}
                  document={document}
                  prefix={`${status} response`}
                />
                {Object.keys(toRecord(response.headers)).length > 0 && (
                  <section>
                    <h4 className='font-medium text-docs-control'>Response headers</h4>
                    <div className='divide-y divide-[var(--docs-border)]'>
                      {Object.entries(toRecord(response.headers)).map(([name, raw]) => {
                        const header = resolveReference(raw, document)
                        return (
                          <ApiSchema
                            key={name}
                            name={name}
                            schema={{
                              ...resolveReference(header.schema, document),
                              description: header.description,
                            }}
                            document={document}
                          />
                        )
                      })}
                    </div>
                  </section>
                )}
                {response.links !== undefined && (
                  <CodeSample
                    title='Response links'
                    code={JSON.stringify(resolveSchema(response.links, document), null, 2)}
                  />
                )}
              </Tab>
            )
          })}
        </Tabs>
      </section>
      {operation.callbacks !== undefined && (
        <section id='callbacks'>
          <h2 className='font-medium text-docs-h2'>Callbacks</h2>
          <CodeSample
            code={JSON.stringify(resolveSchema(operation.callbacks, document), null, 2)}
          />
        </section>
      )}
    </div>
  )
}

export function ApiExamples({ reference }: ApiReferenceProps) {
  const samples = requestSamples(reference)
  const responses = responseSamples(reference)
  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <SamplePanels
        label='Request'
        presentation={samples.length > 3 ? 'select' : 'tabs'}
        items={samples.map((sample, index) => ({
          value: sample.label,
          label: sample.label,
          id: `request-example-${index + 1}`,
          copyText: sample.code,
          panel: <CodeSample frameless language={sample.language} code={sample.code} />,
        }))}
      />
      <SamplePanels
        label='Response'
        presentation='select'
        items={responses.map((sample, index) => ({
          value: sample.label,
          label: sample.label,
          id: `response-example-${index + 1}`,
          copyText: sample.code,
          panel: sample.code ? (
            <CodeSample frameless language={sample.language} code={sample.code} />
          ) : (
            <p className='text-[var(--docs-muted)] text-docs-control'>No response body.</p>
          ),
        }))}
      />
      <a
        href='/openapi.json'
        className='block text-[var(--docs-muted)] text-docs-control hover:text-[var(--docs-link)]'
      >
        OpenAPI document ↗<span className='mt-1 block'>Download the specification</span>
      </a>
    </div>
  )
}
