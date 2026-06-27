#!/usr/bin/env python3
"""MDX EN→RU translator. Tokenizes then translates text-only segments."""

import hashlib
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN = ROOT / "apps/docs/content/docs/en"
RU = ROOT / "apps/docs/content/docs/ru"
MODEL = "translategemma:latest"
API = "http://localhost:11434/api/generate"

TG = (
    "You are a professional English (en) to Russian (ru) translator. "
    "Accurately convey meaning while adhering to Russian grammar.\n"
    "Produce ONLY the Russian translation, no explanations, no commentary.\n"
    "DO NOT translate: product names (Extend, Sim, Slack, Gmail), "
    "code identifiers (`file`, `id`), technical values (string, json, number, Yes, No).\n"
    "Translate the following English text into Russian:\n\n\n"
)


def tr(txt: str) -> str:
    t = txt.strip()
    if not t or len(t) < 2:
        return txt
    data = json.dumps(
        {
            "model": MODEL,
            "prompt": TG + t,
            "stream": False,
            "options": {"num_predict": 200, "temperature": 0.1},
        }
    ).encode()
    try:
        req = urllib.request.Request(
            API, data=data, headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read()).get("response", "").strip()
    except:
        return txt


def tokenize(body: str) -> list[tuple[str, str]]:
    """Split MDX body into typed segments."""
    tokens = []
    i = 0
    n = len(body)
    while i < n:
        # Blank line
        if body[i] == "\n":
            j = i
            while j < n and body[j] == "\n":
                j += 1
            tokens.append(("blank", body[i:j]))
            i = j
            continue
        # Code block ```
        if body[i : i + 3] == "```":
            j = body.find("```", i + 3)
            j = j + 3 if j != -1 else n
            tokens.append(("code", body[i:j]))
            i = j
            continue
        # Inline code `
        if body[i] == "`":
            j = body.find("`", i + 1)
            j = j + 1 if j != -1 else i + 1
            tokens.append(("code", body[i:j]))
            i = j
            continue
        # JSX self-closing <Tag ... />
        m = re.match(r"<[A-Z]\w*[^>]*?/>", body[i:])
        if m:
            tokens.append(("jsx", m.group()))
            i += len(m.group())
            continue
        # JSX container
        m = re.match(r"<([A-Z]\w*)\b[^>]*>", body[i:])
        if m:
            tag = m.group(1)
            j = body.find(f"</{tag}>", i)
            if j != -1:
                j += len(f"</{tag}>")
                tokens.append(("jsx", body[i:j]))
                i = j
                continue
        # HTML
        m = re.match(r"<(div|br|img|hr|input|span)\b[^>]*/?>", body[i:])
        if m:
            tokens.append(("html", m.group()))
            i += len(m.group())
            continue
        m = re.match(r"<(div|span)\b[^>]*>.*?</\1>", body[i:], re.DOTALL)
        if m:
            tokens.append(("html", m.group()))
            i += len(m.group())
            continue
        # Import/export
        m = re.match(r"^(import|export)\s+.+$", body[i:], re.MULTILINE)
        if m:
            j = body.find("\n", i)
            j = j + 1 if j != -1 else n
            tokens.append(("import", body[i:j]))
            i = j
            continue
        # Table separator
        m = re.match(r"^\|[\s\-:|]+\|\s*$", body[i:], re.MULTILINE)
        if m:
            j = body.find("\n", i)
            j = j + 1 if j != -1 else n
            tokens.append(("table_sep", body[i:j]))
            i = j
            continue
        # Table row
        m = re.match(r"^\|.+\|$", body[i:], re.MULTILINE)
        if m:
            j = body.find("\n", i)
            j = j + 1 if j != -1 else n
            tokens.append(("table_row", body[i:j]))
            i = j
            continue
        # Heading
        m = re.match(r"^(#{1,6}\s).*$", body[i:], re.MULTILINE)
        if m:
            j = body.find("\n", i)
            j = j + 1 if j != -1 else n
            tokens.append(("heading", body[i:j]))
            i = j
            continue
        # List item
        m = re.match(r"^(\s*[-*]\s).*$", body[i:], re.MULTILINE)
        if m:
            j = body.find("\n", i)
            j = j + 1 if j != -1 else n
            tokens.append(("list_item", body[i:j]))
            i = j
            continue
        # Text line
        j = body.find("\n", i)
        j = j if j != -1 else n
        tokens.append(("text", body[i:j]))
        i = j
    return tokens


def _strip_code(line: str) -> str:
    """Remove inline code backticks from a line for translation, preserving code."""
    # Replace `...` with placeholder for translation, then restore
    codes = re.findall(r"`[^`\n]+`", line)
    for idx, c in enumerate(codes):
        line = line.replace(c, f"{{{{C{idx}}}}}")
    return line, codes


def _restore_code(line: str, codes: list[str]) -> str:
    for idx, c in enumerate(codes):
        line = line.replace(f"{{{{C{idx}}}}}", c)
    return line


