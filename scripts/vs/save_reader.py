"""Read-only VS 1.22.x save inspection. No game process or worldgen is started.

Supports savegame-v2 chunk coordinates and compression-version-2 solid/fluid
layers. Refuses other formats rather than interpreting unknown cells as air.
"""
from array import array
import ctypes
import ctypes.util
from pathlib import Path
import sqlite3
import struct
import sys
from protobuf import fields, first, text


class Zstd:
    def __init__(self):
        name = ctypes.util.find_library('zstd')
        if not name:
            raise RuntimeError('libzstd is required (Ubuntu: libzstd1).')
        self.lib = ctypes.CDLL(name)
        self.lib.ZSTD_getFrameContentSize.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
        self.lib.ZSTD_getFrameContentSize.restype = ctypes.c_ulonglong
        self.lib.ZSTD_decompress.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t]
        self.lib.ZSTD_decompress.restype = ctypes.c_size_t
        self.lib.ZSTD_isError.argtypes = [ctypes.c_size_t]
        self.lib.ZSTD_isError.restype = ctypes.c_uint

    def decompress(self, data):
        size = self.lib.ZSTD_getFrameContentSize(data, len(data))
        if size > 16 * 1024 * 1024:
            raise ValueError('Unknown or oversized Zstandard frame')
        output = ctypes.create_string_buffer(size)
        actual = self.lib.ZSTD_decompress(output, size, data, len(data))
        if self.lib.ZSTD_isError(actual) or actual != size:
            raise ValueError('Zstandard decompression failed')
        return output.raw[:actual]


_zstd = None


def ints(data):
    if len(data) % 4:
        raise ValueError('Misaligned integer array')
    result = array('I')
    result.frombytes(data)
    if sys.byteorder != 'little':
        result.byteswap()
    return result


def decode_layer(data):
    """Expand palette-index bitplanes into 32^3 IDs; index = (y*32+z)*32+x."""
    global _zstd
    if not data:
        return array('I', [0]) * 32768
    if len(data) < 4:
        raise ValueError('Truncated block layer')
    header = struct.unpack_from('<i', data)[0]
    if header == 0:
        return array('I', [0]) * 32768
    length = abs(header)
    if length > len(data) - 4:
        raise ValueError('Invalid palette length')
    if _zstd is None:
        _zstd = Zstd()
    encoded_palette = data[4:4 + length]
    palette = ints(encoded_palette if header < 0 else _zstd.decompress(encoded_palette))
    if len(palette) <= 1:
        if palette and palette[0] != 0:
            raise ValueError('Unexpected non-air singleton palette')
        return array('I', [0]) * 32768
    if len(palette) > 32768 or palette[0] != 0:
        raise ValueError('Invalid block palette')
    bit_count = (len(palette) - 1).bit_length()
    planes = ints(_zstd.decompress(data[4 + length:]))
    if len(planes) != bit_count * 1024:
        raise ValueError('Unexpected bitplane size')
    result = array('I', [0]) * 32768
    for group in range(1024):
        words = [planes[bit * 1024 + group] for bit in range(bit_count)]
        for x in range(32):
            index = sum(((word >> x) & 1) << bit for bit, word in enumerate(words))
            if index >= len(palette):
                raise ValueError('Block palette index out of bounds')
            result[group * 32 + x] = palette[index]
    return result


def chunk_position(index):
    return [index & 4194303, (index >> 54) & 511, (index >> 27) & 4194303,
            ((index >> 22) & 31) + ((index >> 44) & 992)]


def chunk_index(x, y, z, dimension=0):
    if not (0 <= x < 4194304 and 0 <= z < 4194304 and 0 <= y < 512 and 0 <= dimension < 1024):
        raise ValueError('Chunk coordinate out of bounds')
    value = x | (z << 27) | (y << 54) | ((dimension & 31) << 22) | ((dimension & 992) << 44)
    return value if value < 2**63 else value - 2**64


def rle(values):
    output = []
    for value in values:
        if output and output[-1][1] == value:
            output[-1][0] += 1
        else:
            output.append([1, value])
    return output


class SaveReader:
    def __init__(self, path):
        self.path = Path(path).resolve()
        if not self.path.is_file():
            raise ValueError('Save not found')
        # No immutable=1 assumption here: normal read-only SQLite snapshot transaction.
        self.db = sqlite3.connect(self.path.as_uri() + '?mode=ro', uri=True)
        self.db.execute('PRAGMA query_only=ON')
        self.db.execute('BEGIN')
        record = fields(self.db.execute('SELECT data FROM gamedata WHERE savegameid=1').fetchone()[0])
        version = text(record, 21)
        if not version.startswith('1.22.') or first(record, 37) != 2:
            raise ValueError(f'Unsupported save version {version} / chunk format {first(record, 37)}. Expected 1.22.x / 2.')
        self.metadata = {'name': text(record, 13), 'gameVersion': version, 'createdGameVersion': text(record, 18),
                         'mapSize': [first(record, n) for n in [1, 2, 3]], 'lastSaved': text(record, 17),
                         'chunkSize': 32, 'chunkFormat': 2}
        self.moddata = {text(fields(entry), 1): first(fields(entry), 2, b'') for entry in record.get(11, [])}
        self.palette = {first(fields(entry), 1, 0): text(fields(entry), 2) for entry in fields(self.moddata['BlockIDs'])[1]}
        self.item_palette = {first(fields(entry), 1, 0): text(fields(entry), 2) for entry in fields(self.moddata.get('ItemIDs', b'')).get(1, [])}
        if self.palette.get(0) not in ['air', 'game:air']:
            raise ValueError('Missing air mapping')

    def close(self):
        self.db.close()

    def chunk(self, x, y, z, dimension=0):
        row = self.db.execute('SELECT data FROM chunk WHERE position=?', [chunk_index(x, y, z, dimension)]).fetchone()
        if not row:
            return None
        record = fields(row[0])
        if first(record, 15, 0) != 2:
            raise ValueError(f'Unsupported compression in chunk {x},{y},{z}')
        return {'solid': decode_layer(first(record, 1)), 'fluid': decode_layer(first(record, 16)),
                'placed': first(record, 17, 0), 'removed': first(record, 18, 0), 'raw': row[0],
                'blockEntities': record.get(8, []), 'entities': record.get(6, []), 'decors': first(record, 14, b'')}

    def edit_candidates(self):
        candidates = []
        for position, data in self.db.execute('SELECT position,data FROM chunk'):
            record = fields(data)
            placed, removed = first(record, 17, 0), first(record, 18, 0)
            if placed or removed:
                candidates.append({'chunk': chunk_position(position), 'placed': placed, 'removed': removed})
        return sorted(candidates, key=lambda c: c['placed'] + c['removed'], reverse=True)
