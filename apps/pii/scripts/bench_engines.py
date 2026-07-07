"""Benchmark + parity harness for the spacy vs gliner NER engines.

Runs the same payload through both engines and reports per-engine throughput
(batch analyze, the production /redact_batch path) and per-text latency, plus
an accuracy diff over the 4 NER entity types (PERSON/LOCATION/NRP/DATE_TIME).
Non-NER (regex/checksum) results must be identical between engines — both
register the same recognizers — so any mismatch there is a wiring bug and the
script exits non-zero.

Meant to run inside the gliner image (the only one with both engines):

    docker run --rm sim-pii:gliner python scripts/bench_engines.py
    docker run --rm -v $PWD/texts.json:/data.json sim-pii:gliner \\
        python scripts/bench_engines.py --payload /data.json

Payload format: JSON list of {"text": str, "language": str} objects.
This doubles as the tuning harness for GLINER_ENTITY_MAPPING label prompts.
"""

import argparse
import json
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import engines  # noqa: E402

# Entities sourced from the NER models rather than regex/checksum patterns.
# ORGANIZATION is emitted by the spacy engine's NER on unfiltered requests but
# is not in the app's supported set and has no GLiNER mapping — it shows up in
# the NER diff (spacy-only) rather than failing the regex-parity gate.
NER_ENTITIES = {"PERSON", "LOCATION", "NRP", "DATE_TIME", "ORGANIZATION"}
DEFAULT_PAYLOAD = Path(__file__).resolve().parent / "bench_payload.json"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--payload", type=Path, default=DEFAULT_PAYLOAD)
    parser.add_argument("--engines", default="spacy,gliner")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--warmup", type=int, default=1)
    parser.add_argument("--device", default=None, help="torch device for gliner (default: auto)")
    parser.add_argument("--gliner-model", default="urchade/gliner_multi_pii-v1")
    parser.add_argument("--max-examples", type=int, default=10)
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    return parser.parse_args()


def build(engine: str, args) -> tuple:
    started = time.perf_counter()
    if engine == "spacy":
        analyzer = engines.build_spacy_analyzer()
    elif engine == "gliner":
        analyzer = engines.build_gliner_analyzer(model_name=args.gliner_model, device=args.device)
    else:
        raise ValueError(f"Unknown engine {engine!r}")
    return analyzer, time.perf_counter() - started


def analyze_all(analyzer, items) -> list[list]:
    """One analyze() call per text, in payload order."""
    return [analyzer.analyze(text=item["text"], language=item["language"]) for item in items]


def bench(analyzer, items, runs: int, warmup: int) -> dict:
    for _ in range(warmup):
        analyze_all(analyzer, items)
    run_times = []
    latencies = []
    for _ in range(runs):
        run_started = time.perf_counter()
        for item in items:
            text_started = time.perf_counter()
            analyzer.analyze(text=item["text"], language=item["language"])
            latencies.append(time.perf_counter() - text_started)
        run_times.append(time.perf_counter() - run_started)
    total_chars = sum(len(item["text"]) for item in items)
    avg_run = statistics.mean(run_times)
    return {
        "texts_per_sec": len(items) / avg_run,
        "chars_per_sec": total_chars / avg_run,
        "latency_p50_ms": statistics.median(latencies) * 1000,
        "latency_p95_ms": statistics.quantiles(latencies, n=20)[18] * 1000,
    }


def spans(results, keep_ner: bool) -> set:
    return {
        (r.entity_type, r.start, r.end)
        for r in results
        if (r.entity_type in NER_ENTITIES) == keep_ner
    }


def iou(a: tuple, b: tuple) -> float:
    inter = max(0, min(a[2], b[2]) - max(a[1], b[1]))
    union = max(a[2], b[2]) - min(a[1], b[1])
    return inter / union if union else 0.0


