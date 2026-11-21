#!/usr/bin/env python3
"""Verify all retained PNGs and generated SVGs over the owner's HTTP origin.
Run: python3 scripts/verify-artwork.py ORIGIN OUTPUT.json
Read-only HTTP checks; no services started, credentials or dependencies.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def valid_svg(body):
    try:
        root = ET.fromstring(body)
        allowed = {'svg', 'rect', 'path', 'circle', 'ellipse', 'g', 'text', 'title', 'desc', 'line'}
        return (root.tag == '{http://www.w3.org/2000/svg}svg'
                and root.attrib.get('viewBox') == '0 0 360 560'
                and root.attrib.get('width') == '360' and root.attrib.get('height') == '560'
                and all(e.tag.startswith('{http://www.w3.org/2000/svg}')
                        and e.tag.split('}')[-1] in allowed
                        and not any(k.lower().startswith('on') or 'href' in k.lower() for k in e.attrib)
                        and not any('url(' in v.lower() or 'http' in v.lower() for v in e.attrib.values())
                        for e in root.iter()))
    except ET.ParseError:
        return False


def inspect(origin, path, local):
    kind = 'svg' if path.endswith('.svg') else 'png'
    result = {'path': path, 'kind': kind, 'status': None, 'mime': None,
              'matches_source': False, kind: False}
    req = urllib.request.Request(origin.rstrip('/') + '/' + urllib.parse.quote(path, safe='/'))
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            body = response.read()
            result.update(status=response.status, mime=response.headers.get_content_type(),
                          matches_source=hashlib.sha256(body).digest() == hashlib.sha256(local.read_bytes()).digest())
            result[kind] = valid_svg(body) if kind == 'svg' else body.startswith(b'\x89PNG\r\n\x1a\n')
    except urllib.error.HTTPError as error:
        result.update(status=error.code, mime=error.headers.get_content_type())
    except (urllib.error.URLError, OSError) as error:
        result['error'] = str(error)
    return result


def missing_status(origin, path):
    try:
        with urllib.request.urlopen(origin.rstrip('/') + path, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except (urllib.error.URLError, OSError):
        return None


def verify(origin):
    cards = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(new(require('./server/models/Deck'))().cards.map(c=>({title:c.title,path:c.imageLocation}))))"], cwd=ROOT))
    files = sorted((ROOT / 'client/public/assets/imgs').rglob('*.png'))
    shipped = {str(p.relative_to(ROOT / 'client/public')): p for p in files}
    manifest = json.loads((ROOT / 'client/public/assets/vector-cards/manifest.json').read_text())
    svg_files = sorted((ROOT / 'client/public/assets/vector-cards').glob('*.svg'))
    vectors = {str(p.relative_to(ROOT / 'client/public')): p for p in svg_files}
    faces = {f['png'].lstrip('/'): f for f in manifest['faces']}
    mapping_errors = [c for c in cards if c['path'] not in shipped or c['path'] not in faces
                      or faces[c['path']]['svg'].lstrip('/') not in vectors]
    instances_match = sorted(i['png'].lstrip('/') for i in manifest['instances']) == sorted(c['path'] for c in cards)
    results = [inspect(origin, path, local) for path, local in {**shipped, **vectors}.items()]
    missing_png = missing_status(origin, '/assets/imgs/definitely-not-a-card.png')
    missing_svg = missing_status(origin, '/assets/vector-cards/definitely-not-a-card.svg')
    passed = (len(cards) == 106 and len(shipped) == 61 and len(vectors) == len(faces) == 58
              and not mapping_errors and instances_match and missing_png == missing_svg == 404
              and all(r['status'] == 200 and r['mime'] == ('image/svg+xml' if r['kind'] == 'svg' else 'image/png')
                      and r[r['kind']] and r['matches_source'] for r in results))
    return {'origin': origin, 'catalog_cards': len(cards), 'catalog_unique_paths': len({c['path'] for c in cards}),
            'shipped_pngs': len(shipped), 'shipped_svgs': len(vectors), 'mapping_errors': mapping_errors,
            'instances_match': instances_match, 'catalog_mapping': sorted(cards, key=lambda c:(c['path'],c['title'])),
            'results': results, 'missing_status': missing_png, 'missing_svg_status': missing_svg, 'passed': passed}


def main():
    origin, output = sys.argv[1:]
    report = verify(origin)
    Path(output).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('results','catalog_mapping')}))
    sys.exit(0 if report['passed'] else 1)


if __name__ == '__main__':
    main()