def _translate_body(body: str) -> str:
    tokens = tokenize(body)
    out = []
    for typ, txt in tokens:
        if typ in ("code", "jsx", "html", "import", "table_sep", "blank"):
            out.append(txt)
        elif typ == "heading":
            m = re.match(r"^(#{1,6}\s)(.*)", txt)
            if m:
                prefix = m.group(1)
                h = m.group(2)
                clean, codes = _strip_code(h)
                if clean.strip() and re.search(r"[a-zA-Z]{2,}", clean):
                    trans = tr(clean.strip())
                    time.sleep(0.02)
                    out.append(f"{prefix}{_restore_code(trans, codes)}")
                else:
                    out.append(txt)
            else:
                out.append(txt)
        elif typ == "list_item":
            m = re.match(r"^(\s*[-*]\s)(.*)", txt)
            if m:
                prefix = m.group(1)
                lt = m.group(2)
                # Handle markdown link: [text](url)
                lm = re.match(r"^\[([^\]]*)\]\(([^)]+)\)$", lt.strip())
                if lm:
                    link_text = tr(lm.group(1))
                    time.sleep(0.02)
                    out.append(f"{prefix}[{link_text}]({lm.group(2)})")
                else:
                    clean, codes = _strip_code(lt)
                    if clean.strip() and re.search(r"[a-zA-Z]{2,}", clean):
                        trans = tr(clean.strip())
                        time.sleep(0.02)
                        out.append(f"{prefix}{_restore_code(trans, codes)}")
                    else:
                        out.append(txt)
            else:
                out.append(txt)
        elif typ == "table_row":
            cells = txt.split("|")
            tc = []
            for i, c in enumerate(cells):
                c = c.strip()
                if i == 0 or i == len(cells) - 1:
                    tc.append(c)
                elif c and re.search(r"[a-zA-Z]{2,}", c):
                    clean, codes = _strip_code(c)
                    trans = tr(clean) if clean.strip() else c
                    time.sleep(0.02)
                    tc.append(_restore_code(trans, codes))
                else:
                    tc.append(c)
            out.append("| " + " | ".join(tc) + " |")
        elif typ == "text":
            if re.search(r"[a-zA-Z]{3,}", txt):
                clean, codes = _strip_code(txt)
                if "](" in clean:
                    parts = re.split(r"(\[([^\]]*)\]\(([^)]+)\))", clean)
                    res = []
                    for p in parts:
                        m2 = re.match(r"^\[([^\]]*)\]\(([^)]+)\)$", p)
                        if m2:
                            res.append(f"[{tr(m2.group(1))}]({m2.group(2)})")
                            time.sleep(0.02)
                        elif p.strip():
                            res.append(tr(p))
                            time.sleep(0.02)
                        else:
                            res.append(p)
                    out.append(_restore_code("".join(res), codes))
                else:
                    out.append(_restore_code(tr(clean.strip()), codes))
                    time.sleep(0.02)
            else:
                out.append(txt)
    return "".join(out)


def translate_mdx(content: str) -> str:
    fm_match = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n(.*)", content, re.DOTALL)
    if not fm_match:
        return _translate_body(content)
    fm_raw = fm_match.group(1)
    body = fm_match.group(2)
    fm_lines = []
    for line in fm_raw.split("\n"):
        m = re.match(r"^(title|description):\s*(.+)", line)
        if m:
            fm_lines.append(f"{m.group(1)}: {tr(m.group(2))}")
            time.sleep(0.03)
        else:
            fm_lines.append(line)
    return "---\n" + "\n".join(fm_lines) + "\n---\n" + _translate_body(body)


def md5(p: Path) -> str:
    return hashlib.md5(p.read_text("utf-8").encode()).hexdigest()


def main():
    dry = "--dry-run" in sys.argv
    single = next(
        (sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == "--file"), None
    )
    files = (
        [single]
        if single
        else [
            str(p.relative_to(EN))
            for p in sorted(EN.rglob("*.mdx"))
            if not (RU / p.relative_to(EN)).exists()
            or md5(p) != md5(RU / p.relative_to(EN))
        ]
    )
    print(f"{'DRY RUN' if dry else 'Translating'} {len(files)} files (4 parallel workers)\n")
    ok = fail = 0

    if dry:
        for f in files:
            c = (EN / f).read_text("utf-8")
            rp = RU / f
            rs = len(rp.read_text("utf-8")) if rp.exists() else 0
            print(f"  [{f}] EN:{len(c)} RU:{rs}")
        return

    def process_one(f):
        c = (EN / f).read_text("utf-8")
        try:
            res = translate_mdx(c)
        except Exception as e:
            return (f, len(c), None, str(e))
        rp = RU / f
        rp.parent.mkdir(parents=True, exist_ok=True)
        rp.write_text(res, "utf-8")
        return (f, len(c), len(res), None)

    with ThreadPoolExecutor(max_workers=4) as ex:
        futures = {ex.submit(process_one, f): f for f in files}
        for fut in as_completed(futures):
            f, enc, resc, err = fut.result()
            if err:
                print(f"  [{f}] {enc}c ✗ {err}", flush=True)
                fail += 1
            else:
                print(f"  [{f}] {enc}c → {resc}c ✓", flush=True)
                ok += 1

    print(f"\nDone. ✓{ok} ✗{fail} total:{len(files)}")


if __name__ == "__main__":
    main()
