'use strict';
const fs=require('fs'),path=require('path'),os=require('os');
const {spawnSync}=require('child_process');
const {dialog,clipboard,shell}=require('electron');
const {Str,Int,Bool,guidN,mkdirp}=require('../util');
const platform=require('../platform');
const C=require('../constants');
const logs=()=>path.join(platform.DataRoot,'diagnostics');
function kind(text){if(/RESOURCE_EXHAUSTED|\b429\b|usage limit|rate.?limit|quota[ _-]*(exceeded|exhausted)/i.test(text||''))return 'rate-or-quota';if(/auth|\b401\b|\b403\b/i.test(text||''))return 'authentication';if(/unknown option|unrecognized/i.test(text||''))return 'cli-arguments';return 'unknown';}
module.exports={methods:{
 FailureKind:kind,
 Diagnostic(operation,provider,category,code=0){try{const safe=s=>String(s||'').replace(/[^a-z0-9_.-]/gi,'');mkdirp(logs());const file=path.join(logs(),'events.log');if(fs.existsSync(file)&&fs.statSync(file).size>1024*1024){fs.copyFileSync(file,file+'.previous');fs.writeFileSync(file,'');}fs.appendFileSync(file,`${new Date().toISOString()} version=1.0.15 operation=${safe(operation)} provider=${safe(provider)} kind=${safe(category)} code=${Number(code)||0}\n`);}catch{}},
 RecordUiFailure(m){if(m&&(m.error||m.status==='error'||m.state==='failed'))this.Diagnostic(m.type,'',kind(m.text));},
 async ExportDiagnostics(){
  const dest=await dialog.showSaveDialog(this.win,{title:'דוח אבחון לשליחה לתמיכה',defaultPath:'SumIT-diagnostics.zip',filters:[{name:'ZIP',extensions:['zip']}]});if(dest.canceled)return;
  const info=JSON.stringify({version:'1.0.15',platform:process.platform,arch:process.arch,runtime:process.version,geminiMode:this.HelperMode('gemini'),openaiMode:this.HelperMode('openai'),claudeConnected:this.claudeLoggedIn,note:'No credentials, browser data, prompts or course content.'});
  const script="import sys,zipfile,pathlib\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.writestr('system.json',sys.argv[2])\n for p in pathlib.Path(sys.argv[3]).glob('events.log*'):z.write(p,p.name)";
  const result=spawnSync('python3',['-I','-c',script,dest.filePath,info,logs()],{encoding:'utf8'});if(result.status!==0)throw new Error('לא ניתן לייצא דוח אבחון');this.Toast('דוח האבחון נשמר; הוא לא נשלח אוטומטית.',false);
 },
 SharedSummaries(course,num){return this.LoadMeta(course).sharedSummaries?.[String(num)]||[];},
 async ImportSharedSummary(course,num,archive){
  if(!course||num<1||num>200)return;
  try{const dest=path.join(this.CourseDir(course),C.SumitDir,'shared',guidN());mkdirp(path.dirname(dest));
   const result=spawnSync('python3',['-I',path.join(platform.EngineDir,'scripts/import_shared.py'),archive,dest],{encoding:'utf8',maxBuffer:1024*1024});
   if(result.status!==0)throw new Error('חבילת הסיכום אינה תקינה או Python אינו זמין');
   const meta=this.LoadMeta(course);meta.sharedSummaries||={};(meta.sharedSummaries[String(num)]||=[]).push({title:path.basename(archive,'.zip'),path:result.stdout.trim()});this.SaveMeta(course,meta);this.SendSectionLocal(course,num);this.Toast('סיכום החבר נוסף להרצאה '+num,false);this.Diagnostic('summary-import','','success');
  }catch(e){this.Diagnostic('summary-import','','failed');this.Toast(e.message,true);}
 },
 async PickSharedSummary(m){let file='';if(Bool(m,'clipboard')){try{const u=clipboard.read('public.file-url');if(u.startsWith('file:'))file=require('url').fileURLToPath(u);}catch{}}
  if(!file){const pick=await dialog.showOpenDialog(this.win,{title:'בחר ZIP של סיכום חבר',defaultPath:Bool(m,'onedrive')?this.HitOneDrive():undefined,properties:['openFile'],filters:[{name:'ZIP',extensions:['zip']}]});if(pick.canceled)return;file=pick.filePaths[0];}await this.ImportSharedSummary(Str(m,'course'),Int(m,'num'),file);
 },
 IsOneDrivePage(value){try{const h=new URL(value).hostname;return h==='onedrive.live.com'||h.endsWith('.sharepoint.com');}catch{return false;}}
}};