def diff_ner(items, results_a, results_b, max_examples: int) -> dict:
    """Per-entity-type agreement between two engines (span IoU >= 0.5)."""
    per_type = defaultdict(lambda: {"a_total": 0, "b_total": 0, "matched": 0})
    examples = []
    for item, res_a, res_b in zip(items, results_a, results_b):
        a = sorted(spans(res_a, keep_ner=True))
        b = sorted(spans(res_b, keep_ner=True))
        unmatched_b = set(b)
        for span_a in a:
            per_type[span_a[0]]["a_total"] += 1
            match = next(
                (s for s in unmatched_b if s[0] == span_a[0] and iou(span_a, s) >= 0.5), None
            )
            if match:
                per_type[span_a[0]]["matched"] += 1
                unmatched_b.discard(match)
        for span_b in b:
            per_type[span_b[0]]["b_total"] += 1
        only_a = [s for s in a if not any(s[0] == t[0] and iou(s, t) >= 0.5 for t in b)]
        only_b = sorted(unmatched_b)
        if (only_a or only_b) and len(examples) < max_examples:
            examples.append(
                {
                    "text": item["text"],
                    "language": item["language"],
                    "only_a": [f"{t}[{s}:{e}]={item['text'][s:e]!r}" for t, s, e in only_a],
                    "only_b": [f"{t}[{s}:{e}]={item['text'][s:e]!r}" for t, s, e in only_b],
                }
            )
    return {"per_type": dict(per_type), "examples": examples}


def diff_regex(items, results_a, results_b) -> list:
    """Non-NER results must be identical: same recognizers on both engines."""
    mismatches = []
    for item, res_a, res_b in zip(items, results_a, results_b):
        a = spans(res_a, keep_ner=False)
        b = spans(res_b, keep_ner=False)
        if a != b:
            mismatches.append({"text": item["text"], "only_a": sorted(a - b), "only_b": sorted(b - a)})
    return mismatches


def main() -> int:
    args = parse_args()
    items = json.loads(args.payload.read_text())
    engine_names = [e.strip() for e in args.engines.split(",") if e.strip()]

    report = {"payload": str(args.payload), "texts": len(items), "engines": {}}
    results_by_engine = {}
    for name in engine_names:
        analyzer, build_secs = build(name, args)
        stats = bench(analyzer, items, runs=args.runs, warmup=args.warmup)
        stats["build_secs"] = build_secs
        report["engines"][name] = stats
        results_by_engine[name] = analyze_all(analyzer, items)

    exit_code = 0
    if set(engine_names) >= {"spacy", "gliner"}:
        report["ner_diff"] = diff_ner(
            items, results_by_engine["spacy"], results_by_engine["gliner"], args.max_examples
        )
        regex_mismatches = diff_regex(
            items, results_by_engine["spacy"], results_by_engine["gliner"]
        )
        report["regex_mismatches"] = regex_mismatches
        if regex_mismatches:
            exit_code = 1

    if args.json:
        print(json.dumps(report, indent=2, default=str))
        return exit_code

    for name, stats in report["engines"].items():
        print(f"\n== {name} ==")
        print(f"  build:        {stats['build_secs']:.1f}s")
        print(f"  throughput:   {stats['texts_per_sec']:.2f} texts/s  ({stats['chars_per_sec']:.0f} chars/s)")
        print(f"  latency:      p50 {stats['latency_p50_ms']:.1f}ms  p95 {stats['latency_p95_ms']:.1f}ms")
    if "ner_diff" in report:
        print("\n== NER parity (spacy=a vs gliner=b, span IoU>=0.5) ==")
        for entity, counts in sorted(report["ner_diff"]["per_type"].items()):
            print(
                f"  {entity:<10} spacy={counts['a_total']:<4} gliner={counts['b_total']:<4} "
                f"matched={counts['matched']}"
            )
        for example in report["ner_diff"]["examples"]:
            print(f"\n  [{example['language']}] {example['text']}")
            if example["only_a"]:
                print(f"    spacy only:  {', '.join(example['only_a'])}")
            if example["only_b"]:
                print(f"    gliner only: {', '.join(example['only_b'])}")
        if report["regex_mismatches"]:
            print("\n!! REGEX MISMATCHES (wiring bug — engines must agree on non-NER):")
            for mismatch in report["regex_mismatches"]:
                print(f"  {mismatch}")
        else:
            print("\n  regex/checksum entities: identical across engines ✓")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
