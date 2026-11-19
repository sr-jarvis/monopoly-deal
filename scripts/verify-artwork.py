#!/usr/bin/env python3
"""Verify the complete shipped PNG set and actual deck mappings over HTTP.
Run from the repository root: python3 scripts/verify-artwork.py ORIGIN OUTPUT.json
No mutation, credentials or dependencies; exits nonzero on any missing/invalid asset.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

root = Path(__file__).resolve().parents[1]
origin, output = sys.argv[1:]
cards = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(new(require('./server/models/Deck'))().cards.map(c=>({title:c.title,path:c.imageLocation}))))"], cwd=root))
files = sorted((root / 'client/public/assets/imgs').rglob('*.png'))
shipped = {str(p.relative_to(root / 'client/public')): p for p in files}
mapping_errors = [c for c in cards if c['path'] not in shipped]
results = []
for path, local in shipped.items():
    req = urllib.request.Request(origin.rstrip('/') + '/' + urllib.parse.quote(path, safe='/'))
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            body = response.read()
            results.append({'path': path, 'status': response.status, 'mime': response.headers.get_content_type(), 'png': body.startswith(b'\x89PNG\r\n\x1a\n'), 'matches_source': hashlib.sha256(body).digest() == hashlib.sha256(local.read_bytes()).digest()})
    except urllib.error.HTTPError as error:
        results.append({'path': path, 'status': error.code, 'mime': error.headers.get_content_type(), 'png': False, 'matches_source': False})
try:
    response = urllib.request.urlopen(origin.rstrip('/') + '/assets/imgs/definitely-not-a-card.png', timeout=10)
    missing_status = response.status
    response.close()
except urllib.error.HTTPError as error:
    missing_status = error.code
passed = not mapping_errors and missing_status == 404 and all(r['status'] == 200 and r['mime'] == 'image/png' and r['png'] and r['matches_source'] for r in results)
report = {'origin': origin, 'catalog_cards': len(cards), 'catalog_unique_paths': len({c['path'] for c in cards}), 'shipped_pngs': len(shipped), 'mapping_errors': mapping_errors, 'catalog_mapping': sorted(cards, key=lambda c: (c['path'], c['title'])), 'results': results, 'missing_status': missing_status, 'passed': passed}
Path(output).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k not in ('results', 'catalog_mapping')}))
sys.exit(0 if passed else 1)
