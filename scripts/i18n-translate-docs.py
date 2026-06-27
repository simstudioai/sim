#!/usr/bin/env python3
"""MDX EN→RU translator. Batch-translates all texts in one file via single API call."""
import hashlib, json, re, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN = ROOT / "apps/docs/content/docs/en"
RU = ROOT / "apps/docs/content/docs/ru"
MODEL = "translategemma:latest"
API = "http://localhost:11434/api/generate"
SEP = "\n===\n"

TG_BATCH = (
    "You are a professional English (en) to Russian (ru) translator. "
    "Translate each text segment below separated by '==='. "
    "Output translations in the SAME order, separated by '==='. "
    "DO NOT add any other text, explanations, or numbering.\n\n"
)
TG_SINGLE = (
    "You are a professional English (en) to Russian (ru) translator. "
    "Translate the following text to Russian. "
    "Output ONLY the translation, nothing else.\n\n"
)

def tr(txt: str) -> str:
    t = txt.strip()
    if not t or len(t) < 2: return txt
    data = json.dumps({"model": MODEL, "prompt": TG_BATCH + t, "stream": False,
                       "options": {"num_predict": 4096, "temperature": 0.1}}).encode()
    try:
        req = urllib.request.Request(API, data=data, headers={"Content-Type":"application/json"})
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read()).get("response", "").strip()
    except: return txt

def translate_mdx(content: str) -> str:
    fm_match = re.match(r'^---\r?\n(.*?)\r?\n---\r?\n(.*)', content, re.DOTALL)
    if fm_match:
        fm_raw = fm_match.group(1); body = fm_match.group(2)
        fml = []
        for line in fm_raw.split("\n"):
            m = re.match(r'^(title|description):\s*(.+)', line)
            if m:
                # Single-segment translate for frontmatter (never batched)
                key, val = m.group(1), m.group(2)
                data = json.dumps({"model": MODEL, "prompt": TG_SINGLE + val, "stream": False,
                                   "options": {"num_predict": 128, "temperature": 0.1}}).encode()
                try:
                    req = urllib.request.Request(API, data=data, headers={"Content-Type":"application/json"})
                    with urllib.request.urlopen(req, timeout=120) as r:
                        tval = json.loads(r.read()).get("response", "").strip()
                    fml.append(f"{key}: {tval}")
                except: fml.append(line)
            else: fml.append(line)
        fm = "---\n" + "\n".join(fml) + "\n---\n"
    else:
        body = content; fm = ""

    # Collect all translatable text segments
    texts = []
    placeholders = []

    def add_text(t):
        if t.strip() and re.search(r'[a-zA-Z]{3,}', t.strip()):
            clean = re.sub(r'`[^`\n]+`', lambda m: f"{{C{len(placeholders)}:d}}", t.strip())
            for c in re.findall(r'`[^`\n]+`', t.strip()):
                placeholders.append(c)
            texts.append(clean)
        else:
            texts.append(None)

    # Scan body for sections to translate
    # Protect code/jsx/imports, collect text
    segments = []
    i = 0; n = len(body)
    while i < n:
        # Code block
        if body[i:i+3] == '```':
            j = body.find('```', i+3); j = j+3 if j!=-1 else n
            segments.append(('code', body[i:j])); i = j; continue
        # Inline code
        if body[i] == '`':
            j = body.find('`', i+1); j = j+1 if j!=-1 else i+1
            segments.append(('code', body[i:j])); i = j; continue
        # JSX
        m = re.match(r'<[A-Z]\w*[^>]*?/>', body[i:])
        if m: segments.append(('code', m.group())); i+=len(m.group()); continue
        m = re.match(r'<([A-Z]\w*)\b[^>]*>', body[i:])
        if m:
            tag=m.group(1); j=body.find(f'</{tag}>',i)
            if j!=-1: j+=len(f'</{tag}>'); segments.append(('code',body[i:j])); i=j; continue
        # HTML
        m = re.match(r'<(div|br|img|hr|input|span)\b[^>]*/?>', body[i:])
        if m: segments.append(('code',m.group())); i+=len(m.group()); continue
        m = re.match(r'<(div|span)\b[^>]*>.*?</\1>', body[i:], re.DOTALL)
        if m: segments.append(('code',m.group())); i+=len(m.group()); continue
        # Import/export
        if re.match(r'^(import|export)\s', body[i:]):
            j=body.find('\n',i); j=j+1 if j!=-1 else n
            segments.append(('code',body[i:j])); i=j; continue
        # Blank
        if body[i] == '\n':
            j=i; 
            while j<n and body[j]=='\n': j+=1
            segments.append(('blank',body[i:j])); i=j; continue
        # Line
        j=body.find('\n',i); j=j if j!=-1 else n
        line = body[i:j]
        if re.match(r'^\|[\s\-:|]+\|', line):  # table sep
            segments.append(('code', line)); i=j; continue
        if line.strip():
            segments.append(('text', line)); i=j
        else:
            segments.append(('blank', line)); i=j

    # Collect texts for batch translation
    batch_texts = []
    for typ, txt in segments:
        if typ == 'text':
            batch_texts.append(txt.strip())
            texts.append(len(batch_texts) - 1)  # index into batch
        else:
            texts.append(None)

    # Batch translate
    if batch_texts:
        batch_input = SEP.join(batch_texts)
        batch_output = tr(batch_input)
        translations = [t.strip() for t in batch_output.split(SEP)]
        # Pad if mismatch
        while len(translations) < len(batch_texts):
            translations.append(batch_texts[len(translations)])
        translations = translations[:len(batch_texts)]
    else:
        translations = []

    # Reassemble
    result_parts = []
    ti = 0
    for typ, txt in segments:
        if typ == 'text':
            trans = translations[texts[ti]] if texts[ti] is not None else txt
            # Restore inline code placeholders
            for pi, ph in enumerate(placeholders):
                trans = trans.replace(f"{{C{pi}}}", ph)
            result_parts.append(trans + "\n")
        elif typ == 'blank':
            result_parts.append(txt)
        else:
            result_parts.append(txt + "\n" if not txt.endswith('\n') else txt)
        ti += 1

    return fm + "".join(result_parts)


