const {chromium}=require('../build/test-tools/node_modules/playwright-core');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {pathToFileURL}=require('url');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.join(root,'build/study-reading');fs.mkdirSync(out,{recursive:true});
 const source=process.argv[2];
 const file=path.join(out,'lesson.html');
 if(source){
  fs.copyFileSync(source,file);fs.cpSync(path.join(path.dirname(source),'.sumit-math'),path.join(out,'.sumit-math'),{recursive:true});
  for(const name of ['study-book.js','study-book.css'])fs.copyFileSync(path.join(root,'src/web',name),path.join(out,'.sumit-math',name));
 }else{
  fs.writeFileSync(file,`<html dir="rtl"><head><meta charset="utf-8"><style>body{font-family:sans-serif;margin:20px}.wrap{margin:auto}.fx{padding:30px;border:1px solid #888}h2{margin-top:60px}</style><link rel="stylesheet" href="${pathToFileURL(path.join(root,'src/web/study-book.css'))}"><script defer src="${pathToFileURL(path.join(root,'src/web/study-book.js'))}"></script></head><body><main class="wrap"><h2 id="must">מה חובה</h2><p>סקירה</p><h2 id="theory">נפילה חופשית</h2><p>הסבר</p><div class="fx" id="formula">v = v0 + at</div><h2 id="use">שיעורי בית</h2><details class="q" id="use1"><summary>שאלה 1</summary><div class="qbody"><section class="question-statement">גוף נזרק למעלה. מצא את מהירותו.</section><a href="#formula">הנוסחה</a><details class="reveal"><summary>פתרון</summary>פתרון לדוגמה</details></div></details></main></body></html>`);
 }
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1120,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(file).href);await page.waitForSelector('.book-controls');
  await page.locator('.booktabs [data-p="hw"]').click();
  const question=page.locator('details.q').filter({has:page.locator('a[href^="#"]')}).first();
  await question.evaluate(el=>el.open=true);
  const qid=await question.getAttribute('id');assert.ok(qid);const qs='[id="'+qid+'"]';
  const link=question.locator('a[href^="#"]').first(),href=await link.getAttribute('href');
  await link.click();
  assert.equal(await page.locator('.book-question-pin').isVisible(),true);
  assert.equal(await page.locator('.booktabs').isVisible(),false);
  assert.equal(await page.locator(qs).count(),1);
  assert.equal(await page.locator('.book-question-pin '+qs).count(),1);
  const target=page.locator('[id="'+decodeURIComponent(href.slice(1))+'"]');assert.equal(await target.isVisible(),true);
  await page.waitForFunction(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.top<innerHeight && r.bottom>0;},decodeURIComponent(href.slice(1)));
  const pin=await page.locator('.book-question-pin').boundingBox(),ref=await target.boundingBox();
  assert.ok(pin.y<900&&pin.y+pin.height>0);assert.ok(ref.y<900&&ref.y+ref.height>0);
  assert.ok(ref.x+ref.width<=pin.x+1,'question and reference occupy separate columns');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:path.join(out,'question-and-reference.png')});
  await page.locator('.book-controls button').click();assert.equal(await page.locator('.booktabs').isVisible(),true);
  await page.locator('.book-controls button').click();
  await page.evaluate(()=>dispatchEvent(new Event('beforeprint')));assert.equal(await page.locator('.book-question-pin '+qs).count(),0);assert.equal(await page.locator('#bp-hw '+qs).count(),1);
  await page.evaluate(()=>dispatchEvent(new Event('afterprint')));assert.equal(await page.locator('.book-question-pin '+qs).count(),1);
  await page.setViewportSize({width:650,height:900});await target.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.locator('.book-pin-head button').filter({hasText:'חזרה לתרגיל'}).click();
  assert.equal(await page.locator('.book-question-pin').isVisible(),false);assert.equal(await page.locator('#bp-hw '+qs).isVisible(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: question preserved beside reference, unique IDs, collapsible sections, print restoration, narrow layout, return to original question');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
