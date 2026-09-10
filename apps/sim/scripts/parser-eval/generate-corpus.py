"""Builds the Tier A ground-truth corpus: markdown sources, per-document specs, and renders.

Usage: python generate-corpus.py <corpus-dir> <pandoc-typst-engine-path>
"""
import json, os, random, subprocess, sys, textwrap, re

OUT = sys.argv[1]
TYPST = sys.argv[2]
SRC = os.path.join(OUT, 'sources'); SPEC = os.path.join(OUT, 'spec'); FILES = os.path.join(OUT, 'files')
for d in (SRC, SPEC, FILES): os.makedirs(d, exist_ok=True)
rng = random.Random(20260909)

ADJ = ['quarterly', 'revised', 'preliminary', 'consolidated', 'regional', 'automated', 'legacy', 'provisional', 'audited', 'internal']
NOUN = ['forecast', 'rollout', 'migration', 'audit', 'procurement plan', 'onboarding checklist', 'incident review', 'budget', 'vendor assessment', 'compliance summary', 'capacity model', 'retention policy']
VERB = ['approved', 'deferred', 'escalated', 're-baselined', 'published', 'withdrawn', 'ratified', 'archived', 'flagged', 'consolidated']
TEAM = ['Platform', 'Finance', 'Security', 'Operations', 'Legal', 'Support', 'Data', 'Infrastructure']
TOPIC = ['the Lisbon data center', 'the EU billing entity', 'the SSO cutover', 'the vendor renewal', 'the Q3 hiring plan', 'the customer export pipeline', 'the ISO 27001 surveillance audit', 'the warehouse lease', 'the API deprecation', 'the on-call rotation']
TAIL = [
  'Stakeholders should review the attached appendix before the next checkpoint.',
  'No customer-facing change is expected until the second phase completes.',
  'The owning team retains sign-off authority for scope changes above 5%.',
  'Historical figures were restated to align with the new cost allocation model.',
  'A rollback path exists and was rehearsed twice during the dry run.',
  'Open questions are tracked in the shared register and reviewed weekly.',
  'This supersedes the guidance circulated on 14 March and applies immediately.',
  'Latency stayed under the 250 ms objective for 99.4% of sampled requests.',
  'The estimate carries a ±12% margin because three quotes are still outstanding.',
  'Exceptions require written approval from a director or above.',
]
used = set()
def sentence(i):
  while True:
    s = f"The {rng.choice(ADJ)} {rng.choice(NOUN)} for {rng.choice(TOPIC)} was {rng.choice(VERB)} on {rng.randint(1,28)} {rng.choice(['January','February','April','June','August','October','November'])} by the {rng.choice(TEAM)} team."
    if s not in used:
      used.add(s); return s
def paragraph(n=3):
  first = sentence(0)
  rest = rng.sample(TAIL, n-1)
  return first, ' '.join([first] + rest)

def money(): return f"${rng.randint(10,990)},{rng.randint(100,999)}.{rng.randint(10,99)}"

class Doc:
  def __init__(self, name, title):
    self.name, self.title = name, title
    self.md = [f"# {title}", ""]
    self.paragraphs, self.sentinels, self.headings, self.list_items, self.tables, self.code = [], [], [], [], [], []
  def h(self, level, text):
    self.md += ['#' * level + ' ' + text, '']; self.headings.append(text)
  def p(self, n=3, text=None):
    if text is None:
      first, text = paragraph(n); self.sentinels.append(first)
    else:
      self.sentinels.append(text.split('. ')[0] + ('.' if '. ' in text else ''))
    self.md += [text, '']; self.paragraphs.append(text)
  def ul(self, items, ordered=False, nested=None):
    for i, it in enumerate(items):
      self.md.append((f"{i+1}. " if ordered else "- ") + it); self.list_items.append(it)
      if nested and i == 1:
        for sub in nested:
          self.md.append("    - " + sub); self.list_items.append(sub)
    self.md.append('')
  def table(self, header, rows):
    self.md.append('| ' + ' | '.join(header) + ' |'); self.md.append('|' + '---|' * len(header))
    for r in rows: self.md.append('| ' + ' | '.join(str(c) for c in r) + ' |')
    self.md.append(''); self.tables.append({'header': header, 'rows': [[str(c) for c in r] for r in rows]})
  def codeblock(self, lang, code):
    self.md += [f"```{lang}", code, "```", '']; self.code.append(code)
  def quote(self, text):
    self.md += ['> ' + text, '']; self.paragraphs.append(text); self.sentinels.append(text)
  def write(self):
    md = '\n'.join(self.md)
    with open(os.path.join(SRC, self.name + '.md'), 'w') as f: f.write(md)
    order_pairs = [[a, b] for a, b in zip(self.sentinels, self.sentinels[1:])]
    adjacency = []
    for t in self.tables:
      for r in [t['header']] + t['rows']:
        for a, b in zip(r, r[1:]):
          if len(a) >= 2 and len(b) >= 2 and a != b: adjacency.append([a, b])
    spec = dict(name=self.name, title=self.title, headings=self.headings, paragraphs=self.paragraphs,
                sentinels=self.sentinels, order_pairs=order_pairs, list_items=self.list_items,
                tables=self.tables, table_adjacency=adjacency, code=self.code)
    with open(os.path.join(SPEC, self.name + '.json'), 'w') as f: json.dump(spec, f, indent=1, ensure_ascii=False)
    return spec

