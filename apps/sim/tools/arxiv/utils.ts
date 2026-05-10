import type { ArxivPaper } from '@/tools/arxiv/types'

export function parseArxivXML(xmlText: string): ArxivPaper[] {
  const papers: ArxivPaper[] = []

  // Extract entries using regex (since we don't have XML parser in this environment)
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
  let match

  while ((match = entryRegex.exec(xmlText)) !== null) {
    const entryXml = match[1]

    const paper: ArxivPaper = {
      id: extractXmlValue(entryXml, 'id')?.replace('http://arxiv.org/abs/', '') || '',
      title: cleanText(extractXmlValue(entryXml, 'title') || ''),
      summary: cleanText(extractXmlValue(entryXml, 'summary') || ''),
      authors: extractAuthors(entryXml),
      published: extractXmlValue(entryXml, 'published') || '',
      updated: extractXmlValue(entryXml, 'updated') || '',
      link: extractXmlValue(entryXml, 'id') || '',
      pdfLink: extractPdfLink(entryXml),
      categories: extractCategories(entryXml),
      primaryCategory: extractXmlAttribute(entryXml, 'arxiv:primary_category', 'term') || '',
      comment: extractXmlValue(entryXml, 'arxiv:comment'),
      journalRef: extractXmlValue(entryXml, 'arxiv:journal_ref'),
      doi: extractXmlValue(entryXml, 'arxiv:doi'),
    }

    papers.push(paper)
  }

  return papers
}

export function extractTotalResults(xmlText: string): number {
  const totalResultsMatch = xmlText.match(
    /<opensearch:totalResults[^>]*>(\d+)<\/opensearch:totalResults>/
  )
  return totalResultsMatch ? Number.parseInt(totalResultsMatch[1], 10) : 0
}

export function extractXmlValue(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\/${tagName}>`)
  const match = xml.match(regex)
  return match ? match[1].trim() : undefined
}

export function extractXmlAttribute(
  xml: string,
  tagName: string,
  attrName: string
): string | undefined {
  const regex = new RegExp(`<${tagName}[^>]*${attrName}="([^"]*)"[^>]*>`)
  const match = xml.match(regex)
  return match ? match[1] : undefined
}

export function extractAuthors(entryXml: string): string[] {
  const authors: string[] = []
  const authorRegex = /<author[^>]*>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/author>/g
  let match

  while ((match = authorRegex.exec(entryXml)) !== null) {
    authors.push(match[1].trim())
  }

  return authors
}

export function extractPdfLink(entryXml: string): string {
  const linkRegex = /<link[^>]*href="([^"]*)"[^>]*title="pdf"[^>]*>/
  const match = entryXml.match(linkRegex)
  return match ? match[1] : ''
}

export function extractCategories(entryXml: string): string[] {
  const categories: string[] = []
  const categoryRegex = /<category[^>]*term="([^"]*)"[^>]*>/g
  let match

  while ((match = categoryRegex.exec(entryXml)) !== null) {
    categories.push(match[1])
  }

  return categories
}

export function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
