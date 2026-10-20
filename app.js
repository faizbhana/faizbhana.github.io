import {seed, receive, prune, RETENTION} from './core.js';
const byId = identifier => document.getElementById(identifier);
const storageKey = 'my-helper-encrypted-v1';
const encoder = new TextEncoder();
let state = null;
let ownerPassword = '';
let encryptionKey = null;
let salt = null;
let replies = [];
let saveChain = Promise.resolve();
let resetArmed = false;
const bytesToText = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const textToBytes = text => Uint8Array.from(atob(text), character=>character.charCodeAt(0));
const time = stamp => new Date(stamp).toLocaleString();
const number = value => value.replace(/[^0-9]/g,'');
async function derive(password, keySalt) {
  const material = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt:keySalt,iterations:250000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function persist() {
  const snapshot = JSON.stringify({...state,queue:[]});
  const activeKey = encryptionKey;
  const activeSalt = salt;
  saveChain = saveChain.catch(()=>{}).then(async()=>{
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},activeKey,encoder.encode(snapshot));
    localStorage.setItem(storageKey,JSON.stringify({version:1,salt:bytesToText(activeSalt),iv:bytesToText(nonce),data:bytesToText(ciphertext)}));
  });
  return saveChain;
}
function textElement(tag,text,className) {
  const element = document.createElement(tag); element.textContent = text;
  if(className) element.className=className;
  return element;
}
function toggle(identifier,title,container) {
  const label = textElement('label',title,'switch');
  const control = document.createElement('input');control.type='checkbox';control.id=identifier;
  control.checked = state[identifier];
  control.addEventListener('change',async()=>{
    state[identifier]=control.checked;
    await drainQueue(); await storeAndRender();
  });
  label.append(control);container.append(label);
}
function table(container,headings,rows) {
  container.replaceChildren();
  if(!rows.length){container.append(textElement('p','No records yet.','empty'));return;}
  const wrap=document.createElement('div');wrap.className='table-wrap';
  const grid=document.createElement('table');const head=document.createElement('thead');const heading=document.createElement('tr');
  headings.forEach(value=>heading.append(textElement('th',value)));head.append(heading);grid.append(head);
  const body=document.createElement('tbody');
  rows.forEach(values=>{const row=document.createElement('tr');values.forEach(value=>row.append(textElement('td',String(value))));body.append(row);});
  grid.append(body);wrap.append(grid);container.append(wrap);
}
function renderReplies() {
  byId('replies').replaceChildren();
  if(!replies.length) byId('replies').append(textElement('p','No SMS replies received.','empty'));
  replies.forEach(reply=>{const bubble=document.createElement('article');bubble.className='bubble';bubble.append(textElement('small',`TO ${reply.to} · ${time(reply.at)}`),textElement('p',reply.text));byId('replies').append(bubble);});
}
function render() {
  if(!state)return;
  const reachable=state.powered&&state.signal;
  byId('connection').textContent = reachable?'Reachable':'Unreachable';
  byId('phone-time').textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  byId('phone-icon').textContent=!state.powered?'○':state.locked?'▣':state.sound==='Normal'?'♫':'⌖';
  byId('phone-state').textContent=!state.powered?'Powered off':state.locked?'Screen locked':state.sound==='Normal'?'Sound is on':'Ready when you are';
  byId('phone-subtitle').textContent=state.powered?'Simulated Android phone':'Commands wait for reconnection';
  byId('sound-state').textContent=state.sound;byId('lock-state').textContent=state.locked?'Locked':'Unlocked';
  byId('device-status').replaceChildren();
  [['Configuration',state.configured?'Complete':'SETUP required'],['Mobile signal',state.signal?'Available':'No signal'],['Internet',state.internet?'On':'Off · SMS independent'],['Carrier queue',`${state.queue.length} message(s)`],['Native command inbox',state.smsPermission?'0 visible · simulated suppression':'Receiver unavailable · no interception']].forEach(([label,value])=>{
    const row=document.createElement('div');row.append(textElement('span',label),textElement('b',value));byId('device-status').append(row);
  });
  byId('unlock-controls').hidden=!state.locked||!state.powered;
  byId('scenario-toggles').replaceChildren();byId('permissions').replaceChildren();
  [['powered','Phone powered on'],['signal','Mobile signal available'],['internet','Target Internet enabled'],['gps','GPS available'],['cell','Cell tower location available'],['nativeLock','Existing native screen lock']].forEach(([identifier,title])=>toggle(identifier,title,byId('scenario-toggles')));
  [['smsPermission','SMS receiver permission'],['locationPermission','Location permission'],['contactsPermission','Read-only contacts permission'],['adminPermission','Device administration permission']].forEach(([identifier,title])=>toggle(identifier,title,byId('permissions')));
  const latest=state.lastKnown;
  byId('location-summary').replaceChildren(textElement('b',latest?'Latest location observation':'Location not yet available'));
  if(latest){const live=reachable&&state.locationPermission&&(state.gps||state.cell)&&latest.at>=state.current.at&&Date.now()-latest.at<60000;
    byId('location-summary').append(textElement('p',`${live?'Live at last simulated LOCATE':'Last known · not live'}: ${latest.lat.toFixed(4)}, ${latest.lon.toFixed(4)} | ${latest.source}`),textElement('p',`Captured ${time(latest.at)}${latest.delayed?' · command was delayed':''}. Send LOCATE for a fresh observation.`));
  }else byId('location-summary').append(textElement('p','Send an authenticated LOCATE command to capture an observation.'));
  table(byId('history'),['Captured','Coordinates','Source','Delivery'],[...state.history].reverse().map(record=>[time(record.at),`${record.lat.toFixed(4)}, ${record.lon.toFixed(4)}`,record.source,record.delayed?'Delayed command':'Immediate']));
  table(byId('audit'),['Time','Command','Outcome'],[...state.logs].reverse().map(record=>[time(record.at),record.action,record.status]));
  renderReplies();
}
async function storeAndRender(){prune(state);try{await persist();}catch{byId('diagnostic').textContent='Browser storage unavailable. Changes work in this session but could not be saved.';}render();}
async function drainQueue(){
  if(!state.powered||!state.signal)return;
  const pending=state.queue.splice(0);
  for(const message of pending){const result=receive(state,message,ownerPassword);replies.push(...result.replies);byId('diagnostic').textContent=result.diagnostic;if(result.status==='success'&&message.command.trim().toUpperCase()==='SOUND ON')ring();}
  if(pending.length)byId('diagnostic').textContent=`Processed ${pending.length} queued message(s). ${byId('diagnostic').textContent}`;
}
function bootAuth(){
  let existing=false;
  try{existing=Boolean(localStorage.getItem(storageKey));}catch{byId('auth-error').textContent='Browser storage is blocked. Enable local storage to use owner access.';}
  byId('auth-title').textContent=existing?'Welcome back, owner':'Start your recovery lab';
  byId('auth-submit').textContent=existing?'Unlock local owner':'Create local owner';
  byId('auth-description').textContent=existing?'Enter your demo password to decrypt this browser’s configuration and history. There is no server account or remote password recovery.':'Create a demo password to protect this browser’s saved configuration. Use fictional details and a password you do not use elsewhere.';
}
byId('auth-form').addEventListener('submit',async event=>{
  event.preventDefault();byId('auth-error').textContent='';byId('auth-submit').disabled=true;
  const password=byId('owner-password').value;
  try{
    if(!crypto.subtle)throw new Error('Use localhost or HTTPS for browser encryption.');
    if(/\s/.test(password))throw new Error('Use a demo password without spaces.');
    const stored=localStorage.getItem(storageKey);
    if(stored){
      try{const envelope=JSON.parse(stored);salt=textToBytes(envelope.salt);encryptionKey=await derive(password,salt);
        const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:textToBytes(envelope.iv)},encryptionKey,textToBytes(envelope.data));state=JSON.parse(new TextDecoder().decode(plaintext));
      }catch{throw new Error('Password incorrect or saved demo data is damaged. No data opened.');}
    }else{salt=crypto.getRandomValues(new Uint8Array(16));encryptionKey=await derive(password,salt);state=seed();}
    ownerPassword=password;state.queue=[];prune(state);await persist();
    byId('owner-password').value='';byId('target-number').value=state.target;byId('recipient').value=state.target;byId('sender').value='+1 202 555 0199';
    byId('auth').hidden=true;byId('workspace').hidden=false;byId('logout').hidden=false;render();
  }catch(error){state=null;encryptionKey=null;ownerPassword='';byId('auth-error').textContent=error.message;}
  finally{byId('auth-submit').disabled=false;}
});
byId('sms-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!state)return;byId('send').disabled=true;
  try{
    if(number(byId('recipient').value)!==number(state.target)){byId('diagnostic').textContent='Wrong destination number. This target did not receive the message.';return;}
    const result=receive(state,{from:byId('sender').value,password:byId('sms-password').value,command:byId('command').value},ownerPassword);
    replies.push(...result.replies);byId('diagnostic').textContent=result.diagnostic;
    if(result.status==='success'&&byId('command').value.trim().toUpperCase()==='SOUND ON') ring();
    await storeAndRender();
  }finally{byId('send').disabled=false;}
});
function ring(){
  try{const audio=new AudioContext();const oscillator=audio.createOscillator();const gain=audio.createGain();oscillator.frequency.value=660;gain.gain.value=.07;oscillator.connect(gain);gain.connect(audio.destination);oscillator.start();oscillator.stop(audio.currentTime+.65);oscillator.onended=()=>audio.close();}
  catch{byId('diagnostic').textContent+=' Browser audio unavailable; visual sound state still changed.';}
}
document.querySelectorAll('[data-command]').forEach(button=>button.addEventListener('click',()=>{byId('command').value=button.dataset.command;byId('command').focus();}));
document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.panel').forEach(panel=>panel.hidden=panel.id!==button.dataset.panel);
  document.querySelectorAll('.tab').forEach(tab=>tab.classList.toggle('active',tab===button));
}));
byId('save-number').addEventListener('click',async()=>{
  const input=byId('target-number');if(!input.checkValidity()||number(input.value).length<7){byId('number-status').textContent='Enter a valid fictional phone number.';return;}
  state.target=input.value;state.configured=false;byId('recipient').value=state.target;byId('number-status').textContent='Number saved. Send SETUP again to configure this number.';await storeAndRender();
});
byId('move').addEventListener('click',async()=>{state.current={lat:state.current.lat+.003,lon:state.current.lon+.002,at:Date.now()};byId('diagnostic').textContent='Sample device moved. Send LOCATE to capture its new position.';await storeAndRender();});
byId('silence').addEventListener('click',async()=>{state.sound='Silent';await storeAndRender();});
byId('unlock').addEventListener('click',async()=>{if(byId('device-pin').value!=='2468'){byId('pin-status').textContent='Incorrect demo device PIN.';return;}state.locked=false;byId('device-pin').value='';byId('pin-status').textContent='';await storeAndRender();});
byId('clear-replies').addEventListener('click',()=>{replies=[];renderReplies();});
byId('clear-history').addEventListener('click',async()=>{state.history=[];state.lastKnown=null;await storeAndRender();});
byId('retention-demo').addEventListener('click',async()=>{
  state.history.push({lat:27.95,lon:-82.45,at:Date.now()-RETENTION-1000,source:'Expired sample',delayed:false});const before=state.history.length;prune(state);byId('retention-status').textContent=`Retention removed ${before-state.history.length} expired sample record(s).`;await storeAndRender();
});
async function lockSession(){
  await saveChain.catch(()=>{});state=null;encryptionKey=null;salt=null;ownerPassword='';replies=[];
  byId('workspace').hidden=true;byId('auth').hidden=false;byId('logout').hidden=true;
  ['history','audit','replies','location-summary','device-status','permissions','scenario-toggles'].forEach(identifier=>byId(identifier).replaceChildren());
  ['sms-password','device-pin','owner-password','target-number','sender','recipient'].forEach(identifier=>byId(identifier).value='');
  byId('diagnostic').textContent='Owner session locked.';byId('auth-error').textContent='';bootAuth();
}
byId('logout').addEventListener('click',lockSession);
byId('reset').addEventListener('click',async()=>{
  if(!resetArmed){resetArmed=true;byId('reset-message').textContent='This deletes this browser’s demo configuration and history. Click Reset this demo again to confirm.';return;}
  await saveChain.catch(()=>{});localStorage.removeItem(storageKey);resetArmed=false;byId('reset-message').textContent='';await lockSession();
});
setInterval(async()=>{if(!state)return;await storeAndRender();},60000);
window.addEventListener('pagehide',()=>{ownerPassword='';encryptionKey=null;state=null;replies=[];byId('workspace').hidden=true;byId('auth').hidden=false;byId('logout').hidden=true;['history','audit','replies','location-summary'].forEach(identifier=>byId(identifier).replaceChildren());['sms-password','device-pin','owner-password'].forEach(identifier=>byId(identifier).value='');});
bootAuth();
