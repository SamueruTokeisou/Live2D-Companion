"""Private local persistence and cross-process operation locks."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import time
import uuid

SCHEMA = 1


def validate_config(value):
    if not isinstance(value, dict):
        raise ValueError('配置必须是对象')
    version = value.get('schemaVersion', 0)
    if type(version) is not int or version < 0 or version > SCHEMA:
        raise ValueError('配置版本不受支持；请勿用旧程序覆盖新配置')
    return value


def atomic_json(path, data, backup=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('w', encoding='utf-8') as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        if backup and path.exists():
            old = validate_config(json.loads(path.read_text(encoding='utf-8-sig')))
            atomic_json(path.with_suffix(path.suffix + '.bak'), old)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def read_config(path):
    path = Path(path)
    try:
        value = validate_config(json.loads(path.read_text(encoding='utf-8-sig')))
    except (FileNotFoundError, ValueError, UnicodeError):
        if not path.exists() and not path.with_suffix(path.suffix + '.bak').exists():
            raise FileNotFoundError(path)
        # A future schema is deliberately not recovered/overwritten.
        try:
            raw = json.loads(path.read_text(encoding='utf-8-sig'))
            if isinstance(raw, dict) and raw.get('schemaVersion', 0) > SCHEMA:
                raise RuntimeError('配置来自更新版本，请更新程序后再打开')
        except (OSError, ValueError, UnicodeError, TypeError):
            pass
        try:
            value = validate_config(json.loads(path.with_suffix(path.suffix + '.bak').read_text(encoding='utf-8-sig')))
        except (OSError, ValueError, UnicodeError) as error:
            raise RuntimeError('配置损坏且没有有效备份，请保留文件并按配置恢复说明处理：' + path.name) from error
        preserved = path.with_name(path.name + '.corrupt-' + uuid.uuid4().hex)
        if path.exists(): path.replace(preserved)
        atomic_json(path, value)
        atomic_json(path.with_suffix(path.suffix + '.recovery.json'), {'schemaVersion': SCHEMA, 'recovered': True, 'preserved': preserved.name})
    if value.get('schemaVersion', 0) == 0:
        value = {**value, 'schemaVersion': SCHEMA}
        atomic_json(path, value, backup=True)
    return value


@contextmanager
def operation_lock(path, timeout=30):
    """OS releases the advisory lock even after a crash; never delete lock files."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    stream = path.open('a+b')
    if stream.tell() == 0:
        stream.write(b'0')
        stream.flush()
    deadline = time.monotonic() + timeout
    try:
        while True:
            try:
                stream.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError('已有操作正在进行，请稍后重试')
                time.sleep(0.1)
        yield
    finally:
        stream.close()