docs = []
# 1 memo
d = Doc('memo', 'Memo: Office Relocation Timeline'); d.p(); d.p(2); d.ul(['Confirm desk allocations by Friday', 'Return badge access forms to Facilities', 'Label equipment with the asset tag before Tuesday']); d.p(); docs.append(d)
# 2 SOP
d = Doc('sop-access-review', 'Standard Operating Procedure: Quarterly Access Review')
d.h(2, 'Purpose'); d.p(); d.h(2, 'Scope'); d.p(2); d.h(2, 'Procedure')
d.ul(['Export the entitlement report from the identity provider', 'Send each manager the list of direct reports and their roles', 'Record approvals or revocations in the review tracker', 'Close the review and archive the evidence bundle'], ordered=True)
d.h(2, 'Roles'); d.table(['Role', 'Responsibility', 'Escalation contact'], [['Reviewer', 'Confirms each entitlement is still required', 'Security Operations'], ['System owner', 'Removes revoked access within 5 business days', 'Platform lead'], ['Auditor', 'Samples 10% of closed reviews', 'Compliance manager']])
d.h(2, 'Records'); d.p(); docs.append(d)
# 3 quarterly report (long)
d = Doc('quarterly-report', 'Q2 FY26 Operating Review')
d.h(2, 'Executive summary'); d.p(4); d.p(3); d.p(3)
d.h(2, 'Revenue by region'); d.table(['Region', 'Q1 revenue', 'Q2 revenue', 'Change'], [[r, money(), money(), f"{rng.randint(-9,22)}%"] for r in ['North America', 'EMEA', 'APAC', 'LATAM']]); d.p(3)
d.h(2, 'Cost structure'); d.p(3); d.h(3, 'Headcount'); d.p(2); d.table(['Department', 'Headcount', 'Open roles'], [[t, rng.randint(8,120), rng.randint(0,9)] for t in TEAM]); d.h(3, 'Infrastructure'); d.p(3); d.p(3)
d.h(2, 'Risks and mitigations'); d.p(3); d.ul(['Currency exposure on EUR-denominated contracts', 'Single-vendor dependency for GPU capacity', 'Attrition in the Support organization above 14%'])
d.h(2, 'Outlook'); d.p(4); d.p(3); d.p(3); docs.append(d)
# 4 FAQ
d = Doc('faq-benefits', 'Employee Benefits FAQ')
for q in ['When does coverage begin?', 'Can I add a dependent mid-year?', 'How is the commuter allowance taxed?', 'What happens to unused leave?', 'Who do I contact about a claim?']:
  d.h(3, q); d.p(2)
docs.append(d)
# 5 meeting notes
d = Doc('meeting-notes', 'Weekly Platform Sync — 2 September')
d.h(2, 'Attendees'); d.ul(['Priya (chair)', 'Marcus', 'Lena', 'Tomasz']); d.h(2, 'Discussion'); d.p(3); d.p(2); d.p(3)
d.h(2, 'Action items'); d.table(['Owner', 'Action', 'Due'], [['Marcus', 'Draft the rollback runbook', '9 Sep'], ['Lena', 'Confirm vendor SLA credits', '12 Sep'], ['Tomasz', 'Re-run the load test at 2x traffic', '16 Sep']]); docs.append(d)
# 6 contract
d = Doc('contract', 'Master Services Agreement')
d.p(text='This Master Services Agreement (the "Agreement") is entered into as of 1 July 2026 between Acme Holdings Ltd ("Provider") and Northwind Traders GmbH ("Customer").')
for i, t in enumerate(['Definitions', 'Services', 'Fees and Payment', 'Term and Termination', 'Confidentiality', 'Limitation of Liability', 'Governing Law']):
  d.h(2, f'{i+1}. {t}'); d.p(4); d.p(3)
