import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const R = "\x1b[0m",
  D = "\x1b[2m",
  G = "\x1b[32m",
  Y = "\x1b[33m",
  C = "\x1b[36m",
  B = "\x1b[34m";

export class Printer {
  private n = 0;
  constructor(private verbose: boolean) {}

  header(t: string) {
    console.log(`\n${C}━━━ ${t} ━━━${R}`);
  }
  info(t: string) {
    console.log(`${C}  ${t}${R}`);
  }
  success(t: string) {
    console.log(`${G}✅ ${t}${R}`);
  }
  divider() {
    console.log(`${D}${"─".repeat(60)}${R}`);
  }

  handleMessage(msg: SDKMessage): void {
    const type = (msg as any).type;
    if (type === "assistant") {
      for (const block of (msg as any).message?.content ?? []) {
        if (block.type === "text" && block.text?.trim()) {
          for (const line of block.text.trim().split("\n")) {
            if (line.trim()) console.log(`${G}│ ${line}${R}`);
          }
        } else if (block.type === "tool_use") {
          this.n++;
          this.tool(block.name, block.input);
        }
      }
    } else if (type === "tool_result" && this.verbose) {
      console.log(`${D}  → ${String((msg as any).output ?? "").slice(0, 150)}${R}`);
    }
  }

  private tool(name: string, input: Record<string, any>): void {
    const n = this.n;
    switch (name) {
      case "WebSearch":
        console.log(`${Y}[${n}] 🔍 Search: ${D}${input.query}${R}`);
        break;
      case "WebFetch":
        console.log(`${Y}[${n}] 🌐 Fetch:  ${D}${String(input.url).slice(0, 90)}${R}`);
        break;
      case "Bash":
        console.log(`${Y}[${n}] ⚡ Bash:   ${D}${String(input.command).slice(0, 90)}${R}`);
        break;
      case "Write":
        console.log(`${G}[${n}] ✍  Write:  ${B}${input.file_path}${R}`);
        break;
      case "Edit":
        console.log(`${G}[${n}] ✏  Edit:   ${B}${input.file_path}${R}`);
        break;
      case "Read":
        console.log(`${C}[${n}] 📖 Read:   ${D}${input.file_path}${R}`);
        break;
      case "Grep":
        console.log(`${C}[${n}] 🔎 Grep:   ${D}"${input.pattern}"${R}`);
        break;
      default:
        if (this.verbose) console.log(`${D}[${n}] ${name}${R}`);
    }
  }
}
