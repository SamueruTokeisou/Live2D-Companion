import unittest,sys, tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from setup_voice import safe_members
from voice_preview import synthesize

class VoiceFoundationTests(unittest.TestCase):
 def test_archive_paths_are_contained(self):
  safe_members(['GPT-SoVITS/api_v2.py','GPT-SoVITS/runtime/python.exe'])
  for name in ['../outside','a/../../outside','/absolute','C:/outside','a\\..\\..\\outside','a:stream']:
   with self.subTest(name=name),self.assertRaises(ValueError): safe_members([name])
 def test_reference_can_never_be_overwritten(self):
  with tempfile.TemporaryDirectory() as temp:
   file=Path(temp)/'reference.wav';file.write_bytes(b'original')
   with self.assertRaises(ValueError): synthesize(file,'reference','output',file)
   self.assertEqual(file.read_bytes(),b'original')
 def test_invalid_text_never_calls_service(self):
  with tempfile.TemporaryDirectory() as temp:
   file=Path(temp)/'reference.wav';file.write_bytes(b'original')
   for prompt,text in [('', 'hello'),('reference',''),('reference','x'*501)]:
    with self.subTest(prompt=prompt,text=text),self.assertRaises(ValueError): synthesize(file,prompt,text,Path(temp)/'out.wav')

if __name__=='__main__': unittest.main()
