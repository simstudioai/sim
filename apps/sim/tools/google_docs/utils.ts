// Helper function to extract text content from Google Docs document structure
export function extractTextFromDocument(document: any): string {
  let text = ''

  if (!document.body || !document.body.content) {
    return text
  }

  // Process each structural element in the document
  for (const element of document.body.content) {
    if (element.paragraph) {
      for (const paragraphElement of element.paragraph.elements) {
        if (paragraphElement.textRun?.content) {
          text += paragraphElement.textRun.content
        }
      }
    } else if (element.table) {
      // Process tables if needed
      for (const tableRow of element.table.tableRows) {
        for (const tableCell of tableRow.tableCells) {
          if (tableCell.content) {
            for (const cellContent of tableCell.content) {
              if (cellContent.paragraph) {
                for (const paragraphElement of cellContent.paragraph.elements) {
                  if (paragraphElement.textRun?.content) {
                    text += paragraphElement.textRun.content
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return text
}
