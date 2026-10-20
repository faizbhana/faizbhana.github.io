export const RETENTION = 30 * 86400000;
export const seed = (now = Date.now()) => ({
  configured: false, target: '+1 202 555 0100', powered: true, signal: true, internet: false,
  gps: true, cell: true, smsPermission: true, locationPermission: true, contactsPermission: true,
  adminPermission: true, nativeLock: true, locked: false, sound: 'Silent',
  current: {lat: 27.9506, lon: -82.4572, at: now}, history: [], logs: [], queue: [],
  contacts: [{name:'Alex Morgan',number:'+1 202 555 0101'},{name:'Alex Martin',number:'+1 202 555 0102'},
    {name:'Alex Moore',number:'+1 202 555 0103'},{name:'Alex Moss',number:'+1 202 555 0104'},
    {name:'Taylor Lee',number:'+1 202 555 0105'},{name:'Sam Rivera',number:'+1 202 555 0106'}]
});
export function prune(state, now = Date.now()) {
  state.history = state.history.filter(record => record.at >= now - RETENTION);
  if (state.lastKnown && state.lastKnown.at < now - RETENTION) state.lastKnown = null;
  state.logs = state.logs.slice(-100);
}
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
function distance(first, second) {
  const row = Array.from({length:second.length + 1}, (_, index) => index);
  for (let outer=1; outer<=first.length; outer++) {
    let diagonal = row[0]; row[0] = outer;
    for (let inner=1; inner<=second.length; inner++) {
      const previous = row[inner];
      row[inner] = Math.min(row[inner]+1,row[inner-1]+1,diagonal+(first[outer-1] === second[inner-1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return row[second.length];
}
export function matches(contacts, query) {
  const term = normalize(query);
  if (!term) return [];
  return contacts.map(contact => ({...contact, exact:normalize(contact.name) === term}))
    .filter(contact => normalize(contact.name).includes(term) || contact.name.split(/\s+/).some(part => distance(normalize(part),term)<=1))
    .sort((first,second)=>Number(second.exact)-Number(first.exact)).slice(0,3);
}
export function receive(state, message, validPassword, now = Date.now()) {
  prune(state,now);
  if (!state.powered || !state.signal) {
    state.queue.push({...message, queuedAt:now});
    return {status:'queued', replies:[], diagnostic:'Carrier queue simulation: awaiting power and mobile signal.'};
  }
  if (!state.smsPermission) return {status:'blocked',replies:[],diagnostic:'SMS receiver permission unavailable. Nothing intercepted.'};
  if (message.password !== validPassword || !message.password) return {status:'ignored',replies:[],diagnostic:'Silently ignored. No action and no sender reply.'};
  const command = message.command.trim().replace(/\s+/g,' ').toUpperCase();
  const reply = text => ({to:message.from, text, at:now});
  const finish = (status,text,action=command) => {
    state.logs.push({at:now,action,status});
    prune(state,now);
    return {status,replies:[reply(text)],diagnostic:status === 'success' ? 'Authenticated command executed; command SMS suppressed in simulated native inbox.' : 'Authenticated command could not complete.'};
  };
  if (command === 'SETUP') {
    state.configured = true;
    return finish('success',`SETUP successful | ${new Date(now).toISOString()} | My Helper configured for ${state.target}. Commands: LOCATE, SOUND ON, LOCK, CONTACT [name]. Include your password every time.`);
  }
  if (!state.configured) return finish('error','Setup required. Send SETUP with the password after completing owner registration.');
  const confirmation = text => `${command} | ${new Date(now).toISOString()} | ${text}`;
  if (command === 'LOCATE') {
    if (!state.locationPermission) return finish('error','LOCATE failed: location permission denied.');
    if (!state.gps && !state.cell) return finish('error','LOCATE failed: GPS and cell tower location unavailable. No current location can be determined.');
    const location = {...state.current,at:now,source:state.gps?'GPS':'Cell tower',delayed:Boolean(message.queuedAt)};
    state.lastKnown = location; state.history.push(location);
    return finish('success',confirmation(`${location.source} ${location.lat.toFixed(4)}, ${location.lon.toFixed(4)} | https://maps.google.com/?q=${location.lat},${location.lon}${location.delayed?' | Delayed command; this is the position at execution, not at send time.':''}`));
  }
  if (command === 'SOUND ON') {state.sound = 'Normal'; return finish('success',confirmation('Sound profile is Normal. Ring requested.'));}
  if (command === 'LOCK') {
    if (!state.adminPermission) return finish('error','LOCK failed: device administration permission denied.');
    if (!state.nativeLock) return finish('error','LOCK cannot be executed: no existing native screen lock is set.');
    state.locked = true; return finish('success',confirmation('Screen locked. Existing device PIN is required to unlock.'));
  }
  if (command.startsWith('CONTACT ')) {
    if (!state.contactsPermission) return finish('error','CONTACT failed: read-only contacts permission denied.');
    const found = matches(state.contacts,message.command.trim().replace(/^contact\s+/i,''));
    return finish(found.length?'success':'error',found.length?confirmation(found.map(contact=>`${contact.name}: ${contact.number}`).join('; ')):'Contact not found.','CONTACT');
  }
  return finish('error','Unknown command. Use LOCATE, SOUND ON, LOCK, or CONTACT [name].');
}
