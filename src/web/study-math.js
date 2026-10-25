// Runs offline in generated study pages. Do not process code, scripts or already rendered math.
(() => {
  function render() {
    if (!window.katex || !document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    const math = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<!\\)\$([^$\n]+?)\$/g;
    let failures = 0;
    for (const node of nodes) {
      if (node.parentElement.closest('script,style,pre,code,textarea,.katex,.sumit-math')) continue;
      const value=node.nodeValue; math.lastIndex=0; let match,last=0,frag=document.createDocumentFragment(),found=false;
      while ((match=math.exec(value))) {
        found=true;frag.append(document.createTextNode(value.slice(last,match.index)));
        const el=document.createElement('span');el.className='sumit-math';el.dir='ltr';
        const tex=match[1]??match[2]??match[3]??match[4];
        try { katex.render(tex,el,{displayMode:match[1]!=null||match[2]!=null,throwOnError:true,trust:false,strict:'ignore',maxExpand:1000}); }
        catch (_) { el.textContent=match[0];el.title='לא ניתן להציג את הנוסחה; מוצג המקור';el.classList.add('sumit-math-error');failures++; }
        frag.append(el);last=math.lastIndex;
      }
      if(found){frag.append(document.createTextNode(value.slice(last)));node.replaceWith(frag);}
    }
    document.documentElement.dataset.sumitMath='ready';
    document.documentElement.dataset.sumitMathErrors=String(failures);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render);else render();
})();
