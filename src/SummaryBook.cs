using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

// A finished study page becomes a small book: an overview, the summary and the homework are separate pages (all of it is printed to the PDF).
partial class HitStudent
{
    const string BookMarker = "id=\"sumit-book\"";

    const string BookStyle = "<style id=\"sumit-book\">"
        + "nav.toc{position:static!important}"
        + ".booktabs{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 6px;position:sticky;top:0;z-index:6;background:var(--bg,#fff);padding:8px 0;border-bottom:1px solid var(--line,#ddd)}"
        + ".booktabs button,.pagenav button{font:inherit;cursor:pointer;border:1px solid var(--line,#ccc);background:var(--surface,#fff);color:var(--text,#111);border-radius:12px;padding:8px 18px;font-weight:700}"
        + ".booktabs button.on{background:var(--accent,#2f5bd3);color:#fff;border-color:var(--accent,#2f5bd3)}"
        + ".bookpage{display:none}.bookpage.on{display:block}"
        + ".pagenav{display:flex;justify-content:space-between;gap:10px;margin:36px 0 0}"
        + "@media print{.bookpage{display:block!important}.booktabs,.pagenav{display:none!important}}</style>";

    const string BookScript = @"<script id=""sumit-book-js"">(function(){
function kindOf(h){var id=h.id||'',t=h.textContent||'';
 if(/^use/.test(id)||/שיעורי בית|שימוש בתרגילים|תרגילים|פתרונות/.test(t))return 'hw';
 if(/^(must|cheat)$/.test(id)||/חובה|לדלג|קבועים|יחידות/.test(t))return 'over';
 return 'sum';}
var NAMES={over:'🎯 סקירה: מה חובה לדעת',sum:'📖 הסיכום',hw:'✏️ שיעורי בית'};
function build(){
 var wrap=document.querySelector('.wrap'); if(!wrap||wrap.getAttribute('data-book'))return;
 var kids=Array.prototype.slice.call(wrap.children),first=-1,i;
 for(i=0;i<kids.length;i++){if(kids[i].tagName==='H2'){first=i;break;}}
 if(first<0)return;
 var g={over:[],sum:[],hw:[]},cur='sum',ended=false;
 for(i=first;i<kids.length;i++){var k=kids[i];
  if(k.tagName==='FOOTER'||k.tagName==='SCRIPT'||k.tagName==='STYLE')ended=true;
  if(ended)continue;
  if(k.tagName==='H2')cur=kindOf(k);
  g[cur].push(k);}
 var order=['over','sum','hw'].filter(function(n){return g[n].length>0;});
 if(order.length<2)return;
 wrap.setAttribute('data-book','1');
 var anchor=kids[first],pages={},tabs=document.createElement('div');tabs.className='booktabs';
 order.forEach(function(n){var s=document.createElement('section');s.className='bookpage';s.id='bp-'+n;wrap.insertBefore(s,anchor);pages[n]=s;
  var b=document.createElement('button');b.type='button';b.textContent=NAMES[n];b.onclick=function(){show(n,true);};b.setAttribute('data-p',n);tabs.appendChild(b);});
 order.forEach(function(n){g[n].forEach(function(e){pages[n].appendChild(e);});});
 wrap.insertBefore(tabs,pages[order[0]]);
 order.forEach(function(n,ix){var nav=document.createElement('div');nav.className='pagenav';
  var prev=document.createElement('button'),next=document.createElement('button');prev.type=next.type='button';
  prev.textContent=ix>0?'→ '+NAMES[order[ix-1]]:'';next.textContent=ix<order.length-1?NAMES[order[ix+1]]+' ←':'';
  if(ix>0)prev.onclick=function(){show(order[ix-1],true);};else prev.style.visibility='hidden';
  if(ix<order.length-1)next.onclick=function(){show(order[ix+1],true);};else next.style.visibility='hidden';
  nav.appendChild(prev);nav.appendChild(next);pages[n].appendChild(nav);});
 function pageOf(el){var p=el.closest?el.closest('.bookpage'):null;return p?p.id.slice(3):null;}
 function show(n,top){order.forEach(function(x){pages[x].classList.toggle('on',x===n);});
  Array.prototype.forEach.call(tabs.children,function(b){b.classList.toggle('on',b.getAttribute('data-p')===n);});
  Array.prototype.forEach.call(document.querySelectorAll('nav.toc a[href^=""#""]'),function(a){var t=document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));var p=t?pageOf(t):null;a.style.display=(p&&p!==n)?'none':'';});
  if(top)tabs.scrollIntoView();}
 function goHash(){var id=decodeURIComponent(location.hash.slice(1)),t=id&&document.getElementById(id),p=t&&pageOf(t);if(p){show(p,false);t.scrollIntoView();}}
 Array.prototype.forEach.call(document.querySelectorAll('nav.toc a[href^=""#""]'),function(a){a.addEventListener('click',function(ev){var t=document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))),p=t&&pageOf(t);if(p){ev.preventDefault();show(p,false);t.scrollIntoView();}});});
 addEventListener('hashchange',goHash);
 show(order[0],false);goHash();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',build);else build();
})();
</script>";

    // Safe to run any number of times: the book is added once.
    internal void AddBookLayout(string path)
    {
        try
        {
            if (!File.Exists(path)) return;
            string html = File.ReadAllText(path, Encoding.UTF8);
            if (html.IndexOf(BookMarker, StringComparison.Ordinal) >= 0) return;
            int h = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
            html = h >= 0 ? html.Insert(h, BookStyle) : BookStyle + html;
            int b = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
            html = b >= 0 ? html.Insert(b, BookScript) : html + BookScript;
            File.WriteAllText(path, html, new UTF8Encoding(false));
        }
        catch { }
    }
}