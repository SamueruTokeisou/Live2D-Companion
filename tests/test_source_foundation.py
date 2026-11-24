import hashlib,json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from prepare_source import ROOT,prepare
from check_publication import private_machine_path
class SourceFoundationTests(unittest.TestCase):
 def test_personal_paths_are_not_limited_to_one_username(self):
  for name in ['private-person','331'+'53','another-account']:
   self.assertTrue(private_machine_path('C:'+'/Users/'+name+'/project'))
   self.assertTrue(private_machine_path('D:'+'\\Users\\'+name+'\\project'))
  for name in ['<user>','USERNAME','Public']:
   self.assertFalse(private_machine_path('C:'+'/Users/'+name+'/project'))
 def test_composition_excludes_private_assets_and_native_experiments(self):
  parent=ROOT/'runtime/source-build';parent.mkdir(parents=True,exist_ok=True)
  with tempfile.TemporaryDirectory(dir=parent) as temporary:
   folder=Path(temporary);core=folder/'fixture-core.js';core.write_text('// synthetic test fixture, not a Core implementation')
   out=prepare(core,folder/'app')
   self.assertTrue((out/'companion/kernel/event-kernel.mjs').is_file())
   self.assertFalse((out/'native').exists());self.assertFalse((out/'tools').exists());self.assertFalse((out/'models').exists())
   record=json.loads((out/'build-inputs.json').read_text());key='companion/kernel/event-kernel.mjs'
   self.assertEqual(record['inputs'][key],hashlib.sha256((out/key).read_bytes()).hexdigest())
 def test_composition_refuses_output_outside_build_workspace(self):
  with tempfile.TemporaryDirectory() as temporary:
   core=Path(temporary)/'fixture.js';core.write_text('test')
   with self.assertRaises(ValueError):prepare(core,Path(temporary)/'outside')
