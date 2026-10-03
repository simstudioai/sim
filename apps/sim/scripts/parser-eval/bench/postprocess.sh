#!/bin/bash
# Project Gutenberg no longer serves its Latin-1 (-8.txt) variants (404 on gutenberg.org and the pglaf mirror),
# so re-encode three UTF-8 books to ISO-8859-1 / windows-1252 (with a UTF-8 BOM variant too) for encoding-detection coverage.
BENCH="$(cd "$(dirname "$0")" && pwd)"; cd "$BENCH/files/txt" || exit 0
for id in 1342 84 2600; do
  [ -s "gutenberg__pg$id.txt" ] || continue
  [ -s "gutenberg_latin1__pg$id.txt" ] || iconv -f UTF-8 -t ISO-8859-1//TRANSLIT "gutenberg__pg$id.txt" > "gutenberg_latin1__pg$id.txt" 2>/dev/null || rm -f "gutenberg_latin1__pg$id.txt"
done
[ -s gutenberg__pg17989.txt ] && [ ! -s gutenberg_cp1252__pg17989.txt ] && iconv -f UTF-8 -t WINDOWS-1252//TRANSLIT gutenberg__pg17989.txt > gutenberg_cp1252__pg17989.txt 2>/dev/null
[ -s gutenberg__pg11.txt ] && [ ! -s gutenberg_bom__pg11.txt ] && { printf '\xef\xbb\xbf'; cat gutenberg__pg11.txt; } > gutenberg_bom__pg11.txt
cd "$BENCH/lists" && for f in ../files/txt/gutenberg_latin1__* ../files/txt/gutenberg_cp1252__* ../files/txt/gutenberg_bom__*; do [ -s "$f" ] && printf 'local-reencode\ttxt\t%s\tre-encoded from gutenberg.org UTF-8 (see NOTES.md)\n' "$(basename "$f")"; done > plan_reencoded.tsv
# Drop encrypted fixtures (reference extractors report them as password-protected) and drop non-PDF payloads
# (Git LFS pointers, git-annex symlinks, HTML error pages) that GitHub code search returns for "slides.pdf".
cd "$BENCH/files" || exit 0
for f in doc/poi__PasswordProtected.doc docx/poi__bug53475-password-is-solrcell.docx pdf/pdfplumber__password-example.pdf ppt/poi__Password_Protected-hello.ppt xlsb/poi__protected_passtika.xlsb xlsx/unstr__password_protected.xlsx; do rm -f "$f" "$BENCH/reference/$(basename "$f").json"; done
for f in pdf/*.pdf; do [ "$(head -c 4 "$f")" = "%PDF" ] || { echo "not a PDF: $f" >> "$BENCH/lists/removed_nonpdf.txt"; rm -f "$f" "$BENCH/reference/$(basename "$f").json"; }; done