def md5(p: Path) -> str:
    return hashlib.md5(p.read_text("utf-8").encode()).hexdigest()

def main():
    dry = "--dry-run" in sys.argv
    single = next((sys.argv[i+1] for i,a in enumerate(sys.argv) if a=="--file"), None)
    files = [single] if single else [
        str(p.relative_to(EN)) for p in sorted(EN.rglob("*.mdx"))
        if not (RU/p.relative_to(EN)).exists() or md5(p)!=md5(RU/p.relative_to(EN))
    ]
    print(f"{'DRY RUN' if dry else 'Translating'} {len(files)} files (8 workers, batched)\n")
    ok=fail=0

    if dry:
        for f in files:
            c=(EN/f).read_text("utf-8"); rp=RU/f
            rs=len(rp.read_text("utf-8")) if rp.exists() else 0
            print(f"  [{f}] EN:{len(c)} RU:{rs}")
        return

    def process_one(f):
        c=(EN/f).read_text("utf-8")
        try: res=translate_mdx(c)
        except Exception as e: return (f,len(c),None,str(e))
        rp=RU/f; rp.parent.mkdir(parents=True,exist_ok=True); rp.write_text(res,"utf-8")
        return (f,len(c),len(res),None)

    with ThreadPoolExecutor(max_workers=8) as ex:
        futures={ex.submit(process_one,f):f for f in files}
        for fut in as_completed(futures):
            f,enc,resc,err=fut.result()
            if err: print(f"  [{f}] {enc}c ✗ {err}", flush=True); fail+=1
            else: print(f"  [{f}] {enc}c → {resc}c ✓", flush=True); ok+=1

    print(f"\nDone. ✓{ok} ✗{fail} total:{len(files)}")

if __name__ == "__main__":
    main()
