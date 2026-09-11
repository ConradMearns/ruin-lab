#!/usr/bin/env python3
"""Cold-copy one VS save into private local/ storage; never writes to the source.

Requires the game/server to be closed. A backup is marked verified only after
source/copy SHA-256 checks and a read-only SQLite integrity check all succeed.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def running_game():
    names = {'vintagestory', 'vintagestoryserver', 'vintagestory.exe', 'vintagestoryserver.exe'}
    found = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            argv = (entry / 'cmdline').read_bytes().decode(errors='replace').split('\0')
            if argv and (Path(argv[0]).name.lower() in names or
                         (Path(argv[0]).name.lower() == 'dotnet' and any(Path(a).name.lower() in {'vintagestory.dll', 'vintagestoryserver.dll'} for a in argv[1:3]))):
                found.append(entry.name)
        except (FileNotFoundError, PermissionError):
            pass
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('save', type=Path)
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--game-dir', type=Path, required=True)
    args = parser.parse_args()
    source = args.save.resolve()
    if not source.is_file() or source.suffix != '.vcdbs':
        raise ValueError('Select an existing .vcdbs save.')
    if running_game():
        raise RuntimeError('Close Vintage Story and its server before taking a cold backup.')
    for suffix in ('-wal', '-shm', '-journal'):
        sidecar = Path(str(source) + suffix)
        if sidecar.exists():
            raise RuntimeError(f'SQLite sidecar exists ({sidecar.name}). Close/checkpoint the game cleanly first; refusing an ambiguous cold copy.')
    root = Path(__file__).resolve().parents[2]
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = root / 'local' / 'backups' / stamp
    os.umask(0o077)
    target.mkdir(parents=True, exist_ok=False)
    save_dir = target / 'Saves'
    save_dir.mkdir()
    records = []

    def copy_verified(src, dest):
        dest.parent.mkdir(parents=True, exist_ok=True)
        before = src.stat()
        digest = sha256(src)
        shutil.copyfile(src, dest)
        after = src.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or sha256(src) != digest or sha256(dest) != digest:
            raise RuntimeError(f'Source changed or verification failed: {src.name}. Backup is NOT verified.')
        records.append({'source': str(src), 'file': str(dest.relative_to(target)), 'bytes': dest.stat().st_size, 'sha256': digest})

    copied_save = save_dir / source.name
    copy_verified(source, copied_save)
    # Deliberately exclude clientsettings/account credentials and unrelated saves.
    data_dir = args.data_dir.resolve()
    for name in ['serverconfig.json', 'servermagicnumbers.json', 'ModConfig', 'ModData', 'Playerdata', 'WorldEdit']:
        path = data_dir / name
        if path.is_file():
            copy_verified(path, target / 'context' / name)
        elif path.is_dir():
            for child in sorted(path.rglob('*')):
                if child.is_file() and not child.is_symlink():
                    copy_verified(child, target / 'context' / child.relative_to(data_dir))
    inventory = []
    for directory in [args.game_dir / 'Mods', data_dir / 'Mods']:
        if directory.exists():
            for path in sorted(directory.rglob('*')):
                if path.is_file():
                    inventory.append({'source': str(path), 'bytes': path.stat().st_size, 'sha256': sha256(path)})
                    copy_verified(path, target / 'mods' / ('game' if directory == args.game_dir / 'Mods' else 'user') / path.relative_to(directory))
    with sqlite3.connect(copied_save.as_uri() + '?mode=ro&immutable=1', uri=True) as db:
        integrity = [row[0] for row in db.execute('PRAGMA integrity_check')]
    if integrity != ['ok'] or running_game():
        raise RuntimeError('Integrity check failed or game started during backup. Backup is NOT verified.')
    manifest = {'format': 'ruin-lab/vs-backup', 'version': 1, 'createdUtc': stamp,
                'verified': True, 'sqliteIntegrity': integrity, 'save': str(copied_save.relative_to(target)),
                'gameDirectory': str(args.game_dir.resolve()), 'files': records, 'modInventory': inventory}
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    # Keep an immutable-in-practice archival copy separate from the disposable working copy.
    working = root / 'local' / 'working' / stamp
    working.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(copied_save, working / source.name)
    if sha256(working / source.name) != records[0]['sha256']:
        raise RuntimeError('Working copy checksum mismatch.')
    for path in target.rglob('*'):
        if path.is_file():
            path.chmod(0o400)
    print(json.dumps({'backup': str(target.relative_to(root)), 'workingSave': str((working / source.name).relative_to(root)),
                      'bytes': copied_save.stat().st_size, 'sha256': records[0]['sha256'], 'integrity': 'ok', 'filesVerified': len(records)}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'Backup stopped: {error}', file=sys.stderr)
        sys.exit(1)
