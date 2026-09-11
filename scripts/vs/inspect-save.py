#!/usr/bin/env python3
"""Inventory a working-copy VS save, without loading the game or modifying it."""
import argparse
import json
from pathlib import Path
from save_reader import SaveReader

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('save', type=Path)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
reader = SaveReader(args.save)
try:
    report = {'format': 'ruin-lab/vs-inspection', 'version': 1, 'world': reader.metadata,
              'paletteSize': len(reader.palette), 'editCandidates': reader.edit_candidates(),
              'warnings': ['Chunk counters are evidence of activity, not per-block provenance.',
                           'No baseline world exists; intentional excavation needs human review.']}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(f"Inspected {reader.metadata['name']}: {len(report['editCandidates'])} candidate chunks → {args.output}")
finally:
    reader.close()
