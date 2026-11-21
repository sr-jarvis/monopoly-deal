#!/usr/bin/env python3
"""Reproducible original Pocket Atlas art; stdlib Python + trusted local Node.

Deck instances, descriptions, denominations and paths come from the real Deck;
rents come from card_catalog. No randomness, network, raster conversion or fonts.
"""
import argparse
from collections import Counter
import hashlib
from html import escape
import json
from pathlib import Path
import subprocess
import textwrap

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'client/public/assets/vector-cards'
COLORS = {'Brown':'#8c5d42', 'LightBlue':'#76bdd3', 'Orange':'#ed923f',
          'Red':'#cf5350', 'Yellow':'#e5c856', 'Green':'#368b6c',
          'DarkBlue':'#385699', 'Railroad':'#4c5960', 'Utility':'#848e7b', 'Purple':'#b5719e'}
# Preserve the inspected PNG's top/bottom orientation and publicWildcardRotation.
ENDS = [('Green','DarkBlue'), ('Brown','LightBlue'), ('LightBlue','Railroad'),
        ('Green','Railroad'), ('Railroad','Utility'), ('Orange','Purple'), ('Red','Yellow')]
SOURCE_PATHS = ['server/models/Deck.js', 'server/models/Card.js',
                'server/models/PropertyCard.js', 'server/models/Wildcard.js',
                'server/models/RentCard.js', 'server/models/ActionCard.js',
                'server/models/MoneyCard.js', 'server/models/PropertyType.js',
                'server/card_catalog.js', 'server/fixtures/hasbro-b0965-catalog.json',
                'client/src/utils/publicWildcardOrientation.ts',
                'client/src/utils/touchCardFlipEngine.ts',
                'scripts/generate-vector-cards.py']


def text(value, x, y, size=16, **attrs):
    values = {'x':x, 'y':y, 'font-size':size, 'text-anchor':'middle', **attrs}
    return '<text ' + ' '.join(f'{k}="{escape(str(v), quote=True)}"' for k,v in values.items()) + '>' + escape(str(value)) + '</text>'


def lines(value, y, width=29, size=21, step=26):
    return ''.join(text(line, 180, y+i*step, size, **{'font-weight':700})
                   for i,line in enumerate(textwrap.wrap(value, width=width)))


def label(color):
    return {'DarkBlue':'Dark Blue','LightBlue':'Light Blue'}.get(color, color)


def rent_row(color, rents, y, size=17):
    return text('    '.join(f'{i} · {v}M' for i,v in enumerate(rents[color],1)),180,y,size)


