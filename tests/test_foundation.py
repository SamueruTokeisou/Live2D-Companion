import json
import subprocess
import sys
import threading
from pathlib import Path
from unittest.mock import patch
import test_import
from local_state import atomic_json, read_config, operation_lock
import pet_manager as manager


class FoundationTests(test_import.unittest.TestCase):
    setUp = test_import.ImportTests.setUp
    model = test_import.ImportTests.model
    def fixture(self):
        from PIL import Image
        (self.source / 'test.moc3').write_bytes(b'fixture')
        Image.new('RGBA', (64, 64)).save(self.source / 'texture.png')
        return self.model({'Moc': 'test.moc3', 'Textures': ['texture.png']})

    def assert_empty(self):
        self.assertEqual(manager.profiles(), [])
        self.assertEqual(list((self.output / 'models').glob('*')), [])
        self.assertEqual(list((self.output / 'data').glob('role-*')), [])

    def test_cancel_during_copy_rolls_back(self):
        file = self.fixture()
        cancel = threading.Event()
        def progress(text):
            if '复制' in text: cancel.set()
        with self.assertRaises(manager.ImportCancelled):
            manager.import_model(file, 'cancel', progress=progress, cancel=cancel)
        self.assert_empty()

    def test_texture_failure_rolls_back(self):
        file = self.fixture()
        (self.source / 'texture.png').write_bytes(b'invalid-png')
        with self.assertRaises(OSError): manager.import_model(file, 'bad texture')
        self.assert_empty()
        self.assertEqual((self.source / 'texture.png').read_bytes(), b'invalid-png')

    def test_profile_commit_failure_rolls_back(self):
        file = self.fixture()
        original = manager.atomic_json
        def failing(path, data, **kw):
            if Path(path).parent == manager.PROFILES: raise OSError('disk-full-fixture')
            original(path, data, **kw)
        with patch.object(manager, 'atomic_json', failing):
            with self.assertRaises(OSError): manager.import_model(file, 'commit failure')
        self.assert_empty()

    def test_configuration_migrates_recovers_and_preserves_unknown_fields(self):
        file = self.output / 'settings.json'
        atomic_json(file, {'zoom': 0.8, 'custom': {'keep': True}})
        first = read_config(file)
        self.assertEqual(first['schemaVersion'], 1)
        self.assertEqual(first['custom'], {'keep': True})
        atomic_json(file, {**first, 'zoom': 1}, backup=True)
        file.write_text('{broken')
        recovered = read_config(file)
        self.assertEqual(recovered['zoom'], 0.8)
        self.assertEqual(len(list(file.parent.glob('settings.json.corrupt-*'))), 1)

    def test_configuration_without_backup_is_not_overwritten(self):
        file = self.output / 'settings.json'
        file.write_text('{broken')
        with self.assertRaises(RuntimeError): read_config(file)
        self.assertEqual(file.read_text(), '{broken')

    def test_future_config_is_not_downgraded(self):
        file = self.output / 'settings.json'
        atomic_json(file, {'schemaVersion': 9})
        atomic_json(file.with_suffix('.json.bak'), {'schemaVersion': 1})
        with self.assertRaises(RuntimeError): read_config(file)
        self.assertEqual(json.loads(file.read_text())['schemaVersion'], 9)

    def test_cross_process_lock_excludes_then_recovers(self):
        file = self.output / 'operation.lock'
        code = 'from local_state import operation_lock\nimport sys\nwith operation_lock(sys.argv[1], timeout=0): pass'
        env = dict(__import__('os').environ, PYTHONPATH=str(Path(manager.__file__).parent))
        with operation_lock(file):
            result = subprocess.run([sys.executable, '-c', code, str(file)], env=env, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
        result = subprocess.run([sys.executable, '-c', code, str(file)], env=env, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)


    def test_missing_primary_restores_backup(self):
        file = self.output / 'settings.json'
        atomic_json(file.with_suffix('.json.bak'), {'schemaVersion': 1, 'zoom': 2})
        self.assertEqual(read_config(file)['zoom'], 2)
        self.assertTrue(file.exists())

    def test_failed_import_does_not_change_existing_role(self):
        import hashlib
        file = self.fixture()
        existing = manager.import_model(file, 'existing')
        def snapshot():
            return {str(p.relative_to(self.output)): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in self.output.rglob('*') if p.is_file()}
        before = snapshot()
        (self.source / 'texture.png').write_bytes(b'invalid-png')
        with self.assertRaises(OSError): manager.import_model(file, 'failure')
        self.assertEqual(snapshot(), before)
        self.assertEqual(manager.profiles()[0]['id'], existing['id'])

    def test_atomic_replace_failure_keeps_previous_config(self):
        file = self.output / 'settings.json'
        atomic_json(file, {'schemaVersion': 1, 'zoom': 2})
        with patch('local_state.os.replace', side_effect=OSError('fixture-disk-error')):
            with self.assertRaises(OSError): atomic_json(file, {'schemaVersion': 1, 'zoom': 3})
        self.assertEqual(read_config(file)['zoom'], 2)
        self.assertEqual(list(self.output.glob('*.tmp')), [])

    def test_crashed_process_releases_lock(self):
        file = self.output / 'crash.lock'
        code = 'from local_state import operation_lock\nimport sys,time\nwith operation_lock(sys.argv[1]):\n print("ready",flush=True)\n time.sleep(60)'
        env = dict(__import__('os').environ, PYTHONPATH=str(Path(manager.__file__).parent))
        child = subprocess.Popen([sys.executable, '-c', code, str(file)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            child.kill()
            child.wait(timeout=5)
            with operation_lock(file, timeout=0): pass
        finally:
            if child.poll() is None: child.kill(); child.wait(timeout=5)
            child.stdout.close(); child.stderr.close()
