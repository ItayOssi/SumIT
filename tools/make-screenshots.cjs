// Takes the screenshots for the README from the demo data (no real accounts or courses).
const {chromium} = require('../build/test-tools/node_modules/playwright-core');
const {pathToFileURL} = require('url'); const path = require('path');
const out = (n) => path.resolve(__dirname, '../docs/' + n);
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 const page = await browser.newPage({viewport:{width:1360,height:860}});
 await page.goto(pathToFileURL(path.resolve(__dirname,'../src/web/ui.html')).href+'?demo=1');
 await page.waitForFunction(()=>typeof S!=='undefined' && S.courses && S.ai && S.ready.settings);
 await page.waitForTimeout(2300);
 // the start-up screen
 await page.evaluate(()=>{ const s=$('splash'); s.classList.remove('hide'); s.style.opacity=1; s.style.visibility='visible'; });
 await page.waitForTimeout(400); await page.screenshot({path:out('splash.png')});
 await page.evaluate(()=>{ $('splash').remove(); $('wizard').hidden=true;
   S.ai=Object.assign({},S.ai,{ready:true,claude:{installed:true,loggedIn:true,email:'student@example.com'},helpers:{gemini:'account',openai:'account',order:['gemini','openai']}});
   S.tasks=[{id:'1',title:'להגיש תרגיל 3 באינפי 2',course:'חשבון אינפיניטסימלי 2',due:'2026-11-02',done:false},{id:'2',title:'לחזור על פרק 4 לקראת הבוחן',course:'',due:'',done:false},{id:'3',title:'לשלוח טופס לבקשת מילואים',course:'',due:'2026-10-20',done:true}];
   onMessage(Object.assign({},S.settings,{type:'settings',displayName:'נועה לוי',bio:'סטודנטית להנדסת חשמל',tasks:S.tasks})); show('home'); });
 await page.waitForTimeout(900); await page.screenshot({path:out('home.png')});
 await page.evaluate(()=>show('tasks')); await page.waitForTimeout(700); await page.screenshot({path:out('tasks.png')});
 await page.evaluate(()=>show('settings')); await page.waitForTimeout(700);
 await page.evaluate(()=>document.getElementById('providers').scrollIntoView({block:'start'})); await page.waitForTimeout(300); await page.screenshot({path:out('settings-ai.png')});
 await page.evaluate(()=>show('home')); await page.locator('#editProfile').click(); await page.waitForTimeout(500); await page.screenshot({path:out('profile.png')});
 await page.evaluate(()=>{ $('profileDlg').hidden=true; });
 await page.evaluate(()=>{ const q=new URLSearchParams(location.search); openCourse(S.courses[0]); });
 await page.waitForTimeout(1600);
 await page.evaluate(()=>{ S.open.add(1); renderLectures(); }); await page.waitForTimeout(700); await page.screenshot({path:out('course-top.png')});
 // timetable on the home page
 await page.evaluate(()=>{ S.timetable={classes:[{day:'ראשון',start:'09:00',end:'11:00',course:'אלגברה לינארית 2',kind:'הרצאה',room:'201'},{day:'ראשון',start:'12:00',end:'14:00',course:'פיזיקה 1',kind:'תרגול',room:'105'},{day:'שני',start:'10:00',end:'12:00',course:'חשבון אינפיניטסימלי 2',kind:'הרצאה',room:'301'},{day:'רביעי',start:'09:00',end:'12:00',course:'מבני נתונים',kind:'הרצאה',room:'204'},{day:'חמישי',start:'14:00',end:'16:00',course:'פיזיקה 1',kind:'הרצאה',room:'105'}],exams:[{course:'חשבון אינפיניטסימלי 2',moed:'א',date:'2027-02-04',time:'09:00',room:'אולם 3'},{course:'פיזיקה 1',moed:'א',date:'2027-02-10',time:'09:00',room:'אולם 1'}]}; show('home'); renderTimetable(); document.getElementById('timetable').scrollIntoView({block:'start'}); });
 await page.waitForTimeout(600); await page.screenshot({path:out('timetable.png')});
 // exams first
 await page.evaluate(()=>{ show('courses'); openCourse(S.courses[0]); });
 await page.waitForTimeout(1500);
 await page.evaluate(()=>{ S.local=Object.assign({},S.local||{},{dir:'t',lectures:[],exams:0,examsSkipped:false}); S.sections=[]; renderLectures(); }); await page.waitForTimeout(500); await page.screenshot({path:out('exams-first.png')});
 // a summary being built
 await page.evaluate(()=>{ onMessage({type:'courseLocal',course:S.course.name,local:{dir:'t',setupDone:true,exams:3,lectures:[{num:1,title:'גבולות ורציפות',date:'2026-10-25',due:'',items:[],running:true,progress:{pct:57,eta:140,text:'כותב את שיעורי הבית'},local:{exists:true,files:4,dir:'t',materialFiles:[{name:'מחברת מרצה\\הרצאה 1.pdf',path:'x'},{name:'תרגילים\\דף תרגילים 1.pdf',path:'x'}]}}]},notability:{}}); S.open.add(1); renderLectures(); }); await page.waitForTimeout(700); await page.screenshot({path:out('lecture-progress.png')}); await browser.close();
})();
