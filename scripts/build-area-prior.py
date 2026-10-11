"""Build training-only functional-instance floor area statistics. No source writes."""
from pathlib import Path
import argparse
import hashlib
import json
import math
from collections import defaultdict, Counter

ROOT = Path(__file__).resolve().parents[2]

def quantiles(values):
    values = sorted(values)
    def q(p):
        x = (len(values)-1)*p
        i = int(x)
        return round(values[i]+(values[min(i+1,len(values)-1)]-values[i])*(x-i), 8)
    return {"p25":q(.25),"median":q(.5),"p75":q(.75)}

def floor_groups(document):
    groups = defaultdict(set)
    labels = {}
    explicit = 0
    for room in document['rooms']:
        lo, hi = room['box_min'], room['box_max']
        if any(not math.isfinite(v) or abs(v/300-round(v/300))>1e-6 for v in lo+hi):
            raise ValueError('Non-modular coordinates')
        if any(b<=a for a,b in zip(lo,hi)):
            raise ValueError('Non-positive box')
        gid = str(room.get('functional_group_id') or room['id'])
        explicit += bool(room.get('functional_group_id'))
        if gid in labels and labels[gid]!=room['type']:
            raise ValueError('Mixed-type functional group')
        labels[gid] = room['type']
        # Intersect each physical storey; tall rooms contribute one footprint per floor.
        for floor in (1,2):
            if min(hi[2],floor*3000)<=max(lo[2],(floor-1)*3000):
                continue
            groups[(floor,gid)].update((x,y) for x in range(round(lo[0]/300),round(hi[0]/300))
                                      for y in range(round(lo[1]/300),round(hi[1]/300)))
    return groups, labels, explicit

def aggregate_house(document):
    groups, labels, explicit = floor_groups(document)
    size = document['metadata']['building_size']
    footprint = size['x']*size['y']/1e6
    if not footprint>0:
        raise ValueError('Invalid building size')
    return [(floor,labels[gid],len(cells)*.09,footprint) for (floor,gid),cells in groups.items()], explicit

def build(source, manifest_path):
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    ids = manifest['training_ids']
    if len(ids)!=len(set(ids)) or set(ids)&set(manifest['validation_ids']):
        raise ValueError('Invalid training split')
    values = defaultdict(list)
    ratios = defaultdict(list)
    cases = defaultdict(set)
    floor_fractions = defaultdict(list)
    balcony_counts = defaultdict(list)
    balcony_contacts = defaultdict(Counter)
    balcony_instances = Counter()
    conditional_rows = []
    house_footprints = []
    digest = hashlib.sha256()
    grouped_records = instances = 0
    for case in sorted(ids):
        path = source/f'house_{case}.json'
        raw = path.read_bytes()
        digest.update(f'{case}:'.encode()+hashlib.sha256(raw).digest())
        document = json.loads(raw.decode('utf-8-sig'))
        rows, explicit = aggregate_house(document)
        footprint=document['metadata']['building_size']['x']*document['metadata']['building_size']['y']/1e6
        dimensions=document['metadata']['building_size']
        aspect=max(dimensions['x'],dimensions['y'])/min(dimensions['x'],dimensions['y'])
        house_footprints.append(footprint)
        counts=Counter((floor,kind) for floor,kind,_,_ in rows)
        conditional_rows.extend((floor,kind,area,size,counts[(floor,kind)],aspect,case) for floor,kind,area,size in rows)
        groups, labels, _ = floor_groups(document)
        for floor in (1,2):
            balconies = [cells for (f,gid),cells in groups.items() if f==floor and labels[gid]=='balcony']
            balcony_counts[floor].append(len(balconies))
            balcony_instances[floor] += len(balconies)
            owners = defaultdict(set)
            for (f,gid), cells in groups.items():
                if f==floor and labels[gid]!='balcony':
                    for cell in cells: owners[cell].add(labels[gid])
            for cells in balconies:
                contacts = set()
                for x,y in cells:
                    for cell in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                        contacts.update(owners.get(cell,()))
                balcony_contacts[floor].update(contacts)
        grouped_records += explicit
        instances += len(rows)
        totals = Counter()
        for floor,kind,area,footprint in rows:
            key = f'{floor}:{kind}'
            values[key].append(area)
            ratios[key].append(area/footprint)
            cases[key].add(case)
            totals[(floor,kind)] += area/footprint
        for floor in (1,2):
            for kind in ('stairs','corridor'):
                floor_fractions[f'{floor}:{kind}'].append(totals[(floor,kind)])
    bounds=quantiles(house_footprints)
    conditional=defaultdict(list)
    for floor,kind,area,footprint,count,aspect,case in conditional_rows:
        size='small' if footprint<bounds['p25'] else 'large' if footprint>bounds['p75'] else 'medium'
        shape='elongated' if aspect>=1.4 else 'compact'
        number=str(count) if count<3 else '3-4' if count<5 else '5+'
        for context in (f'{size}|{shape}|{number}',f'{size}|*|{number}',f'{size}|*|*'):
            conditional[f'{context}|{floor}:{kind}'].append((area,area/footprint,case))
    return {'schema':'training_area_prior_v1','units':'m2','training_case_count':len(ids),
        'source_directory':str(source),'split_manifest':str(manifest_path.relative_to(ROOT)),
        'source_sha256':digest.hexdigest(),'split_sha256':hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        'validation_cases_used':0,'independent_cases_used':0,'explicit_group_records':grouped_records,
        'floor_instance_count':instances,
        'grouping':'Union 300 mm XY cells by explicit functional_group_id per house/floor; otherwise original record id. No inferred adjacency merges.',
        'categories':{k:{'count':len(v),'house_count':len(cases[k]),'area':quantiles(v),'fraction':quantiles(ratios[k])} for k,v in sorted(values.items())},
        'floor_reserved_fractions':{k:quantiles(v) for k,v in sorted(floor_fractions.items())},
        'conditioning':{'footprint_p25':bounds['p25'],'footprint_p75':bounds['p75'],'minimum_instances':20,'minimum_houses':10,
            'profiles':{key:{'count':len(values),'house_count':len(set(v[2] for v in values)),'area':quantiles([v[0] for v in values]),'fraction':quantiles([v[1] for v in values])} for key,values in sorted(conditional.items())}},
        'balcony_statistics':{'relation_basis':'Same-floor shared 300 mm cell edge; geometric adjacency, not verified doors.',
            'annotation_completeness':'Not established. Counts are annotated functional instances, not verified absence/presence.',
            'by_floor':{str(f):{'house_count':len(ids),'instance_count':balcony_instances[f],
                'count_histogram':dict(sorted(Counter(balcony_counts[f]).items())),
                'median_count':quantiles(balcony_counts[f])['median'],
                'contact_counts':dict(sorted(balcony_contacts[f].items()))} for f in (1,2)}}}

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',type=Path,default=ROOT.parent/'GraphSpace/data/processed_1')
    args=parser.parse_args()
    profile=build(args.source,ROOT/'data/05_review_drafts/training_v1/manifest.json')
    output=ROOT/'website/generator-studio/area-prior.json'
    output.write_text(json.dumps(profile,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:profile[k] for k in ['training_case_count','explicit_group_records','floor_instance_count','source_sha256']}))
