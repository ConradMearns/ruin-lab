#!/usr/bin/env python3
"""Export a bounded inspection region, not a final build selection.

Explicit full-volume RLE preserves air; missing chunks abort the extraction.
Opaque block/entity/decor records and original chunk blobs stay with the project.
This tool never writes to the save and never generates chunks.
"""
import argparse
import base64
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from array import array
from save_reader import SaveReader, rle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('save', type=Path)
    parser.add_argument('--origin', type=int, nargs=3, required=True, metavar=('X', 'Y', 'Z'))
    parser.add_argument('--size', type=int, nargs=3, required=True, metavar=('X', 'Y', 'Z'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    origin, size = args.origin, args.size
    volume = size[0] * size[1] * size[2]
    if any(n < 1 or n > 128 for n in size) or volume > 1000000 or any(n < 0 for n in origin):
        raise ValueError('Region must have positive dimensions ≤128 and volume ≤1,000,000.')
    if args.output.exists():
        raise ValueError('Output already exists; choose a new path to preserve earlier work.')
    reader = SaveReader(args.save)
    try:
        if any(origin[a] + size[a] > reader.metadata['mapSize'][a] for a in range(3)):
            raise ValueError('Region exceeds world bounds')
        solid, fluid = array('I', [0]) * volume, array('I', [0]) * volume
        chunks = []
        for cy in range(origin[1] // 32, (origin[1] + size[1] - 1) // 32 + 1):
            for cz in range(origin[2] // 32, (origin[2] + size[2] - 1) // 32 + 1):
                for cx in range(origin[0] // 32, (origin[0] + size[0] - 1) // 32 + 1):
                    chunk = reader.chunk(cx, cy, cz)
                    if chunk is None:
                        raise ValueError(f'Chunk {cx},{cy},{cz} is missing. Refusing to replace unknown terrain with air.')
                    x0, y0, z0 = max(origin[0], cx * 32), max(origin[1], cy * 32), max(origin[2], cz * 32)
                    x1, y1, z1 = min(origin[0] + size[0], (cx + 1) * 32), min(origin[1] + size[1], (cy + 1) * 32), min(origin[2] + size[2], (cz + 1) * 32)
                    for y in range(y0, y1):
                        for z in range(z0, z1):
                            src = ((y % 32) * 32 + z % 32) * 32 + x0 % 32
                            dest = ((y - origin[1]) * size[2] + z - origin[2]) * size[0] + x0 - origin[0]
                            solid[dest:dest + x1 - x0] = chunk['solid'][src:src + x1 - x0]
                            fluid[dest:dest + x1 - x0] = chunk['fluid'][src:src + x1 - x0]
                    chunks.append({'position': [cx, cy, cz, 0], 'placed': chunk['placed'], 'removed': chunk['removed'],
                                   'sha256': hashlib.sha256(chunk['raw']).hexdigest(), 'rawBase64': base64.b64encode(chunk['raw']).decode(),
                                   'blockEntityRecords': len(chunk['blockEntities']), 'entityRecords': len(chunk['entities']),
                                   'hasDecors': bool(chunk['decors'])})
        used = set(solid) | set(fluid)
        palette = {str(id): {'code': reader.palette[id] if ':' in reader.palette[id] else 'game:' + reader.palette[id]} for id in sorted(used)}
        with args.save.open('rb') as stream:
            source_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
        result = {'format': 'ruin-lab/vs-region', 'version': 1,
                  'name': reader.metadata['name'] + ' / candidate region',
                  'source': {**reader.metadata, 'saveSha256': source_hash, 'capturedUtc': datetime.now(timezone.utc).isoformat()},
                  'origin': origin, 'size': size, 'axisOrder': 'xzy', 'palette': palette,
                  'layers': {'solid': rle(solid), 'fluid': rle(fluid)},
                  'sourceChunks': chunks,
                  # Opaque entities/chiseled data may reference IDs not visible in either voxel layer.
                  'sourceMappings': {'blocks': {str(id): code for id, code in reader.palette.items()},
                                     'items': {str(id): code for id, code in reader.item_palette.items()}},
                  'warnings': ['Region is not a confirmed player-build boundary.', 'Air is observed empty space, not proven excavation.',
                               'Opaque source chunks include surrounding entities and private data; do not publish by default.',
                               'Chiseled blocks and block entities are preserved in source chunks; browser preview uses approximate cubes.',
                               'This artifact is not directly importable into Vintage Story.']}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, separators=(',', ':')) + '\n')
        print(json.dumps({'output': str(args.output), 'origin': origin, 'size': size, 'chunks': len(chunks),
                          'solidCells': sum(n for id, n in Counter(solid).items() if id), 'fluidCells': sum(n for id, n in Counter(fluid).items() if id),
                          'paletteEntries': len(palette), 'bytes': args.output.stat().st_size}, indent=2))
    finally:
        reader.close()


if __name__ == '__main__':
    main()
