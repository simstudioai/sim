#!/usr/bin/env python3
"""Translate English MDX docs to Russian using local Ollama LLM.

Usage:
  python3 scripts/i18n-translate-docs.py                        # translate all stale files
  python3 scripts/i18n-translate-docs.py --dry-run              # show what would be done
  python3 scripts/i18n-translate-docs.py --file introduction/index.mdx
  python3 scripts/i18n-translate-docs.py --file introduction/index.mdx --force
"""

import hashlib
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN_DIR = ROOT / "apps" / "docs" / "content" / "docs" / "en"
RU_DIR = ROOT / "apps" / "docs" / "content" / "docs" / "ru"
OLLAMA_MODEL = "qwen2.5:3b"

TRANSLATE_INSTRUCTIONS = """Ты — профессиональный переводчик технической документации.
Переведи следующий MDX-документ с английского на русский язык.

СТРОГИЕ ПРАВИЛА:
1. Выведи ТОЛЬКО перевод — без пояснений, без оригинального текста.
2. СОХРАНИ БЕЗ ПЕРЕВОДА:
   - YAML-ключи в frontmatter (title:, description: и т.д.) — переводи ТОЛЬКО значения после двоеточия
   - ВСЕ JSX/HTML-теги: <Card>, <Image>, <Callout>, <div>, <FAQ>, <Cards>, <video> и т.д.
   - JSX-атрибуты: src=, href=, alt=, className=, width=, height=, type= и т.д.
   - ВСЁ markdown-форматирование: **жирный**, [ссылки](url), # заголовки, `код`, ```блоки```
   - ВСЕ URL и пути к файлам
   - ВСЕ блоки кода (```...```) — содержимое оставь как есть
   - Название продукта "Sim" — сохрани как "Sim"
   - Плейсхолдеры: {name}, {{x}}, $1, %s
3. Переведи ТОЛЬКО читаемый текст:
   - Текст между HTML/JSX-тегами
   - Обычные абзацы
   - Текст элементов списка
   - Текст вопросов/ответов FAQ
   - Заголовки и описания карточек
   - Текст в Callout
4. Сохрани ТОЧНО такую же структуру, переносы строк, отступы.
5. Используй естественный, профессиональный русский язык в стиле технической документации.
6. НЕ добавляй "Вот перевод:" или подобные фразы. Только перевод.

Переведи следующий текст:"""


def ollama_translate(text: str) -> str:
    """Call Ollama to translate text."""
    prompt = f"{TRANSLATE_INSTRUCTIONS}\n\n{text}"
    proc = subprocess.run(
        ["ollama", "run", OLLAMA_MODEL, prompt],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Ollama error: {proc.stderr.strip()}")
    result = proc.stdout.strip()
    # Clean up common prefixes the model might add
    result = re.sub(
        r'^(Вот перевод:?\s*|Перевод:?\s*|Переведённый (MDX|документ):?\s*|```(?:mdx)?\s*)',
        '',
        result,
        flags=re.IGNORECASE,
    )
    result = re.sub(r'\s*```\s*$', '', result)
    return result


def md5_file(path: Path) -> str:
    return hashlib.md5(path.read_text(encoding="utf-8").encode()).hexdigest()


def translate_mdx(en_content: str) -> str:
    """Translate an MDX file, chunking large files by sections."""
    lines = en_content.split("\n")

    # For small/medium files (≤40 lines), translate whole
    if len(lines) <= 40:
        return ollama_translate(en_content)

    # For large files, chunk by ## headers
    chunks = []
    current = []

    for line in lines:
        if re.match(r'^##\s', line) and current:
            chunks.append("\n".join(current))
            current = [line]
        else:
            current.append(line)

    if current:
        chunks.append("\n".join(current))

    result_parts = []
    for i, chunk in enumerate(chunks):
        if _is_non_translatable(chunk):
            result_parts.append(chunk)
            continue

        print(f"      chunk {i+1}/{len(chunks)} ({len(chunk)} chars)...")
        try:
            translated = ollama_translate(chunk)
            result_parts.append(translated)
            time.sleep(0.2)
        except Exception as e:
            print(f"      ERROR on chunk {i+1}: {e}")
            result_parts.append(chunk)

    return "\n".join(result_parts)


def _is_non_translatable(text: str) -> bool:
    t = text.strip()
    if not t:
        return True
    if t == "---":
        return True
    if re.match(r'^import\s+', t):
        return True
    if re.match(r'^export\s+', t):
        return True
    return False


def find_stale_files() -> list[str]:
    stale = []
    for en_path in sorted(EN_DIR.rglob("*.mdx")):
        rel = en_path.relative_to(EN_DIR)
        ru_path = RU_DIR / rel
        if not ru_path.exists():
            stale.append(str(rel))
            continue
        if md5_file(en_path) != md5_file(ru_path):
            stale.append(str(rel))
    return stale


def translate_file(rel: str, dry_run: bool = False) -> bool:
    en_path = EN_DIR / rel
    ru_path = RU_DIR / rel
    en_content = en_path.read_text(encoding="utf-8")

    if dry_run:
        en_size = len(en_content)
        ru_size = ru_path.exists() and len(ru_path.read_text(encoding="utf-8")) or 0
        print(f"  [{rel}] EN:{en_size} RU:{ru_size}")
        return False

    nlines = len(en_content.split("\n"))
    print(f"  [{rel}] {len(en_content)} chars, {nlines} lines...", end=" ", flush=True)
    try:
        translated = translate_mdx(en_content)
    except Exception as e:
        print(f"ERROR: {e}")
        return False

    ru_path.parent.mkdir(parents=True, exist_ok=True)
    ru_path.write_text(translated, encoding="utf-8")
    print(f"✓ ({len(translated)} chars)")
    return True


def main():
    dry_run = "--dry-run" in sys.argv
    force = "--force" in sys.argv
    single_file = None

    for i, arg in enumerate(sys.argv):
        if arg == "--file" and i + 1 < len(sys.argv):
            single_file = sys.argv[i + 1]

    if single_file:
        files = [single_file]
    elif force:
        files = sorted(str(p.relative_to(EN_DIR)) for p in EN_DIR.rglob("*.mdx"))
    else:
        files = find_stale_files()

    label = "DRY RUN" if dry_run else "Processing"
    print(f"{label} {len(files)} files\n")

    success = 0
    fail = 0
    for rel in files:
        if translate_file(rel, dry_run=dry_run):
            success += 1
        else:
            fail += 1

    if not dry_run:
        print(f"\nDone. ✓{success}  ✗{fail}  total:{len(files)}")

if __name__ == "__main__":
    main()
