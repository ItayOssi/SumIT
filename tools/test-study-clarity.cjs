const {chromium}=require('../build/test-tools/node_modules/playwright-core');const {pathToFileURL}=require('url');const fs=require('fs');const path=require('path');const assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1150,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const details=(n,cls='')=>`<details class="q ${cls}"><summary>שאלה ${n}</summary><p>פתרון מוסבר</p></details>`;
 const html=`<!doctype html><html dir="rtl"><body><main class="wrap"><h2 id="must">סקירה</h2><p>מבוא</p><h2>הסיכום</h2><p>הסבר</p><h2 id="use">שיעורי בית</h2><div class="notyet"><b>שאלה 3 (גבולות, סעיפים א–יא): לא לעשות עדיין.</b> בשאלה 3 יש גבולות. שיעורי הבית: <b>שאלות 1 ו-2 בלבד</b></div>${details('1(א)')}${details('2(א)')}${details('3(א)','notyet')}${details('4(א)','notyet')}${details('4(ב)')}</main><svg viewBox="0 0 300 180" width="300"><line x1="40" y1="10" x2="40" y2="160" stroke="black"/><text x="-20" y="40">מעלית נעה במהירות 30 m/s כלפי מעלה</text><text x="-20" y="40">שיא אחרי 3 s בגובה 195.3 m<tspan baseline-shift="super">2</tspan></text><text x="280" y="170">0</text></svg></body></html>`;
 await page.setContent(html);await page.addStyleTag({path:'src/web/study-book.css'});await page.addScriptTag({path:'src/web/study-book.js'});await page.addScriptTag({path:'src/web/study-diagrams.js'});
 assert.equal(await page.locator('.qgroup.later').count(),1);assert.equal(await page.locator('.qgroup.later').getAttribute('data-question'),'3');assert.equal(await page.locator('.qgroup[data-question="4"].later').count(),0);
 await page.locator('.booktabs button[data-p="hw"]').click();assert.equal(await page.locator('.qgroup[data-question="1"] .qbadge').count(),0);assert.equal(await page.locator('.qgroup[data-question="2"] .qbadge').count(),0);
 assert.equal(await page.locator('.diagram-legend li').count(),2);assert.equal(await page.locator('.diagram-legend sup').innerText(),'2');assert.equal(await page.locator('svg text').evaluateAll(nodes=>nodes.every(n=>!/[\u0590-\u05ff]/.test([...n.childNodes].filter(x=>x.nodeType===3).map(x=>x.textContent).join('')))),true);
 assert.equal(await page.locator('svg').evaluate(svg=>{const v=svg.viewBox.baseVal,b=svg.getBBox();return b.x>=v.x&&b.y>=v.y&&b.x+b.width<=v.x+v.width&&b.y+b.height<=v.y+v.height}),true);
 await page.screenshot({path:'build/questions-and-diagrams.png'});await page.locator('svg').scrollIntoViewIfNeeded();await page.screenshot({path:'build/diagram-legend.png'});
 // Real student fixture is read locally only, never committed or sent to a model.
 if(fs.existsSync('build/original-study.html')){
   fs.mkdirSync('build/.sumit-math',{recursive:true});fs.cpSync('src/web/vendor/katex','build/.sumit-math',{recursive:true});for(const f of ['study-book.css','study-book.js','study-math.js','study-diagrams.js'])fs.copyFileSync('src/web/'+f,'build/.sumit-math/'+f);
   await page.goto(pathToFileURL(path.resolve('build/original-study.html')).href);await page.waitForSelector('.qgroup',{state:'attached'});await page.locator('.booktabs button[data-p="hw"]').click();
   for(const n of ['1','2'])assert.equal(await page.locator(`.qgroup[data-question="${n}"].later`).count(),0);
   assert.equal(await page.locator('.qgroup[data-question="3"].later').count(),1);await page.screenshot({path:'build/actual-homework-fixed.png'});
 }
 await page.goto(pathToFileURL(path.resolve('src/web/ui.html')).href+'?demo=1');await page.waitForFunction(()=>typeof S!=='undefined'&&S.ready.settings);
 await page.evaluate(()=>{if($('splash'))$('splash').remove();$('wizard').hidden=true;window.sent=[];host.postMessage=m=>sent.push(m);window.testLecture={num:1,title:'הרצאה',summaryNotes:'הערות שמורות'};requestLectureSummary({name:'test'},testLecture);});
 assert.equal(await page.locator('.summary-options textarea').inputValue(),'הערות שמורות');await page.locator('.summary-options textarea').fill('רק שאלות 1–2; הסבר בשלבים');await page.locator('.summary-options button[type="submit"]').click();
 assert.equal(await page.evaluate(()=>sent.at(-1).notes),'רק שאלות 1–2; הסבר בשלבים');await page.locator('.summary-options').waitFor({state:'detached'});
 await page.evaluate(()=>requestLectureSummary({name:'test'},testLecture,true));assert.equal(await page.locator('.summary-options textarea').inputValue(),'רק שאלות 1–2; הסבר בשלבים');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>sent.length),1);
 assert.deepEqual(errors,[]);await browser.close();console.log('PASS: exact homework warning, partial deferral, real student page, SVG legends/bounds, summary notes and cancel');
})().catch(e=>{console.error(e);process.exit(1)});