def motif(kind, title, color, property_color=None):
    if kind == 'PROPERTY':
        if property_color == 'Railroad':
            shape = '<rect x="117" y="165" width="126" height="113" rx="20"/><path d="M128 201h104m-89 77-24 30m98-30 24 30M146 185h68m-68 43h20m28 0h20M128 292h104"/>'
        elif property_color == 'Utility':
            shape = '<path d="M185 148c-10 30-60 70-60 112a55 55 0 0 0 110 0c0-42-40-72-50-112z"/><path d="m185 204-23 43h34l-20 41"/>'
        else:
            shape = '<path d="M73 275V211l48-40 42 40v64m-74 0v-41h30v41m34 0V189l59-49 58 49v86m-95-59h20v20h-20m41-20h20v20h-20m-41-36h20v20h-20m41-20h20v20h-20M59 276h242M94 294h171"/>'
    elif kind == 'MONEY':
        shape = '<rect x="66" y="159" width="228" height="136" rx="14"/><path d="M83 184q20 0 20-15h154q0 15 20 15v86q-20 0-20 15H103q0-15-20-15z"/><ellipse cx="180" cy="227" rx="43" ry="48"/>'
    elif title == 'Just Say No':
        shape = '<path d="M180 143l77 27v61c0 47-77 81-77 81s-77-34-77-81v-61zM151 200l58 58m0-58-58 58"/>'
    elif title == 'Pass Go':
        shape = '<path d="M71 206h151v-45l73 68-73 69v-45H71zM76 177h68m-68 105h68"/>'
    elif title in ('House','Hotel'):
        shape = '<path d="m85 210 95-70 95 70M105 198v105h150V198m-94 105v-60h38v60M131 215h15m68 0h15"/>'
        if title == 'Hotel':
            shape += '<path d="M163 174v35m34-35v35m-34-18h34"/>'
    elif title in ('Sly Deal','Forced Deal','Deal Breaker'):
        shape = '<rect x="78" y="159" width="87" height="128" rx="10"/><rect x="195" y="159" width="87" height="128" rx="10"/><path d="M122 218h115m-23-22 23 22-23 22"/>'
        if title == 'Forced Deal':
            shape += '<path d="M237 263H122m23-22-23 22 23 22"/>'
        if title == 'Deal Breaker':
            shape += '<path d="m168 148 16 24-17 24 17 24-17 24 17 24-16 24"/>'
    elif title == 'Its My Birthday':
        shape = '<rect x="99" y="207" width="162" height="92" rx="5"/><path d="M86 183h188v34H86zM180 183v116m0-116c-70-62-84 8 0 0 70-62 84 8 0 0"/>'
    elif kind == 'RENT':
        shape = '<path d="M94 254v-56l86-55 86 55v56M81 260h198M108 266v22m144-22v22M136 207v43m44-43v43m44-43v43M99 305h162"/>'
    else:
        shape = '<rect x="100" y="151" width="160" height="151" rx="12"/><path d="M134 181h90m-90 29h90m-90 29h50m12 23 16 16 30-35"/>'
    return f'<circle cx="180" cy="228" r="106" fill="{color}" opacity=".10"/><g fill="none" stroke="{color}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round">{shape}</g>'


