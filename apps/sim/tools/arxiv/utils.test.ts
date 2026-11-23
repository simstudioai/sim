import { describe, expect, it } from 'vitest'
import { parseArxivXML } from '@/tools/arxiv/utils'

const ENTRY = `<feed><entry>
  <id>http://arxiv.org/abs/1234.5678v1</id>
  <title>Q&amp;A over &lt;tables&gt; &amp;amp; &#8220;text&#x201D;</title>
  <summary>Bounds for n &gt; 2</summary>
  <author><name>Ana O&apos;Neil</name></author>
  <arxiv:comment>10 pages &amp; 3 figures</arxiv:comment>
  <arxiv:primary_category term="cs.CL"/>
</entry></feed>`

describe('parseArxivXML', () => {
  it('decodes XML entities in text fields exactly once', () => {
    const [paper] = parseArxivXML(ENTRY)

    expect(paper.title).toBe('Q&A over <tables> &amp; “text”')
    expect(paper.summary).toBe('Bounds for n > 2')
    expect(paper.authors).toEqual(["Ana O'Neil"])
    expect(paper.comment).toBe('10 pages & 3 figures')
  })
})
