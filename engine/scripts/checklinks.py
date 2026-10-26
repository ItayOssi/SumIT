"""Sanity-check a study page before shipping it.

usage: python -I checklinks.py <page_or_body.html>

Reports: internal links whose target id is missing, lecturer formulas (ids f-*/t-*) that no hint
references, and the list of exercise hint ids (use-*) that pointer configs can target.
"""
import sys, re
from html.parser import HTMLParser

class Questions(HTMLParser):
    """Structural check only; numbers and wording still need source comparison."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.cards, self.statement = [], [], None
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'details':
            q = {'id': a.get('id', 'question-without-id'), 'ok': False} if 'q' in a.get('class','').split() else None
            self.stack.append(q)
            if q is not None: self.cards.append(q)
        if 'question-statement' in a.get('class','').split() and self.stack and self.stack[-1] is not None:
            self.statement = {'tag':tag, 'depth':1, 'owner':self.stack[-1], 'source':a.get('data-source','').strip(), 'text':''}
        elif self.statement and tag == self.statement['tag']:
            self.statement['depth'] += 1
    def handle_data(self, data):
        if self.statement: self.statement['text'] += data
    def handle_endtag(self, tag):
        if self.statement and tag == self.statement['tag']:
            self.statement['depth'] -= 1
            if self.statement['depth'] == 0:
                self.statement['owner']['ok'] = bool(self.statement['source'] and self.statement['text'].strip())
                self.statement = None
        if tag == 'details' and self.stack: self.stack.pop()

s = open(sys.argv[1], encoding="utf-8").read()
ids = set(re.findall(r'id="([^"]+)"', s))
hrefs = re.findall(r'href="#([^"]+)"', s)
missing = sorted(set(h for h in hrefs if h not in ids))
formulas = sorted(i for i in ids if i.startswith(("f-", "t-")))
used = set(h for h in hrefs if h.startswith(("f-", "t-")))
print("ids:", len(ids), "| internal links:", len(hrefs))
print("MISSING link targets:", missing or "none")
print("formulas never used in a hint:", [f for f in formulas if f not in used] or "none")
print("exercise hints:", sorted(i for i in ids if i.startswith("use-")))
q = Questions(); q.feed(s)
incomplete = [c['id'] for c in q.cards if not c['ok']]
if not q.cards: incomplete.append('no question cards')
print("MISSING question statements/source references:", incomplete or "none")
sys.exit(1 if missing or incomplete else 0)
