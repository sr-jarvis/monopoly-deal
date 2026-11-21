'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const directory = path.join(root, 'client/public/assets/vector-cards');
const Deck = require('../models/Deck');
const fixture = require('../fixtures/hasbro-b0965-catalog.json');
function loadUtility() {
  const source = fs.readFileSync(path.join(root, 'client/src/utils/vectorArtwork.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, esModuleInterop: true}}).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {exports, require: p => {
    assert.ok(p.endsWith('vector-cards/manifest.json'));
    return JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
  }});
  return exports;
}
function loadView(react = require('react')) {
  const source = fs.readFileSync(path.join(root, 'client/src/components/CardView.tsx'), 'utf8');
  const output = ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.React
  }}).outputText;
  const exports = {};
  function loadTS(relative) {
    const code = ts.transpileModule(fs.readFileSync(path.join(root, 'client/src/utils', relative + '.ts'), 'utf8'),
      {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
    const value = {};
    vm.runInNewContext(code, {exports:value, require:() => ({})});
    return value;
  }
  vm.runInNewContext(output, {exports, require:p => {
    if (p === 'react') return react;
    if (p.endsWith('/vectorArtwork')) return loadUtility();
    if (p.endsWith('/publicWildcardOrientation')) return loadTS('publicWildcardOrientation');
    if (p.endsWith('/touchCardFlipEngine')) return loadTS('touchCardFlipEngine');
    if (p.endsWith('/CardBackView')) return {CardBackView:() => react.createElement('span', null, 'Card back')};
    if (p.endsWith('/dragAndDropEngine')) return {};
    throw new Error('Unexpected import '+p);
  }});
  return exports;
}
describe('Pocket Atlas original vector catalog', function () {
  this.timeout(10000);
  it('ships an exact playable-deck manifest, including every native property', () => {
    assert.ok(fs.existsSync(path.join(directory, 'manifest.json')), 'generated coverage manifest must exist');
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
    assert.equal(manifest.instances.length, fixture.playableTotalCards);
    assert.equal(manifest.faces.length, 58);
    assert.equal(manifest.faces.filter(f => f.kind === 'PROPERTY').length, 28);
    const cards = new Deck().cards;
    for (const card of cards) {
      const matches = manifest.instances.filter(i => i.png === '/' + card.imageLocation);
      assert.equal(matches.length, cards.filter(c => c.imageLocation === card.imageLocation).length);
      const face = manifest.faces.find(f => f.png === '/' + card.imageLocation);
      assert.equal(face.title, card.title);
      assert.equal(face.value, card.value);
      assert.equal(face.kind, card.kind);
      assert.deepEqual(face.colors, card.colors || []);
      if (card.kind === 'ACTION') assert.equal(face.description, card.description);
      if (card.kind === 'PROPERTY') {
        const {RENT_TIERS,COMPLETE_SET_SIZE} = require('../card_catalog');
        assert.equal(face.color,card.color);
        assert.deepEqual(face.rentTiers,RENT_TIERS[card.color]);
        assert.equal(face.completeSetSize,COMPLETE_SET_SIZE[card.color]);
      }
    }
  });
  it('maps trusted paths and exact semantics, never arbitrary image URLs', () => {
    const {resolveVectorArtwork} = loadUtility();
    for (const card of new Deck().cards) {
      const art = resolveVectorArtwork(card);
      assert.ok(art?.svg.startsWith('/assets/vector-cards/'));
      assert.equal(art.png, '/' + card.imageLocation);
      assert.equal(resolveVectorArtwork({...card,imageLocation:'/'+card.imageLocation})?.svg,art.svg);
      assert.equal(resolveVectorArtwork({...card,imageLocation:undefined,imageUrl:card.imageLocation})?.svg,art.svg);
      const semantic = {...card}; delete semantic.imageLocation; delete semantic.id;
      assert.equal(resolveVectorArtwork(semantic)?.svg, art.svg);
      if (card.colors) {
        semantic.colors = [...card.colors].reverse();
        assert.equal(resolveVectorArtwork(semantic)?.svg, art.svg);
      }
    }
    for (const imageLocation of ['https://evil.invalid/card.svg', '//evil.invalid/card.svg', 'data:image/svg+xml,<svg/>', '/assets/imgs/../x.svg', '/assets/vector-cards/evil.svg']) {
      assert.equal(resolveVectorArtwork({imageLocation}), null);
      const valid = new Deck().propertyCards[0];
      assert.equal(resolveVectorArtwork({...valid, imageLocation})?.png, '/' + valid.imageLocation);
    }
    assert.equal(resolveVectorArtwork({kind:'PROPERTY', title:'Unknown', value:1}), null);
    assert.equal(resolveVectorArtwork({kind:'WILDCARD', title:'Property Wild Card', value:4, colors:['Green','Utility']}), null);
  });
  it('is byte-reproducible and all SVGs are safe, complete XML with authoritative rents', () => {
    const result = execFileSync('python3', ['scripts/generate-vector-cards.py', '--check'], {cwd:root, encoding:'utf8'});
    assert.match(result, /106 instances.*58 faces/);
    const validation = execFileSync('python3', ['-c', `import json, pathlib, subprocess, xml.etree.ElementTree as ET
p=pathlib.Path('client/public/assets/vector-cards')
m=json.loads((p/'manifest.json').read_text())
rents=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./server/card_catalog').RENT_TIERS))"]))
for f in m['faces']:
 r=ET.fromstring((p/pathlib.Path(f['svg']).name).read_text())
 assert r.attrib['viewBox']=='0 0 360 560'
 assert r.attrib['width']=='360' and r.attrib['height']=='560'
 for e in r.iter():
  assert e.tag.split('}')[-1] in {'svg','rect','path','circle','ellipse','g','text','title','desc','line'}
  assert not any(k.lower().startswith('on') or 'href' in k for k in e.attrib)
  assert not any('url(' in v or 'http' in v for v in e.attrib.values())
 text=' '.join(r.itertext())
 assert f['title'] in text
 assert f\"{f['value']}M\" in text
 if f['kind']=='PROPERTY':
  for i,rent in enumerate(f['rentTiers'],1): assert f'{i} · {rent}M' in text
 if f['kind']=='ACTION':
  assert ' '.join(f['description'].split()) in ' '.join(text.split())
 if f['kind'] in ('WILDCARD','RENT') and len(f['colors'])==2:
  assert any(e.attrib.get('transform')=='rotate(180 180 280)' for e in r.iter())
  for c in f['colors']:
   for i,rent in enumerate(rents[c],1): assert f'{i} · {rent}M' in text
 if f['kind']=='WILDCARD' and len(f['colors'])==10:
  for c in f['colors']: assert ' / '.join(f'{v}M' for v in rents[c]) in text
print('58 safe SVG XML faces validated')`], {cwd:root,encoding:'utf8'});
    assert.match(validation, /58 safe SVG/);
  });
  it('renders both original vector wild ends, preserves public rotation, and never injects SVG', () => {
    const React = require('react');
    const {renderToStaticMarkup} = require('react-dom/server');
    const {CardView} = loadView();
    const cards = new Deck().wildcards.filter(c => c.colors.length === 2);
    for (const card of cards) {
      const art = loadUtility().resolveVectorArtwork(card);
      const hand = renderToStaticMarkup(React.createElement(CardView,{card}));
      assert.equal((hand.match(/data-artwork-format="svg"/g)||[]).length,2);
      assert.match(hand, /transform:rotate\(180deg\)/);
      assert.ok(hand.includes(`Flip card to ${art.bottomColor}`));
      const publicCard = renderToStaticMarkup(React.createElement(CardView,{card,publicPropertyGroup:art.bottomColor+'#2'}));
      assert.match(publicCard, /data-property-rotation="180"/);
      assert.match(publicCard, /transform:rotate\(180deg\)/);
      assert.equal((publicCard.match(/data-artwork-format="svg"/g)||[]).length,1);
      assert.ok(!hand.includes('<svg'));
    }
  });
  it('executes SVG error → retained PNG → text, retaining rotation on both images', () => {
    // Focused hook harness: runs the real component and real onError callbacks;
    // browser mounting/remount behavior is an owner integration gate.
    const React = require('react');
    let state = 'svg';
    const react = {...React,useState:() => [state,update => {state=typeof update==='function'?update(state):update;} ]};
    const {CardArtworkImage} = loadView(react);
    const artwork = loadUtility().resolveVectorArtwork(new Deck().wildcards[0]);
    const props = {artwork,title:'Test wild',rotation:180,children:'final text'};
    let element = CardArtworkImage(props);
    assert.equal(element.props.src, artwork.svg);
    assert.equal(element.props.style.transform, 'rotate(180deg)');
    element.props.onError();
    element = CardArtworkImage(props);
    assert.equal(element.props.src, artwork.png);
    assert.equal(element.props['data-artwork-format'], 'png');
    assert.equal(element.props.style.transform, 'rotate(180deg)');
    element.props.onError();
    element = CardArtworkImage(props);
    assert.equal(element.props.children,'final text');
    const source = fs.readFileSync(path.join(root,'client/src/components/CardView.tsx'),'utf8');
    assert.equal((source.match(/key=\{artwork.svg\}/g)||[]).length,2,'both keyed image states reset on face change');
  });
  it('HTTP verifier preserves all PNG checks and rejects MIME, digest, XML and non-404 SVG failures', () => {
    const result = execFileSync('python3',['-B','-c',`import importlib.util, pathlib, urllib.error, urllib.parse
from email.message import Message
p=pathlib.Path('scripts/verify-artwork.py')
s=importlib.util.spec_from_file_location('artwork_verify',p)
v=importlib.util.module_from_spec(s); s.loader.exec_module(v)
mode='good'
class Response:
 def __init__(self,body,mime,status=200):
  self.body=body;self.status=status;self.headers=Message();self.headers['Content-Type']=mime
 def __enter__(self): return self
 def __exit__(self,*args): pass
 def read(self): return self.body
def fake_open(request,timeout):
 url=request.full_url if hasattr(request,'full_url') else request
 path=urllib.parse.unquote(urllib.parse.urlsplit(url).path)
 if 'definitely-not' in path:
  if mode=='missing' and path.endswith('.svg'): return Response(b'fallback','text/html')
  raise urllib.error.HTTPError(url,404,'Not found',Message(),None)
 body=(v.ROOT/'client/public'/path.lstrip('/')).read_bytes()
 mime='image/svg+xml' if path.endswith('.svg') else 'image/png'
 if mode=='mime' and path.endswith('.svg'): mime='text/html'
 if mode=='digest' and path.endswith('.svg'): body+=b' '
 if mode=='xml' and path.endswith('.svg'): body=b'<svg broken'
 return Response(body,mime)
v.urllib.request.urlopen=fake_open
for mode in ['good','mime','digest','xml','missing']:
 r=v.verify('http://offline-fixture.invalid')
 assert r['shipped_pngs']==61 and r['shipped_svgs']==58
 assert len(r['results'])==119
 assert r['passed']==(mode=='good'), mode
assert not v.valid_svg(b'<svg xmlns="http://www.w3.org/2000/svg" width="360" height="560" viewBox="0 0 360 560"><script/></svg>')
print('offline HTTP transport: 119 assets; 4 negative cases rejected')`],{cwd:root,encoding:'utf8'});
    assert.match(result,/119 assets; 4 negative cases rejected/);
  });
});
