"""Small bounded protobuf wire reader for VS inspection (no object instantiation)."""
import struct


def varint(data, offset):
    value = 0
    for shift in range(0, 70, 7):
        if offset >= len(data):
            raise ValueError('Truncated protobuf varint')
        b = data[offset]
        offset += 1
        value |= (b & 127) << shift
        if b < 128:
            return value, offset
    raise ValueError('Protobuf varint exceeds 64 bits')


def fields(data):
    result = {}
    offset = 0
    while offset < len(data):
        tag, offset = varint(data, offset)
        number, wire = tag >> 3, tag & 7
        if number == 0:
            raise ValueError('Invalid protobuf field zero')
        if wire == 0:
            value, offset = varint(data, offset)
        elif wire in (1, 5):
            size = 8 if wire == 1 else 4
            if offset + size > len(data):
                raise ValueError('Truncated fixed field')
            value = struct.unpack_from('<d' if wire == 1 else '<f', data, offset)[0]
            offset += size
        elif wire == 2:
            length, offset = varint(data, offset)
            if offset + length > len(data):
                raise ValueError('Truncated length-delimited field')
            value = data[offset:offset + length]
            offset += length
        else:
            raise ValueError(f'Unsupported protobuf wire type {wire}')
        result.setdefault(number, []).append(value)
    return result


def first(record, number, default=None):
    return record.get(number, [default])[0]


def text(record, number, default=''):
    return first(record, number, default.encode()).decode('utf8', errors='replace')