d.quote('IN WITNESS WHEREOF, the parties have executed this Agreement by their duly authorised representatives.'); docs.append(d)
# 7 technical spec
d = Doc('tech-spec', 'Design: Idempotent Webhook Delivery')
d.h(2, 'Overview'); d.p(3); d.h(2, 'API'); d.p(text='Clients call `POST /v2/webhooks/{id}/deliveries` with an `Idempotency-Key` header; retries within 24 hours return the original response.')
d.codeblock('json', '{\n  "event": "invoice.paid",\n  "attempt": 3,\n  "backoff_ms": 8000\n}')
d.h(2, 'Retry schedule'); d.table(['Attempt', 'Delay', 'Jitter'], [[1, '1s', '±200ms'], [2, '4s', '±800ms'], [3, '16s', '±3s'], [4, '64s', '±12s']])
d.h(2, 'Failure modes'); d.p(3); d.ul(['Receiver returns 5xx repeatedly', 'DNS resolution fails for the target host', 'Payload exceeds the 1 MiB limit']); d.p(2)
d.codeblock('ts', 'export function nextDelay(attempt: number): number {\n  return Math.min(64_000, 1_000 * 4 ** (attempt - 1))\n}'); docs.append(d)
# 8 unicode
d = Doc('unicode-multilingual', 'Notes multilingues — Übersicht 概要')
d.p(text='La réunion s’est tenue à Genève le 3 juin ; les décisions figurent ci‑dessous.')
d.p(text='Die Änderungen betreffen das Straßenverkehrsamt und die Prüfstelle für Maschinen in Köln.')
d.p(text='本製品の保証期間は購入日から二年間です。詳細は付属の説明書を参照してください。')
d.p(text='تم تحديث سياسة الخصوصية في ١٥ مايو، ويُرجى مراجعة البنود الجديدة.')
d.p(text='Typography check: “curly quotes”, en–dash, em—dash, ellipsis…, ligatures ﬁnancial ﬂow, café naïve résumé, and the © ™ ® marks.')
d.p(text='Emoji and symbols: ✅ 🚀 ∑ ≠ → € £ ¥ ½ ² µ.'); d.table(['Sprache', 'Wert', 'Anmerkung'], [['Français', '1 234,56 €', 'décimale virgule'], ['Deutsch', '1.234,56 €', 'Punkt als Tausender'], ['日本語', '¥123,456', '全角なし']]); docs.append(d)
# 9 catalog (big table)
d = Doc('product-catalog', 'Hardware Catalog 2026')
d.p(2); d.table(['SKU', 'Product', 'Unit price', 'Lead time', 'Notes'], [[f"HW-{1000+i}", f"{rng.choice(['Rack','Blade','Edge','Storage','Switch'])} unit model {rng.choice('ABCDEFG')}{i}", money(), f"{rng.randint(1,12)} weeks", rng.choice(['EOL 2027', 'Bulk discount', 'Requires rail kit', 'Ships with PSU', '—'])] for i in range(40)]); d.p(2); docs.append(d)
# 10 onboarding nested lists
d = Doc('onboarding-guide', 'Engineering Onboarding Guide')
d.h(2, 'Week one'); d.p(2); d.ul(['Set up the development environment', 'Pair with your onboarding buddy', 'Ship a first small change'], nested=['Install the CLI and authenticate', 'Clone the monorepo and run the test suite', 'Read the contribution guidelines'])
d.h(2, 'Week two'); d.p(3); d.ul(['Shadow an on-call shift', 'Present a summary of one incident', 'Meet your skip-level manager'], ordered=True); d.h(2, 'Resources'); d.p(2); docs.append(d)
# 11 postmortem
d = Doc('incident-postmortem', 'Postmortem: INC-4471 Checkout Latency')
d.h(2, 'Summary'); d.p(3); d.h(2, 'Impact'); d.p(3); d.h(2, 'Timeline')
d.table(['Time (UTC)', 'Event'], [['09:12', 'Alert fired for p95 latency above 2 s'], ['09:20', 'On-call engineer confirmed connection pool exhaustion'], ['09:41', 'Read replica promoted and traffic re-routed'], ['10:05', 'Latency returned below objective'], ['11:30', 'Incident closed and customer notice published']])
d.h(2, 'Root cause'); d.p(4); d.h(2, 'Corrective actions'); d.ul(['Add pool saturation alerting at 80%', 'Cap per-request query fan-out', 'Rehearse replica promotion quarterly']); d.p(2); docs.append(d)
# 12 research summary (long paragraphs, hyphenation-prone words, citations)
d = Doc('research-summary', 'Literature Review: Retrieval-Augmented Generation for Enterprise Search')
d.h(2, 'Background'); d.p(5); d.p(5)
d.p(text='Long-context transformers, sparse-attention variants, and mixture-of-experts architectures each trade throughput for recall in state-of-the-art configurations [1, 2]; hyphenated compounds such as multi-tenant, end-to-end and self-hosted appear throughout the corpus.')
d.h(2, 'Methods'); d.p(5); d.p(4); d.h(2, 'Findings'); d.p(5); d.p(4); d.p(4); d.h(2, 'References'); d.ul(['[1] Lewis et al., Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks, 2020.', '[2] Ouyang et al., OmniDocBench, CVPR 2025.', '[3] Poznanski et al., olmOCR 2: Unit Test Rewards for Document OCR, 2025.']); docs.append(d)
# 13 policy (many short sections)
d = Doc('security-policy', 'Information Security Policy')
for t in ['Purpose', 'Scope', 'Asset management', 'Access control', 'Cryptography', 'Physical security', 'Operations security', 'Supplier relationships', 'Incident management', 'Compliance']:
  d.h(2, t); d.p(2)
