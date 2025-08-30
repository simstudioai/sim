#!/usr/bin/env node
/*
  Transform tool MDX FAQ sections to use fumadocs Accordions.

  - Scans all .mdx files in apps/docs/content/docs/tools
  - Ensures import { Accordion, Accordions } from "fumadocs-ui/components/accordion" is present
  - Replaces FAQ content with:
      {/** MANUAL-CONTENT-START:faq *\/}
      <Accordions type="single">
        <Accordion title="Question">
          ...content...
        </Accordion>
      </Accordions>
      {/** MANUAL-CONTENT-END *\/}

  Usage:
    node apps/docs/scripts/transform-faqs.js
    # or with a custom directory
    node apps/docs/scripts/transform-faqs.js /absolute/path/to/tools
*/
const fs = require("fs");
const path = require("path");

const logger = {
  info: (...args) => console.log("[transform-faqs]", ...args),
  warn: (...args) => console.warn("[transform-faqs]", ...args),
  error: (...args) => console.error("[transform-faqs]", ...args),
};

const DEFAULT_DIR = path.resolve(process.cwd(), "apps/docs/content/docs/tools");

const toolsDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : DEFAULT_DIR;

function readAllMdxFiles(targetDir) {
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readAllMdxFiles(full));
    } else if (entry.isFile() && full.endsWith(".mdx")) {
      files.push(full);
    }
  }
  return files;
}

function ensureAccordionImport(content) {
  const importLine = 'import { Accordion, Accordions } from "fumadocs-ui/components/accordion"';
  if (content.includes(importLine)) return content;

  // Find the last import line to insert after
  const importRegex = /^import\s.+?;?$/gm;
  let lastMatch = null;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    lastMatch = match;
  }
  if (lastMatch) {
    const insertPos = lastMatch.index + lastMatch[0].length;
    const before = content.slice(0, insertPos);
    const after = content.slice(insertPos);
    return `${before}\n${importLine}\n${after}`;
  }
  // If no imports found, insert after frontmatter (--- blocks), else at start
  const fmRegex = /^---[\s\S]*?---\n?/m;
  const fmMatch = content.match(fmRegex);
  if (fmMatch) {
    const insertPos = fmMatch.index + fmMatch[0].length;
    const before = content.slice(0, insertPos);
    const after = content.slice(insertPos);
    return `${before}${importLine}\n${after}`;
  }
  return `${importLine}\n${content}`;
}