def svg(face, rents):
    kind, title, value = face['kind'], face['title'], face['value']
    colors = face['colors']
    color = COLORS.get(face.get('color'), '#08775c' if kind=='MONEY' else '#b97836')
    body = ''
    if kind in ('WILDCARD', 'RENT') and len(colors)==2:
        top, bottom = face['topColor'], face['bottomColor']
        for index, c in enumerate((top,bottom)):
            transform = ' transform="rotate(180 180 280)"' if index else ''
            body += f'<g{transform}><rect x="18" y="18" width="324" height="239" rx="13" fill="{COLORS[c]}" opacity=".16"/>'
            body += text(f'{value}M', 310, 47, 19, **{'font-weight':700})
            body += text('PROPERTY WILD CARD' if kind=='WILDCARD' else 'RENT',180,55,17,**{'font-weight':700})
            body += text(label(c),180,98,28,**{'font-weight':700})
            body += '<path d="m142 150 38-29 38 29v40h-76z" fill="none" stroke="'+COLORS[c]+'" stroke-width="5"/>'
            body += text('PROPERTIES → RENT',180,218,11,**{'letter-spacing':2})
            body += rent_row(c,rents,245,16) + '</g>'
        body += '<path d="M28 280h304" stroke="#c4c6b8"/>' + text('POCKET ATLAS · '+kind,180,284,10,fill='#63776a')
    else:
        body += f'<path d="M23 4h314q20 0 20 20v25H3V24Q3 4 23 4" fill="{color}"/>'
        body += text(kind, 22,34,14,**{'text-anchor':'start','fill':'#fffdf7','font-weight':700,'letter-spacing':2})
        body += f'<circle cx="311" cy="33" r="23" fill="#fffdf7" stroke="{color}" stroke-width="2"/>'
        body += text(f'{value}M',311,39,18,**{'font-weight':700})
        body += lines(title,86)
        if kind == 'WILDCARD':
            for i,c in enumerate(colors):
                x = 100 if i%2==0 else 260
                y = 167 + (i//2)*64
                body += f'<rect x="{x-67}" y="{y-21}" width="134" height="53" rx="8" fill="{COLORS[c]}" opacity=".17"/>'
                body += text(label(c),x,y-3,14,**{'font-weight':700})
                body += text(' / '.join(f'{v}M' for v in rents[c]),x,y+18,12)
            body += text('RENT TIERS BY COLOR',180,488,12,**{'letter-spacing':1})
        else:
            body += motif(kind,title,color,face.get('color'))
            if kind == 'PROPERTY':
                body += text(label(face['color'])+' property',180,355,18,**{'font-weight':700})
                body += text('PROPERTIES → RENT',180,390,12,**{'letter-spacing':2})
                body += rent_row(face['color'],rents,425)
                body += text(f"Complete set · {face['completeSetSize']} properties",180,473,15)
            elif kind == 'MONEY':
                body += text(value,180,244,46,fill=color,**{'font-weight':700})
                body += text(f'{value}M',180,410,48,fill=color,**{'font-weight':700})
                body += text('MONEY',180,470,16,**{'letter-spacing':3})
            elif kind == 'RENT':
                if len(colors)==2:
                    for i,c in enumerate(colors):
                        body += f'<rect x="{22+i*160}" y="364" width="156" height="64" rx="10" fill="{COLORS[c]}" opacity=".20"/>'
                        body += text(label(c),100+i*160,403,17,**{'font-weight':700})
                    body += text('RENT',180,473,16,**{'letter-spacing':3})
                else:
                    for i,c in enumerate(colors):
                        x=52+(i%5)*64; y=366+(i//5)*53
                        body += f'<circle cx="{x}" cy="{y}" r="16" fill="{COLORS[c]}"/>'
                    body += text('ALL COLORS',180,473,16,**{'letter-spacing':2})
            else:
                description = textwrap.wrap(face['description'],width=39)
                body += ''.join(text(s,180,358+i*23,14) for i,s in enumerate(description))
        body += '<path d="M24 504h312" stroke="#d2d6ca"/>'
        body += text('POCKET ATLAS · ORIGINAL VECTOR',180,532,10,fill='#63776a',**{'letter-spacing':1.5})
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="560" viewBox="0 0 360 560">'
            + '<title>'+escape(title)+'</title><desc>Original Pocket Atlas card face. No scanned artwork or proprietary logo.</desc>'
            + '<rect x="3" y="3" width="354" height="554" rx="22" fill="#fffdf7" stroke="#c4c6b8" stroke-width="3"/>'
            + '<g font-family="Arial,sans-serif" fill="#173b31">'+body+'</g></svg>\n')


def generate():
    extracted = json.loads(subprocess.check_output(['node','-e', """
const Deck = require('./server/models/Deck');
const {RENT_TIERS, COMPLETE_SET_SIZE} = require('./server/card_catalog');
const d = new Deck();
console.log(JSON.stringify({cards:[...d.actionCards,...d.propertyCards,...d.wildcards,...d.rentCards,...d.moneyCards].map(({id,...c})=>c), rents:RENT_TIERS, sets:COMPLETE_SET_SIZE}));
"""],cwd=ROOT))
    cards, rents = extracted['cards'], extracted['rents']
    fixture = json.loads((ROOT/'server/fixtures/hasbro-b0965-catalog.json').read_text())
    assert len(cards)==fixture['playableTotalCards']==106
    assert dict(Counter(c['kind'].lower() for c in cards))==fixture['cardTypeBreakdown']
    by_path = {}
    for c in cards:
        assert (ROOT/'client/public'/c['imageLocation']).is_file(), c
        by_path.setdefault(c['imageLocation'],c)
    faces=[]; files={}
    for path,c in sorted(by_path.items()):
        # Filenames derive only from trusted repository Deck, never wire data.
        key=Path(path).parent.name+'-'+Path(path).stem.replace('&','-').lower()
        face={'key':key,'title':c['title'],'kind':c['kind'],'value':c['value'],
              'colors':c.get('colors',[]),'png':'/'+path,'svg':'/assets/vector-cards/'+key+'.svg'}
        if c['kind']=='PROPERTY':
            face.update(color=c['color'],rentTiers=rents[c['color']],completeSetSize=extracted['sets'][c['color']])
        if c['kind']=='ACTION': face['description']=c['description']
        if c['kind'] in ('WILDCARD', 'RENT') and len(face['colors'])==2:
            face['topColor'],face['bottomColor']=next(p for p in ENDS if set(p)==set(face['colors']))
        faces.append(face)
        files[key+'.svg']=svg(face,rents)
    assert len(faces)==58
    face_by_png={f['png']:f for f in faces}
    instances=[{'instance':i+1,'face':face_by_png['/'+c['imageLocation']]['key'],
                'png':'/'+c['imageLocation'],'svg':face_by_png['/'+c['imageLocation']]['svg']}
               for i,c in enumerate(cards)]
    manifest={'design':'Pocket Atlas original vectors','dimensions':[360,560],
              'sources':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in SOURCE_PATHS},
              'instances':instances,'faces':faces}
    files['manifest.json']=json.dumps(manifest,indent=2,ensure_ascii=False)+'\n'
    files['SOURCES.md']='''# Pocket Atlas original vector catalog

Generated by `python3 scripts/generate-vector-cards.py` from the repository root.
Verify byte reproducibility with `python3 scripts/generate-vector-cards.py --check`.
The generator uses Python standard library and the installed Node runtime only;
it does not download, install, start a service, or change the 61 original PNGs.

106 playable instances / 58 distinct faces / 28 named native properties.
Manifest instance numbers are deterministic coverage ordinals, not game UUIDs;
no property instance IDs are drawn. Source SHA-256 hashes are in manifest.json.
Deck.js and its models supply exact titles, values, colors, descriptions, copies
and PNG paths. card_catalog.js supplies all ten authoritative rent schedules and
complete-set sizes. The canonical B0965 fixture validates totals/breakdown.
Paired wild ends match publicWildcardOrientation.ts / inspected PNG top ends;
paired wild and rent cards have their lower color and complete rent table
authored rotated 180 degrees. Color rent tables are explanatory catalog data,
not a claim that this layout reproduces the original printed rent card.

Original art adapts the owner-approved 360×560 Pocket Atlas proof of concept:
`monopoly-hybrid-poc-20261120/cards.py` and `ASSETS.md` in Forge artifacts.
New vector linework includes banknotes, streets, rail, utility, gifts, exchanges,
shield, arrow, buildings and notices. No remote fonts, images, scripts, embedded
rasters, recovered detail, proprietary logo, character or traced illustration.
Descriptions are copied from the actual application Deck, not newly invented
printed rules; the artwork does not claim to reproduce an official card edition.
Original design does not clear underlying game names, rules or trademarks, nor
the rights of the retained legacy PNG fallback. Private review is not a public
redistribution license; obtain rights/legal review before public distribution.

Runtime accepts only catalog-known local paths or exact known semantic records;
SVG is displayed with img, never injected as markup. SVG failure retries the
known retained PNG, and only failure of both shows the semantic text fallback.
'''
    return files


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',help='compare without writing')
    args=parser.parse_args()
    files=generate()
    if args.check:
        errors=[name for name,content in files.items() if not (OUT/name).exists() or (OUT/name).read_text()!=content]
        unexpected={p.name for p in OUT.iterdir()}-set(files) if OUT.exists() else set()
        if errors or unexpected:
            raise SystemExit('Generated artwork differs: '+', '.join(errors+sorted(unexpected)))
    else:
        OUT.mkdir(parents=True,exist_ok=True)
        for name,content in files.items(): (OUT/name).write_text(content,encoding='utf-8')
    print('Pocket Atlas: 106 instances / 58 faces / 28 native properties; '+('byte-identical' if args.check else 'generated'))


if __name__=='__main__': main()
