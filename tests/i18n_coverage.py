"""Translation contracts, safe HTML bindings, and optional pre-change Spanish preservation."""
from pathlib import Path
from html.parser import HTMLParser
from collections import Counter
import argparse,json,re
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--baseline',type=Path);args=parser.parse_args()
def load(path):
 def unique(pairs):
  result={}
  for key,value in pairs:
   assert key not in result,'Duplicate translation key: '+key
   result[key]=value
  return result
 return json.loads(path.read_text(),object_pairs_hook=unique)
es=load(ROOT/'public/assets/i18n/es.json');en=load(ROOT/'public/assets/i18n/en.json')
assert es.keys()==en.keys(),'Dictionary keys differ'
def strings(value):
 if isinstance(value,str):return [value]
 assert isinstance(value,dict) and set(value)=={'one','other'},value
 return list(value.values())
for key in es:
 assert re.fullmatch('[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+',key),key
 assert type(es[key]) is type(en[key]),key
 for a,b in zip(strings(es[key]),strings(en[key])):
  assert a and b,key
  assert set(re.findall(r'\{[a-zA-Z][a-zA-Z0-9_]*\}',a))==set(re.findall(r'\{[a-zA-Z][a-zA-Z0-9_]*\}',b)),key
class Page(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.stack=[];self.text=[];self.attrs=[];self.scripts=[];self.ids=[]
 def handle_starttag(self,tag,attrs):
  attrs=dict(attrs)
  if self.stack:assert not self.stack[-1][1].get('data-i18n'), 'Text binding would remove a nested control: '+str(self.stack[-1])
  if 'id' in attrs:self.ids.append(attrs['id'])
  if tag=='script' and attrs.get('src'):self.scripts.append(attrs['src'])
  if tag=='option' and attrs.get('data-i18n'):assert 'value' in attrs,'Translated options require stable values'
  for name,value in attrs.items():
   if name.startswith('data-i18n') and not name.endswith('-params'):assert value in es,(name,value)
   if name in ['title','placeholder','aria-label','aria-description','alt']:self.attrs.append((name,value))
  if tag not in {'meta','link','img','input','br','hr','source','wbr','area','base','embed','param','track','col','path','circle','rect','line','use','ellipse'}:self.stack.append((tag,attrs))
 def handle_endtag(self,tag):
  while self.stack:
   if self.stack.pop()[0]==tag:break
 def handle_startendtag(self,tag,attrs):self.handle_starttag(tag,attrs);self.handle_endtag(tag)
 def handle_data(self,data):
  if data.strip() and not any(tag in ['script','style'] for tag,attrs in self.stack):self.text.append(data.strip())
files=[ROOT/'public/index.html',*(ROOT/'public/src/views').rglob('*.html')]
baseline=json.loads(args.baseline.read_text()) if args.baseline else None
for path in files:
 page=Page();page.feed(path.read_text())
 assert 'i18n.js' in page.scripts[0],path
 for src in page.scripts:
  if not src.startswith(('http:','https:')):assert (path.parent/src.split('?')[0]).resolve().is_file(),(path,src)
 if baseline:
  before=Page();before.feed(baseline[str(path.relative_to(ROOT))])
  assert not (Counter(before.text)-Counter(page.text)),('Spanish fallback changed',path,Counter(before.text)-Counter(page.text))
  assert not (Counter(before.attrs)-Counter(page.attrs)),('Spanish attribute changed',path)
  assert Counter(before.ids)==Counter(page.ids),('Static IDs changed',path)
used=set()
for path in [*(ROOT/'public/src').rglob('*.js'),*(ROOT/'backend/php').rglob('*.php')]:
 if path.name=='local.php':continue
 used.update(re.findall(r'(?:HospitalI18n\.(?:t|mark|html)|I18n::t)\([\'\"]([^\'\"]+)',path.read_text()))
assert not (used-es.keys()),sorted(used-es.keys())
print(f'PASS {len(es)} bilingual keys, interpolation/plural contracts, {len(files)} page bindings/assets, {len(used)} literal key references'+(' and original Spanish fallback/attribute/ID preservation' if baseline else ''))