docs.append(d)
# 14 changelog
d = Doc('changelog', 'Release Notes')
for v, date in [('v3.4.0', '2026-08-28'), ('v3.3.2', '2026-08-14'), ('v3.3.1', '2026-08-07'), ('v3.3.0', '2026-07-31')]:
  d.h(2, f'{v} — {date}'); d.ul([f'{rng.choice(["Fixed","Added","Improved","Removed"])} {rng.choice(["the export dialog","rate limiting on the search API","the dark theme contrast","legacy webhook signatures","bulk archive for folders","the SAML metadata parser"])} ({rng.choice(["#4120","#4133","#4141","#4150","#4162","#4177"])})' for _ in range(rng.randint(2,4))])
docs.append(d)

manifest = []
HEADER = 'ACME Corp — Internal Use Only'; FOOTER = 'Confidential draft, do not distribute'
ABSENCE_PDF = ['Internal Use Only', 'do not distribute', 'Page 1 of', 'Page 2 of']

def run(cmd): subprocess.run(cmd, check=True)
for d in docs:
  spec = d.write(); mdpath = os.path.join(SRC, d.name + '.md')
  gt = subprocess.run(['pandoc', mdpath, '-t', 'plain', '--wrap=none'], capture_output=True, text=True, check=True).stdout
  with open(os.path.join(SPEC, d.name + '.gt.txt'), 'w') as f: f.write(gt)
  for fmt in ['docx', 'odt', 'pptx', 'html', 'md']:
    target = os.path.join(FILES, f'{d.name}.{fmt}')
    if fmt == 'md': run(['cp', mdpath, target])
    elif fmt == 'html': run(['pandoc', mdpath, '-s', '--metadata', f'title={d.title}', '-o', target])
    elif fmt == 'pptx': run(['pandoc', mdpath, '--slide-level=2', '-o', target])
    else: run(['pandoc', mdpath, '-o', target])
    manifest.append(dict(file=os.path.basename(target), doc=d.name, format=fmt, tier='A', absence=[]))
  # PDF via typst: single column with running header/footer + page numbers; two-column for long docs
  typ = subprocess.run(['pandoc', mdpath, '-t', 'typst', '-s'], capture_output=True, text=True, check=True).stdout
  variants = [('pdf', '')]
  if len(gt) > 3500: variants.append(('2col.pdf', 'columns: 2, '))
  for suffix, cols in variants:
    page = f'#set page({cols}header: align(right)[{HEADER}], footer: context [{FOOTER} — Page #counter(page).display() of #counter(page).final().first()])\n'
    typpath = os.path.join(FILES, f'{d.name}.{suffix}.typ')
    with open(typpath, 'w') as f: f.write(typ.replace('#show: doc => article(', page + '#show: doc => article(', 1) if '#show: doc => article(' in typ else page + typ)
    target = os.path.join(FILES, f'{d.name}.{suffix}')
    run([TYPST, 'compile', typpath, target]); os.remove(typpath)
    manifest.append(dict(file=os.path.basename(target), doc=d.name, format='pdf', tier='A', absence=ABSENCE_PDF, variant='2col' if '2col' in suffix else 'single'))

with open(os.path.join(OUT, 'manifest-a.json'), 'w') as f: json.dump(manifest, f, indent=1)
print(len(docs), 'docs;', len(manifest), 'files')
