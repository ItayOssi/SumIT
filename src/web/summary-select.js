(() => {
  if (window.sumitCancelSelection) window.sumitCancelSelection();
  const token = window.sumitSelectionToken;
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;touch-action:none;background:rgba(60,100,240,.03)';
  layer.innerHTML = '<svg width="100%" height="100%" style="position:absolute;inset:0;pointer-events:none"><path fill="rgba(80,140,255,.13)" stroke="#719cff" stroke-width="3"/></svg><div dir="rtl" style="position:absolute;top:8px;left:50%;transform:translateX(-50%);padding:8px 16px;background:#172238;color:white;border-radius:10px;font:15px sans-serif">הקף אזור בעכבר · Esc לביטול <button type="button">ביטול</button></div>';
  document.body.append(layer);
  let points = [], drawing = false;
  const clean = () => {layer.remove();window.removeEventListener('keydown', key);window.sumitCancelSelection=null;};
  const key = e => {if(e.key==='Escape') clean();};
  window.sumitCancelSelection = clean;
  window.addEventListener('keydown', key);
  layer.querySelector('button').onclick = clean;
  layer.onpointerdown = e => {
    if (e.target.closest('button') || e.button!==0) return;
    drawing=true;points=[[e.clientX,e.clientY]];layer.setPointerCapture(e.pointerId);e.preventDefault();
  };
  layer.onpointermove = e => {if(!drawing)return;points.push([e.clientX,e.clientY]);layer.querySelector('path').setAttribute('d','M'+points.map(p=>p.join(',')).join('L')+'Z');};
  layer.onpointerup = e => {
    if(!drawing)return;drawing=false;points.push([e.clientX,e.clientY]);
    const x=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0])))), y=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1]))));
    const w=Math.ceil(Math.max(...points.map(p=>p[0]))-x), h=Math.ceil(Math.max(...points.map(p=>p[1]))-y);
    if(w<8||h<8){points=[];layer.querySelector('path').setAttribute('d','');return;}
    clean();
    const intersects = r => r.width && r.height && r.right>x && r.left<x+w && r.bottom>y && r.top<y+h;
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;const text=[];
    while((node=walker.nextNode())){
      if(!node.textContent.trim() || node.parentElement.closest('script,style,.katex-mathml'))continue;
      const range=document.createRange();range.selectNodeContents(node);
      if([...range.getClientRects()].some(intersects))text.push(node.textContent.trim());
    }
    requestAnimationFrame(()=>requestAnimationFrame(()=>window.chrome.webview.postMessage({type:'summarySelection',token,text:text.join(' '),x,y,w,h,vw:innerWidth,vh:innerHeight})));
  };
})();
