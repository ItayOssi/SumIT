const {chromium}=require('../build/test-tools/node_modules/playwright-core');
const {pathToFileURL}=require('url');const path=require('path');const assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('src/web/ui.html')).href+'?demo=1');await page.waitForFunction(()=>S.courses&&S.ready.settings&&S.ai);
 await page.evaluate(()=>{
 host.postMessage=()=>{};$('splash')?.remove();$('wizard').hidden=true;courseRuntime.clear();S.course=null;
 window.ca={id:701,name:'Course A',local:{setupDone:true}},window.cb={id:702,name:'Course B',local:{setupDone:true}};S.courses=[ca,cb];
 window.enter=c=>{openCourse(c);onMessage({type:'course',id:c.id,name:c.name,sections:[],local:{dir:'test',setupDone:true,lectures:[{num:1,title:'Lecture',local:{exists:true,files:1}}]},notability:{}});};
 enter(ca);setTab('info');onMessage({type:'operationStatus',course:ca.name,operation:'syllabus',busy:true});onMessage({type:'courseStatus',course:ca.name,text:'Synchronizing A',busy:true});
 enter(cb);
 });
 assert.equal(await page.evaluate(()=>S.infoBusy),false);
 await page.evaluate(()=>{setTab('info');onMessage({type:'operationStatus',course:cb.name,operation:'syllabus',busy:true});enter(ca);});
 assert.equal(await page.evaluate(()=>S.tab),'info');assert.equal(await page.locator('#sylBtn').isDisabled(),true);assert.match(await page.locator('#courseStatus').innerText(),/Synchronizing A/);
 await page.evaluate(()=>onMessage({type:'courseStatus',course:ca.name,text:'Other download finished',busy:false}));assert.equal(await page.locator('#sylBtn').isDisabled(),true);
 await page.evaluate(()=>{enter(cb);onMessage({type:'operationStatus',course:ca.name,operation:'syllabus',busy:false});onMessage({type:'courseStatus',course:ca.name,text:'Failed A',error:true,busy:false});onMessage({type:'courseLocal',course:ca.name,local:{setupDone:true,info:{lecturer:'A teacher'},lectures:[]}});});
 assert.equal(await page.evaluate(()=>S.infoBusy),true);assert.equal(await page.evaluate(()=>ca.local.info.lecturer),'A teacher');
 await page.evaluate(()=>enter(ca));assert.equal(await page.locator('#sylBtn').isDisabled(),false);assert.match(await page.locator('#courseStatus').innerText(),/Failed A/);
 await page.evaluate(()=>{setTab('lessons');onMessage({type:'aiRun',key:'sum|Course A|1',busy:true});onMessage({type:'sectionStatus',course:ca.name,num:1,text:'Reading',busy:true});onMessage({type:'sectionProgress',course:ca.name,num:1,pct:45,text:'Reading sources',eta:12});enter(cb);enter(ca);});
 assert.deepEqual(await page.evaluate(()=>[S.sections[0].aiBusy,S.sections[0].pct,S.sections[0].status]),[true,45,'Reading']);
 await page.evaluate(()=>{enter(cb);onMessage({type:'aiRun',key:'sum|Course A|1',busy:false});onMessage({type:'sectionStatus',course:ca.name,num:1,text:'Ready',busy:false});enter(ca);});
 assert.deepEqual(await page.evaluate(()=>[S.sections[0].aiBusy,S.sections[0].busy,S.sections[0].pct]),[false,false,null]);
 await page.evaluate(()=>{send({type:'chat',course:ca.name,scope:'course',text:'test'});S.chatBusy=true;enter(cb);send({type:'chat',course:cb.name,scope:'course',text:'test'});S.chatBusy=true;onMessage({type:'chat',course:ca.name,scope:'course',role:'assistant',text:'Background answer A'});onMessage({type:'chatDone',course:ca.name,scope:'course'});});
 assert.equal(await page.evaluate(()=>S.chatBusy),true);await page.evaluate(()=>enter(ca));assert.equal(await page.evaluate(()=>S.chatBusy),false);assert.match(await page.locator('#msgs').innerText(),/Background answer A/);
 await page.evaluate(()=>{const r=runtimeFor(ca.name);r.status=null;r.operations.clear();onMessage({type:'operationStatus',course:ca.name,operation:'exam',busy:true});onMessage({type:'operationStatus',course:ca.name,operation:'exam',busy:false});});assert.equal(await page.locator('#courseStatus').isHidden(),true);
 assert.deepEqual(errors,[]);await browser.close();console.log('PASS: two-course synchronization, busy buttons, independent completion/error, lecture progress, background results and scoped chat');
})().catch(e=>{console.error(e);process.exit(1)});
