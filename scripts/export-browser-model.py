"""Export the existing CVA checkpoint, and Python inference reference cases."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import torch

ROOT = Path('E:/Documents/GraphSpace')
SOURCE = ROOT / 'outputs/261006_hgnn_cva_demo_1'
DEST = Path(__file__).resolve().parents[1] / 'generator-studio'
sys.path.insert(0, str(ROOT / 'scripts/hgnn_cva_demo'))
from model import HGNN_CVA, features

DEST.mkdir(exist_ok=True)
checkpoint = torch.load(SOURCE / 'model.pt', map_location='cpu', weights_only=True)
model = HGNN_CVA().eval()
model.load_state_dict(checkpoint['model'])
payload = {
    'architecture': 'HGNN_CVA', 'epoch': checkpoint['epoch'],
    'source_sha256': hashlib.sha256((SOURCE / 'model.pt').read_bytes()).hexdigest(),
    'scope': 'Full-program-conditioned demo; not project-wide admission.',
    'weights': {key: {'shape': list(value.shape), 'data': value.flatten().tolist()}
                for key, value in checkpoint['model'].items()},
}
(DEST / 'model.json').write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
references = []
for length, width, beds, baths in [(10800,10800,3,2), (12000,9900,2,1), (15000,12000,5,3), (18000,18000,8,8)]:
    program = json.loads(subprocess.check_output(
        ['D:/Installation_Directory/nodejs/node.exe', str(SOURCE / 'generate.cjs')],
        input=json.dumps({'bedrooms':beds, 'bathrooms':baths, 'programOnly':True}).encode()))
    query = [{'key':'stairs','label':7,'floors':[0,1],'targetArea':5.76}] + [{**r, 'floors':[r['floor']]} for r in program]
    query.sort(key=lambda r:(r['label'],r['floors'],r['key']))
    x = torch.tensor(features(query,length,width))[None]
    with torch.no_grad():
        center, scale, bias, empty = model.parameters_for(x, torch.ones(x.shape[:2]))
        logits, _ = model(x, torch.ones(x.shape[:2]))
    references.append({'length':length,'width':width,'program':program,'keys':[r['key'] for r in query],
        'center':center[0].tolist(),'scale':scale[0].tolist(),'bias':bias[0].tolist(),
        'empty':empty[0].tolist(),'assignments':logits.argmax(1)[0].tolist()})
(DEST.parent / 'scripts/browser-model-reference.json').write_text(json.dumps(references), encoding='utf-8')
print(json.dumps({'epoch':payload['epoch'],'bytes':(DEST / 'model.json').stat().st_size,'references':len(references)}))
