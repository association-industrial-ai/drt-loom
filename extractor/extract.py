#!/usr/bin/env python3
"""
Industrial extractor for Graphify.

Graphify ships extractors for source code and documents. It has none for ERP or
PLM data, but `build_from_json()` accepts any extraction that matches its schema
-- so we emit that schema directly from the generated dataset and get Graphify's
clustering, god-node analysis, HTML view, report and Cypher export for free.

Run via ../../package.json -> `npm run graph`.

Constraints discovered by spiking the library; see notes/graphify-findings.md:
  * `file_type` is a closed enum and invalid values DROP THE NODE SILENTLY
  * `source_file` is required on edges as well as nodes
  * a node id that slugifies to its source_file stem gets silently rewritten
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from graphify import build, cluster, export, validate

import os

ROOT = Path(os.environ.get("BENCH_ROOT", Path(__file__).resolve().parents[1]))
DATASET = ROOT / "data" / "generated" / "dataset.json"
OUT_DIR = ROOT / "data" / "graph"
SCRATCH = Path(__file__).resolve().parent / "graphify-out"

# Graphify's closed enum. Everything domain-specific goes in `node_type`.
FILE_TYPE_DOCUMENT = "document"
FILE_TYPE_CONCEPT = "concept"


def to_extraction(dataset: dict) -> dict:
    nodes = []
    for e in dataset["entities"]:
        node = {
            "id": e["id"],
            "label": e["label"],
            "source_file": e["sourceFile"],
            "source_location": e["sourceLocation"],
            "file_type": FILE_TYPE_DOCUMENT if e["type"] == "Document" else FILE_TYPE_CONCEPT,
            # The real domain type. Graphify preserves unknown keys verbatim.
            "node_type": e["type"],
        }
        for k, v in e.get("attrs", {}).items():
            # Don't let an attribute shadow a reserved key.
            if k not in node:
                node[k] = v
        nodes.append(node)

    edges = []
    for r in dataset["relations"]:
        edge = {
            "source": r["source"],
            "target": r["target"],
            "relation": r["relation"],
            "confidence": r["confidence"],
            "source_file": r["sourceFile"],
        }
        for k, v in (r.get("attrs") or {}).items():
            if k not in edge:
                edge[k] = v
        edges.append(edge)

    return {"nodes": nodes, "edges": edges}


def main() -> int:
    if not DATASET.is_file():
        print(f"✗ {DATASET.relative_to(REPO)} not found — run `npm run gen` first", file=sys.stderr)
        return 1

    dataset = json.loads(DATASET.read_text())
    extraction = to_extraction(dataset)
    print(
        f"Extracted {len(extraction['nodes'])} nodes / {len(extraction['edges'])} edges "
        f"from {dataset['meta']['company']}"
    )

    errors = validate.validate_extraction(extraction)
    if errors:
        print(f"✗ Graphify rejected the extraction ({len(errors)} issue(s)):", file=sys.stderr)
        for e in errors[:20]:
            print(f"   - {e}", file=sys.stderr)
        return 1

    G = build.build_from_json(extraction, directed=True)

    # --- ID stability gate. Graphify rewrites ids that collide with their
    # source-file stem. Every downstream reference (gold answers, tool output,
    # UI citations) assumes ids survive verbatim, so a silent rewrite would
    # corrupt the whole demo. Never remove this check.
    expected = {n["id"] for n in extraction["nodes"]}
    actual = set(G.nodes)
    if expected != actual:
        missing = sorted(expected - actual)[:10]
        added = sorted(actual - expected)[:10]
        print("✗ node id drift detected — Graphify rewrote ids", file=sys.stderr)
        print(f"   missing: {missing}", file=sys.stderr)
        print(f"   unexpected: {added}", file=sys.stderr)
        return 1

    if not G.is_directed():
        print("✗ graph is undirected; BOM parent/child would be meaningless", file=sys.stderr)
        return 1

    # --- Parallel-edge gate. build_from_json returns a DiGraph, not a
    # MultiDiGraph, so several edges between the same ordered pair collapse into
    # one. Same-relation duplicates are harmless. Two DIFFERENT relations
    # collapsing means we silently lose a fact, which is not acceptable.
    pair_relations: dict[tuple[str, str], set[str]] = {}
    for e in extraction["edges"]:
        pair_relations.setdefault((e["source"], e["target"]), set()).add(e["relation"])
    lossy = {k: v for k, v in pair_relations.items() if len(v) > 1}
    dupes = len(extraction["edges"]) - len(pair_relations)
    if lossy:
        print(
            f"✗ {len(lossy)} node pair(s) carry more than one relation type and would "
            f"collapse, losing facts:",
            file=sys.stderr,
        )
        for (s, t), rels in list(lossy.items())[:10]:
            print(f"   - {s} -> {t}: {sorted(rels)}", file=sys.stderr)
        return 1
    if dupes:
        print(f"  note: {dupes} duplicate edge(s) collapsed (same pair, same relation)")

    communities = cluster.cluster(G)
    print(f"Built directed graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, "
          f"{len(communities)} communities")

    SCRATCH.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    graph_json = SCRATCH / "graph.json"
    export.to_json(G, communities, str(graph_json))
    export.to_html(G, communities, str(SCRATCH / "graph.html"))
    export.to_cypher(G, str(SCRATCH / "graph.cypher"))

    # Only the artifacts the app and the demo actually need get committed.
    shutil.copy2(graph_json, OUT_DIR / "graph.json")
    shutil.copy2(SCRATCH / "graph.html", OUT_DIR / "graph.html")
    shutil.copy2(SCRATCH / "graph.cypher", OUT_DIR / "graph.cypher")

    size_mb = (OUT_DIR / "graph.json").stat().st_size / 1e6
    by_conf: dict[str, int] = {}
    for _, _, d in G.edges(data=True):
        c = d.get("confidence", "?")
        by_conf[c] = by_conf.get(c, 0) + 1

    print(f"\n  provenance: " + ", ".join(f"{k} {v}" for k, v in sorted(by_conf.items())))
    print(f"  wrote data/graph/graph.json ({size_mb:.2f} MB), graph.html, graph.cypher")
    print("\n✓ graph build complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