function extractFaqRegion(content) {
  const faqHeadingRegex = /^##\s*FAQ\s*$/m;
  const startHeadingMatch = content.match(faqHeadingRegex);
  if (!startHeadingMatch) return null;

  const startHeadingIndex = startHeadingMatch.index + startHeadingMatch[0].length;

  const manualStartToken = "{/* MANUAL-CONTENT-START:faq */}";
  const manualEndToken = "{/* MANUAL-CONTENT-END */}";

  // Prefer manual markers if present after the FAQ heading
  const manualStartIdx = content.indexOf(manualStartToken, startHeadingIndex);
  const manualEndIdx = manualStartIdx >= 0 ? content.indexOf(manualEndToken, manualStartIdx) : -1;

  if (manualStartIdx >= 0 && manualEndIdx >= 0) {
    const regionStart = manualStartIdx + manualStartToken.length;
    const regionEnd = manualEndIdx;
    return {
      type: "manual",
      headingStart: startHeadingMatch.index,
      headingEnd: startHeadingIndex,
      regionStart,
      regionEnd,
      manualStartIdx,
      manualEndIdx,
    };
  }

  // Fallback: take until the next level-2 heading or end of file
  const rest = content.slice(startHeadingIndex);
  const nextH2Rel = rest.search(/^##\s+/m);
  const regionStart = startHeadingIndex;
  const regionEnd = nextH2Rel >= 0 ? startHeadingIndex + nextH2Rel : content.length;
  return {
    type: "implicit",
    headingStart: startHeadingMatch.index,
    headingEnd: startHeadingIndex,
    regionStart,
    regionEnd,
  };
}

function parseFaqSections(faqBody) {
  // Already converted?
  if (faqBody.includes("<Accordions") && faqBody.includes("<Accordion")) {
    return { alreadyConverted: true, sections: [] };
  }

  // Split by H3 headings (### )
  const lines = faqBody.split("\n");
  const sections = [];
  let currentTitle = null;
  let currentBuffer = [];

  function flush() {
    if (currentTitle !== null) {
      // Trim trailing empty lines in content, but keep original inner indentation
      while (currentBuffer.length > 0 && currentBuffer[currentBuffer.length - 1].trim() === "") {
        currentBuffer.pop();
      }
      const content = currentBuffer.join("\n");
      sections.push({ title: currentTitle.trim(), content });
    }
    currentTitle = null;
    currentBuffer = [];
  }

  for (const line of lines) {
    const h3Match = line.match(/^###\s+(.*)$/);
    if (h3Match) {
      flush();
      currentTitle = h3Match[1];
    } else {
      if (currentTitle === null) {
        // Content before first H3: ignore leading blank lines, otherwise treat as preface of first section
        if (line.trim() !== "") {
          // If there is content before any H3, create a generic section
          currentTitle = "FAQ";
          currentBuffer.push(line);
        }
      } else {
        currentBuffer.push(line);
      }
    }
  }
  flush();

  return { alreadyConverted: false, sections };
}

function escapeAttribute(value) {
  return value.replaceAll("\"", "&quot;");
}

function indentBlock(text, indentSpaces) {
  const indent = " ".repeat(indentSpaces);
  return text
    .split("\n")
    .map((line) => (line.length ? indent + line : line))
    .join("\n");
}

function buildAccordions(sections) {
  if (!sections || sections.length === 0) return null;
  const inner = sections
    .map((s) => {
      const title = escapeAttribute(s.title);
      const content = s.content || "";
      const indented = content ? "\n" + indentBlock(content, 4) + "\n" : "\n";
      return `  <Accordion title="${title}">${indented}  </Accordion>`;
    })
    .join("\n");
  return [
    "<Accordions type=\"single\">",
    inner,
    "</Accordions>",
  ].join("\n");
}

function transformFile(filePath) {
  const original = fs.readFileSync(filePath, "utf8");

  // Ensure the import exists first
  let content = ensureAccordionImport(original);

  const region = extractFaqRegion(content);
  if (!region) {
    logger.warn("No FAQ section found:", filePath);
    return { changed: content !== original, content };
  }

  const faqBody = content.slice(region.regionStart, region.regionEnd);
  const { alreadyConverted, sections } = parseFaqSections(faqBody);
  if (alreadyConverted) {
    logger.info("Already converted, skipping:", path.basename(filePath));
    return { changed: content !== original, content };
  }

  if (sections.length === 0) {
    logger.warn("No H3 sections found under FAQ, creating single accordion:", path.basename(filePath));
  }

  const accordions = buildAccordions(
    sections.length > 0 ? sections : [{ title: "FAQ", content: faqBody.trim() }]
  );

  const manualStartToken = "{/* MANUAL-CONTENT-START:faq */}";
  const manualEndToken = "{/* MANUAL-CONTENT-END */}";

  let newFaqBlock = `${manualStartToken}\n${accordions}\n${manualEndToken}`;

  let newContent;
  if (region.type === "manual") {
    newContent =
      content.slice(0, region.regionStart) +
      "\n" +
      accordions +
      "\n" +
      content.slice(region.regionEnd);
  } else {
    // Insert manual markers around the new accordions replacing the implicit region
    newContent =
      content.slice(0, region.regionStart) +
      "\n" +
      newFaqBlock +
      "\n" +
      content.slice(region.regionEnd);
  }

  return { changed: newContent !== original, content: newContent };
}

function main() {
  if (!fs.existsSync(toolsDir)) {
    logger.error("Directory not found:", toolsDir);
    process.exit(1);
  }
  const files = readAllMdxFiles(toolsDir);
  if (files.length === 0) {
    logger.warn("No .mdx files found in", toolsDir);
    return;
  }
  logger.info("Found", files.length, ".mdx files. Transforming...");

  let changedCount = 0;
  for (const file of files) {
    try {
      const { changed, content } = transformFile(file);
      if (changed) {
        fs.writeFileSync(file, content, "utf8");
        changedCount += 1;
        logger.info("Updated:", path.basename(file));
      } else {
        logger.info("No changes:", path.basename(file));
      }
    } catch (err) {
      logger.error("Failed to transform", file, err);
    }
  }
  logger.info("Done. Files changed:", changedCount);
}

main();


