const {chromium}=require('../build/test-tools/node_modules/playwright-core');
const {pathToFileURL}=require('url');const path=require('path');const fs=require('fs');const assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1100,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const root=path.resolve('build/regression');const fixture=fs.readdirSync(root).filter(x=>x.startsWith('regression-')).map(x=>path.join(root,x,'math/lesson.html')).filter(x=>fs.existsSync(x)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];assert(fixture);
 await page.context().setOffline(true);await page.goto(pathToFileURL(fixture).href);await page.waitForFunction(()=>document.documentElement.dataset.sumitMath==='ready');
 assert.equal(await page.locator('.katex').count(),2);assert.equal(await page.locator('.katex').first().evaluate(el=>getComputedStyle(el).direction),'ltr');assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).direction),'rtl');assert.equal(await page.locator('body').innerText().then(t=>t.includes('$v^2')),false);
 await page.locator('summary').click();assert.equal(await page.locator('details').evaluate(e=>e.open),true);await page.screenshot({path:'build/math-offline.png'});
 await page.context().setOffline(false);await page.goto(pathToFileURL(path.resolve('src/web/ui.html')).href+'?demo=1');await page.waitForFunction(()=>typeof S!=='undefined'&&S.ready.settings);
 await page.evaluate(()=>{host.postMessage=()=>{};if($('splash'))$('splash').remove();$('wizard').hidden=true;S.events=null;S.tasks=[{id:'1',title:'מטלה ידנית לבדיקה',course:'פיזיקה',due:new Date(Date.now()+86400000).toISOString().slice(0,10),done:false},{id:'2',title:'ללא מועד',due:'',done:false},{id:'3',title:'מטלה ישנה',due:'2020-01-01',done:false},{id:'4',title:'כבר הושלם',due:'',done:true}];show('home');});
 assert.equal(await page.locator('#deadlines .deadline').count(),3);assert.equal((await page.locator('#deadlines').innerText()).includes('כבר הושלם'),false);assert.equal((await page.locator('#heroLine').innerText()).includes('1'),true);
 await page.locator('#deadlines .deadline').filter({hasText:'מטלה ידנית לבדיקה'}).click();assert.equal(await page.evaluate(()=>S.view),'tasks');
 await page.evaluate(()=>{S.tasks[0].done=true;saveTasks();show('home')});assert.equal(await page.locator('#deadlines .deadline').count(),2);assert.deepEqual(errors,[]);
 await browser.close();console.log('PASS: offline Hebrew/LaTeX rendering, interactive details, personal tasks dated/undated/overdue/completed and navigation');
})().catch(e=>{console.error(e);process.exit(1)});
