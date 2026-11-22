import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import pet_manager as manager
import setup as installer
from PIL import Image

class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'input'
        self.source.mkdir()
        self.output = self.root / 'project'
        self.output.mkdir()
        self.patch = patch.multiple(manager, ROOT=self.output, PROFILES=self.output / 'profiles')
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def model(self, refs):
        file = self.source / 'test.model3.json'
        file.write_text(json.dumps({'Version': 3, 'FileReferences': refs}), encoding='utf-8')
        return file

    def test_rejects_missing_files_without_registering_profile(self):
        file = self.model({'Moc': 'missing.moc3', 'Textures': ['texture.png']})
        with self.assertRaises(FileNotFoundError): manager.import_model(file, 'missing')
        self.assertEqual(manager.profiles(), [])

    def test_rejects_reference_outside_model_folder(self):
        (self.root / 'outside.moc3').write_bytes(b'fixture')
        file = self.model({'Moc': '../outside.moc3', 'Textures': ['texture.png']})
        with self.assertRaises(ValueError): manager.import_model(file, 'escape')
        self.assertEqual(manager.profiles(), [])

    def test_import_preserves_source_and_separates_role_settings(self):
        (self.source / 'test.moc3').write_bytes(b'import-fixture-not-a-real-model')
        Image.new('RGBA', (4096, 64), (20, 40, 80, 255)).save(self.source / 'texture.png')
        (self.source / 'Exp3').mkdir()
        (self.source / 'Exp3/smile.exp3.json').write_text(json.dumps({'Parameters': []}))
        file = self.model({'Moc': 'test.moc3', 'Textures': ['texture.png']})
        before = {p.relative_to(self.source): hashlib.sha256(p.read_bytes()).digest()
                  for p in self.source.rglob('*') if p.is_file()}
        first = manager.import_model(file, 'one')
        second = manager.import_model(file, 'two')
        self.assertNotEqual(first['id'], second['id'])
        self.assertTrue((manager.data_dir(first) / 'settings.json').exists())
        self.assertTrue((manager.data_dir(second) / 'settings.json').exists())
        imported = self.output / first['model']
        with Image.open(imported.parent / 'texture.png') as img: self.assertEqual(img.width, 2048)
        self.assertEqual(manager.read_json(imported)['FileReferences']['Expressions'][0]['Name'], 'smile')
        after = {p.relative_to(self.source): hashlib.sha256(p.read_bytes()).digest()
                 for p in self.source.rglob('*') if p.is_file()}
        self.assertEqual(before, after)

    def test_installer_rejects_zip_path_escape(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w') as z: z.writestr('../outside.txt', 'bad')
        archive.seek(0)
        with self.assertRaises(ValueError): installer.extract_checked(archive, self.output)
        self.assertFalse((self.root / 'outside.txt').exists())

if __name__ == '__main__': unittest.main()
