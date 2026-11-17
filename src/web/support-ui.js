function setNavCollapsed(hidden) {
 document.querySelector('.app').classList.toggle('nav-collapsed', hidden);
 const b = $('collapseSidebar'), label = hidden ? 'הרחב את התפריט' : 'כווץ את התפריט';
 b.setAttribute('aria-expanded', String(!hidden)); b.title = label; b.setAttribute('aria-label', label);
 $('collapseIcon').innerHTML = hidden ? IC.sideOpen : IC.sideClose; $('collapseText').textContent = hidden ? 'הרחב' : 'כווץ';
 try { localStorage.setItem('sumit-nav-collapsed', String(hidden)); } catch {}
 requestAnimationFrame(() => placeSite(false));
}
$('collapseSidebar').onclick = () => setNavCollapsed(!document.querySelector('.app').classList.contains('nav-collapsed'));
// In the narrow rail each icon keeps its name as a tooltip.
document.querySelectorAll('nav.side .nav-item').forEach(b => { if (!b.title) b.title = b.querySelector('.nav-text')?.textContent.trim() || ''; });
{ let c = false; try { c = localStorage.getItem('sumit-nav-collapsed') === 'true'; } catch {} setNavCollapsed(c); }
$('sendDeveloperLogs').onclick=()=>send({type:'sendDeveloperLogs'});
$('exportDiagnostics').onclick=()=>send({type:'exportDiagnostics'});
$('viewerShareCloud').onclick=()=>{S.shareToCloud=true;$('viewerShare').click();S.shareToCloud=false;};
function showSummaryImport(course,num){
 const dialog=h('<dialog dir="rtl"><h2>סיכום של חבר · הרצאה '+esc(num)+'</h2><p>הסיכום יתווסף בנפרד. הסיכום שלך לא יוחלף.</p><div class="row wrap"><button data-local>בחר ZIP</button><button data-paste>הדבק ZIP שהעתקת</button><button data-sync>תיקיית OneDrive מסונכרנת</button><button data-cloud>הורדה מאתר OneDrive</button></div><p>ב-OneDrive בוחרים קובץ ZIP ולוחצים הורדה; הוא יתווסף להרצאה שבחרת.</p><button data-close>סגור</button></dialog>');
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());
 const choose=extra=>{send({type:'importSharedSummary',course,num,...extra});dialog.close();};
 dialog.querySelector('[data-local]').onclick=()=>choose({});dialog.querySelector('[data-paste]').onclick=()=>choose({clipboard:true});dialog.querySelector('[data-sync]').onclick=()=>choose({onedrive:true});
 dialog.querySelector('[data-cloud]').onclick=()=>{send({type:'cloudSummaryImport',course,num});dialog.close();openSite('onedrive');toast('בחר ZIP ב-OneDrive ולחץ הורדה. הסיכום יתווסף להרצאה '+num,{ms:20000,action:'בטל ייבוא',onAction:()=>send({type:'cancelCloudImport'})});};
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='v'){e.preventDefault();choose({clipboard:true});}};dialog.showModal();
}
