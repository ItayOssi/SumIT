const assert=require('assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),Module=require('module');
// Exercise pure logic on non-macOS hosts without launching Electron or reading user settings.
const original=Module._load;Module._load=function(id,...args){if(id==='electron')return {};return original.call(this,id,...args);};
const root=path.resolve(__dirname,'..');
let count=0;function syntax(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,ent.name);if(ent.isDirectory())syntax(f);else if(f.endsWith('.js')){new vm.Script(fs.readFileSync(f,'utf8'),{filename:f});count++;}}}syntax(path.join(root,'lib'));
require('./check.js');
const util=require('../lib/util');const summary=require('../lib/modules/summary-chat').methods;
(async()=>{
const calls=[];const fake={settings:{geminiKey:util.Protect('TEST'),openaiKey:util.Protect('TEST')},HelperMode:()=> 'key',Diagnostic(){},FailureKind:()=> 'rate-or-quota',Send(){},claudeLoggedIn:false,async HelperCall(...args){calls.push(args);return {Error:args[0]==='gemini',Provider:args[0],Text:'answer'};}};
const image=Buffer.from([1,2,3]),messages=[['user','question']];
const result=await summary.SummaryGemini.call(fake,'COMPLETE_CONTEXT',messages,image);
assert.equal(result.Provider,'openai');assert.equal(calls.length,2);assert.equal(calls[0][1],'TEST');assert.equal(calls[1][2],'COMPLETE_CONTEXT');assert.equal(calls[1][5],image);
const support=require('../lib/modules/support').methods;
assert.equal(support.FailureKind('HTTP 429 RESOURCE_EXHAUSTED'),'rate-or-quota');assert.equal(support.FailureKind('What does quota mean?'),'unknown');
assert.equal(support.IsOneDrivePage('https://tenant.sharepoint.com/path'),true);assert.equal(support.IsOneDrivePage('https://tenant.sharepoint.com.evil.invalid'),false);
console.log('PASS Mac syntax/module loading, API key decryption, Gemini-to-ChatGPT fallback with image/full context and diagnostic classification ('+count+' files)');
})().catch(e=>{console.error(e);process.exit(1)});
