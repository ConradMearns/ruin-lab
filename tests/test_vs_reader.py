"""Synthetic fixtures only. No game save or game binaries required."""
from array import array
import ctypes
import importlib.util
from pathlib import Path
import sqlite3
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'vs'))
from protobuf import fields, varint
from save_reader import Zstd, decode_layer, chunk_index, chunk_position, rle, SaveReader


def vint(value):
    result = bytearray()
    while value >= 128:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)


def field(n, value):
    if isinstance(value, int):
        return vint(n << 3) + vint(value)
    if isinstance(value, str):
        value = value.encode()
    return vint(n << 3 | 2) + vint(len(value)) + value


def compress(data):
    z = Zstd().lib
    z.ZSTD_compressBound.argtypes = [ctypes.c_size_t]
    z.ZSTD_compressBound.restype = ctypes.c_size_t
    z.ZSTD_compress.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]
    z.ZSTD_compress.restype = ctypes.c_size_t
    output = ctypes.create_string_buffer(z.ZSTD_compressBound(len(data)))
    size = z.ZSTD_compress(output, len(output), data, len(data), 1)
    if z.ZSTD_isError(size):
        raise ValueError('Fixture compression failed')
    return output.raw[:size]


def layer(palette, indexes, compressed_palette=False):
    bits = (len(palette) - 1).bit_length()
    planes = [0] * (bits * 1024)
    for i, value in enumerate(indexes):
        for bit in range(bits):
            planes[bit * 1024 + i // 32] |= ((value >> bit) & 1) << (i % 32)
    palette_data = struct.pack('<' + 'I' * len(palette), *palette)
    encoded = compress(palette_data) if compressed_palette else palette_data
    header = len(encoded) if compressed_palette else -len(encoded)
    return struct.pack('<i', header) + encoded + compress(struct.pack('<' + 'I' * len(planes), *planes))


class ReaderTests(unittest.TestCase):
    def test_wire_parser(self):
        raw = field(1, 321) + field(2, b'hello') + field(1, 7)
        self.assertEqual(fields(raw), {1: [321, 7], 2: [b'hello']})
        for data in [b'\x80', b'\0', b'\x12\x05a', b'\x09\0']:
            with self.assertRaises(ValueError):
                fields(data)
        with self.assertRaises(ValueError):
            varint(b'\xff' * 11, 0)

    def test_chunk_coordinate_roundtrip(self):
        for p in [(16001, 3, 16002, 0), (0, 0, 0, 0), (4000000, 511, 4000000, 1023)]:
            self.assertEqual(chunk_position(chunk_index(*p)), list(p))
        with self.assertRaises(ValueError):
            chunk_index(-1, 0, 0)

    def test_air_and_rle(self):
        self.assertEqual(sum(decode_layer(None)), 0)
        self.assertEqual(sum(decode_layer(struct.pack('<i', 0))), 0)
        self.assertEqual(rle([0, 0, 2, 2, 2, 0]), [[2, 0], [3, 2], [1, 0]])

    def test_raw_and_compressed_palettes(self):
        palette = [0, 3413, 12999]
        indices = [0] * 32768
        # Exercise each axis, palette bit, word boundary and final chunk cell.
        for i, value in [(0, 1), (31, 2), (32, 1), (1023, 2), (1024, 1), (32767, 2)]:
            indices[i] = value
        expected = array('I', (palette[n] for n in indices))
        for compressed in [False, True]:
            self.assertEqual(decode_layer(layer(palette, indices, compressed)), expected)
        bad = indices[:]
        bad[5] = 3
        with self.assertRaisesRegex(ValueError, 'index out of bounds'):
            decode_layer(layer(palette, bad))

    def test_corruption_rejected(self):
        for data in [b'\x01', struct.pack('<i', 100) + b'a', struct.pack('<i', -4) + struct.pack('<i', 1)]:
            with self.assertRaises(ValueError):
                decode_layer(data)

    def test_readonly_sqlite_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture.vcdbs'
            mapping = field(1, field(1, 0) + field(2, 'air')) + field(1, field(1, 1) + field(2, 'rock-sandstone'))
            game = b''.join(field(n, v) for n, v in [(1, 1024), (2, 256), (3, 1024), (13, 'Synthetic fixture'), (18, '1.22.7'), (21, '1.22.7'), (37, 2)])
            game += field(11, field(1, 'BlockIDs') + field(2, mapping))
            indexes = [0] * 32768
            indexes[1024 + 64 + 3] = 1
            chunk = field(1, layer([0, 1], indexes)) + field(15, 2) + field(17, 7) + field(18, 3)
            with sqlite3.connect(path) as db:
                db.executescript('CREATE TABLE gamedata(savegameid INTEGER PRIMARY KEY,data BLOB); CREATE TABLE chunk(position INTEGER PRIMARY KEY,data BLOB);')
                db.execute('INSERT INTO gamedata VALUES(1,?)', [game])
                db.execute('INSERT INTO chunk VALUES(?,?)', [chunk_index(1, 3, 2), chunk])
            before = path.read_bytes()
            reader = SaveReader(path)
            try:
                self.assertEqual(reader.metadata['name'], 'Synthetic fixture')
                self.assertEqual(reader.chunk(1, 3, 2)['solid'][1091], 1)
                self.assertIsNone(reader.chunk(2, 3, 2))
                self.assertEqual(reader.edit_candidates(), [{'chunk': [1, 3, 2, 0], 'placed': 7, 'removed': 3}])
                with self.assertRaises(sqlite3.OperationalError):
                    reader.db.execute('DELETE FROM chunk')
            finally:
                reader.close()
            self.assertEqual(path.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
