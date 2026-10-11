import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('builder',Path(__file__).with_name('build-area-prior.py'))
builder=importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

def fixture():
    return {'metadata':{'building_size':{'x':1200,'y':600}},'rooms':[
        {'id':'a','type':'bedroom','functional_group_id':'suite','box_min':[0,0,0],'box_max':[600,600,6000]},
        {'id':'b','type':'bedroom','functional_group_id':'suite','box_min':[300,0,0],'box_max':[900,600,3000]},
        {'id':'c','type':'bedroom','box_min':[900,0,0],'box_max':[1200,600,3000]}]}

class TestAreaPrior(unittest.TestCase):
    def test_union_and_storeys_without_inferred_merging(self):
        rows,_=builder.aggregate_house(fixture())
        self.assertEqual(sorted(round(r[2],2) for r in rows),[.18,.36,.54])
        self.assertEqual(len(rows),3)

    def test_only_training_files_are_read(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            (root/'house_1.json').write_text(json.dumps(fixture()))
            (root/'house_2.json').write_text('invalid held-out data')
            manifest=builder.ROOT/'area-prior-test-manifest.tmp.json'
            try:
                manifest.write_text(json.dumps({'training_ids':[1],'validation_ids':[2]}))
                first=builder.build(root,manifest)
                (root/'house_2.json').write_text('changed but still invalid')
                self.assertEqual(first,builder.build(root,manifest))
                self.assertEqual(first['validation_cases_used'],0)
            finally:
                manifest.unlink(missing_ok=True)

    def test_balcony_counts_and_contacts_are_grouped_per_floor(self):
        document=fixture()
        document['rooms'] += [
            {'id':'d','type':'balcony','functional_group_id':'balcony','box_min':[0,600,0],'box_max':[300,900,3000]},
            {'id':'e','type':'balcony','functional_group_id':'balcony','box_min':[300,600,0],'box_max':[600,900,3000]}]
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)
            (source/'house_1.json').write_text(json.dumps(document))
            manifest=builder.ROOT/'balcony-prior-test-manifest.tmp.json'
            try:
                manifest.write_text(json.dumps({'training_ids':[1],'validation_ids':[]}))
                stats=builder.build(source,manifest)['balcony_statistics']['by_floor']
                self.assertEqual(stats['1']['median_count'],1)
                self.assertEqual(stats['1']['instance_count'],1)
                self.assertEqual(stats['1']['contact_counts'],{'bedroom':1})
                self.assertEqual(stats['2']['median_count'],0)
            finally: manifest.unlink(missing_ok=True)

if __name__=='__main__':unittest.main()
