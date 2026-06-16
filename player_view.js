const PLAYER_STATE_KEY = 'openSeaPlayerState';
const FULL_STATE_KEYS = ['openSeaTrackerDraft', 'openSeaTracker'];
const PLAYER_EFFECT_LABELS = {
  'Dense Fog': 'Dense Fog',
  'School of Fish': 'School of Fish',
  'Pack of Gulls': 'Pack of Gulls',
  'Calm Seas': 'Calm Seas',
  'Large Shadow': 'Large Shadow',
  'Rain and Flying Fish': 'Rain',
  'Rainwater Collection': 'Rain',
  'Night Overtime': 'Night Work',
  'Bilge Pump Jammed': 'Pump Jammed',
  'Fishing Net Tangled': 'Net Tangled',
  'Travel Impaired': 'Travel Blocked',
  'Broken Rigging': 'Rigging Broken',
  'Cargo Hold Flooding': 'Cargo Flooding',
  'Waist-Deep Flooding': 'Waist Deep',
  'Neck-Deep Flooding': 'Neck Deep'
};

function q(id){ return document.getElementById(id); }
function actionMetadata(actionId){ return ACTION_METADATA_BY_ID[actionId] || null; }
function actionMetadataByName(actionName){ return ACTION_METADATA_BY_NAME[actionName] || null; }
function actionGetsFloodedExtraTurn(action){ return Boolean(action?.belowDeck && !action?.noFloodedExtraTurn); }

// Prefer the filtered player snapshot. Fall back to the full save only when the DM page has not published yet.
function readPlayerState(){
  const playerRaw = localStorage.getItem(PLAYER_STATE_KEY);
  if (playerRaw) return JSON.parse(playerRaw);
  for (const key of FULL_STATE_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw) return publicStateFromFullState(JSON.parse(raw));
  }
  return null;
}

// Converts a full GM save into a player-safe shape for direct refresh/fallback loading.
function publicStateFromFullState(state){
  return {
    day: state.day,
    turn: state.turn,
    travel: knownValueFromFullState(state, 'travel'),
    waterLevel: knownWaterLevelFromFullState(state),
    activeLeaks: state.activeLeaks,
    totalIngress: knownValueFromFullState(state, 'totalIngress'),
    food: knownValueFromFullState(state, 'food'),
    freshWater: knownValueFromFullState(state, 'freshWater'),
    repairMaterials: knownValueFromFullState(state, 'repairMaterials'),
    systems: {
      mast: state.mastStatus,
      rudder: state.rudderStatus,
      pump: state.pumpStatus,
      net: state.netStatus,
      rigging: state.riggingStatus
    },
    effects: publicEffectsFromFullState(state),
    ongoing: (state.ongoing || [])
      .filter(item => item.status === 'active')
      .map(item => ({
        name: item.actionName || item.actionId,
        actors: item.actors || [],
        remaining: item.remaining
      })),
    crew: (state.crew || []).map(character => ({
      name: character.name,
      labor: Number(character.labor || 0),
      exhaustion: Number(character.exhaustion || 0),
      currentAction: publicCrewActionFromFullState(state, character.name),
      turnsRemaining: publicCrewTurnsRemainingFromFullState(state, character.name),
      doneInStatus: publicCrewDoneInStatusFromFullState(state, character.name),
      actionConfirmed: Boolean(state.confirmedActions?.[character.name]),
      lastAction: character.lastAction || ''
    })),
    updatedAt: Date.now()
  };
}

function publicCrewTurnsRemainingFromFullState(state, name){
  const ongoing = (state.ongoing || []).find(item => item.status === 'active' && (item.actors || []).includes(name));
  if (ongoing) return String(Number(ongoing.remaining || 1));
  const actionId = state.plannedActions?.[name];
  if (!actionId) return '';
  return String(publicActionDurationFromFullState(state, actionId));
}

function publicActionDurationFromFullState(state, actionId){
  const action = actionMetadata(actionId);
  const base = Number(action?.duration || 1);
  const floodedPenalty = actionGetsFloodedExtraTurn(action) && Number(state.waterLevel || 0) >= 5 ? 1 : 0;
  return base + floodedPenalty;
}

function publicCrewDoneInStatusFromFullState(state, name){
  const actionId = state.plannedActions?.[name];
  if (!actionId) return (state.ongoing || []).some(item => item.status === 'active' && (item.actors || []).includes(name)) ? 'normal' : '';
  return actionGetsFloodedExtraTurn(actionMetadata(actionId)) && Number(state.waterLevel || 0) >= 5 ? 'flooded' : 'normal';
}

function publicCrewActionFromFullState(state, name){
  const actionId = state.plannedActions?.[name];
  if (!actionId) return (state.crew || []).find(character => character.name === name)?.lastAction || '';
  return publicActionName(actionId);
}

function publicActionName(actionId){
  return actionMetadata(actionId)?.name || actionId;
}

// Unknown values stay hidden until the DM reveals them or an action updates player knowledge.
function knownValueFromFullState(state, key){
  const value = state.playerKnowledge?.[key];
  return {
    known: value !== null && value !== undefined,
    value: value ?? null
  };
}

// Flooding in the cargo hold is automatically visible; lower bilge levels require a sounding rod check.
function knownWaterLevelFromFullState(state){
  if (Number(state.waterLevel) >= 5) {
    return {known:true, value:Number(state.waterLevel), automatic:true};
  }
  const known = knownValueFromFullState(state, 'waterLevel');
  if (known.known) return known;
  return {known:false, value:null, safeBelowCargo:true};
}

// Rebuild player-facing active effects from the full state fallback.
function publicEffectsFromFullState(state){
  const conditions = (state.conditions || [])
    .filter(condition => Number(condition.turns) > 0)
    .map(condition => ({
      title: condition.name,
      detail: `${condition.turns} turn${Number(condition.turns) === 1 ? '' : 's'} remaining.`
    }));
  if (state.isNightOvertime) conditions.push({title:'Night Overtime', detail:'The crew is working through the night. Exhaustion risk is increasing.', className:'danger'});
  if (state.pumpStatus === 'Jammed') conditions.push({title:'Bilge Pump Jammed', detail:'The bilge pump cannot be used until repaired.'});
  if (state.netStatus === 'Tangled') conditions.push({title:'Fishing Net Tangled', detail:'The fishing net must be reset before it can be cast again.'});
  if (state.mastStatus === 'Broken' || state.rudderStatus === 'Broken') conditions.push({title:'Travel Impaired', detail:'The ship cannot make normal progress until repaired.'});
  if (state.riggingStatus === 'Broken') conditions.push({title:'Broken Rigging', detail:'Snapped rigging is making the deck dangerous.'});
  return conditions;
}

// Main player render. Everything here uses already-filtered state, not DM-only raw values.
function render(){
  const state = readPlayerState();
  if (!state) {
    renderEmpty();
    return;
  }
  q('playerTurn').innerHTML = turnChips(state.day, state.turn);
  q('playerTravel').innerHTML = `<div class="score-label">Days</div><div class="score-value">${escapeHtml(stateValue(state.travel, value => formatNumber(value)))}</div>`;
  q('playerUpdated').textContent = `Updated ${formatTime(state.updatedAt)}`;
  q('playerShipStats').innerHTML = [
    waterMeterCard(state.waterLevel),
    `<div class="player-ship-substats">
      ${statCard('Active Leaks', state.activeLeaks, Number(state.activeLeaks) ? 'warn' : 'good')}
      ${statCard('Total Ingress', stateValue(state.totalIngress), 'unknown')}
    </div>`
  ].join('');
  q('playerSupplies').innerHTML = [
    statCard('Food', stateValue(state.food), knownClass(state.food, value => Number(value) <= 1 ? 'danger' : 'good')),
    statCard('Water', stateValue(state.freshWater), knownClass(state.freshWater, value => Number(value) <= 1 ? 'danger' : 'good')),
    statCard('Repairs', stateValue(state.repairMaterials), knownClass(state.repairMaterials, value => Number(value) <= 1 ? 'warn' : 'good'))
  ].join('');
  q('playerSystems').innerHTML = [
    statCard('Mast', state.systems.mast, systemClass(state.systems.mast)),
    statCard('Rudder', state.systems.rudder, systemClass(state.systems.rudder)),
    statCard('Pump', state.systems.pump, systemClass(state.systems.pump)),
    statCard('Net', state.systems.net, systemClass(state.systems.net)),
    statCard('Rigging', state.systems.rigging, systemClass(state.systems.rigging))
  ].join('');
  renderEffects(state.effects || []);
  renderCrew(state.crew || []);
}

function renderEmpty(){
  q('playerTurn').innerHTML = turnChips('--', '--');
  q('playerTravel').innerHTML = '<div class="score-label">Days</div><div class="score-value">--</div>';
  q('playerUpdated').textContent = 'No tracker data found';
  ['playerShipStats','playerSupplies','playerSystems','playerEffects','playerCrew'].forEach(id => {
    q(id).innerHTML = '<span class="pill">Waiting for DM tracker...</span>';
  });
}

function statCard(label, value, className = ''){
  return `<div class="player-card ${className}">
    <div class="score-label">${escapeHtml(label)}</div>
    <div class="score-value">${escapeHtml(String(value ?? '--'))}</div>
  </div>`;
}

function turnChips(day, turn){
  return `<div class="player-card player-turn-chip">
    <div class="score-label">Day</div>
    <div class="score-value">${escapeHtml(day)}</div>
  </div>
  <div class="player-card player-turn-chip">
    <div class="score-label">Turn</div>
    <div class="score-value">${escapeHtml(turn)}</div>
  </div>`;
}

// Water is shown as a vertical fill meter with danger breakpoints at 5, 10, 15, and 20.
function waterMeterCard(field){
  const known = !(field && typeof field === 'object' && 'known' in field) || field.known;
  const safeBelowCargo = Boolean(field?.safeBelowCargo);
  const value = known ? Number(field?.value ?? field) : 0;
  const percentage = known ? Math.max(0, Math.min(100, (value / 20) * 100)) : 0;
  const dangerColor = known ? waterTextColor(value) : '';
  const displayValue = known ? formatNumber(value) : (safeBelowCargo ? 'Below Cargo Hold' : '?');
  const detail = known ? `${formatNumber(percentage)}% full` : (safeBelowCargo ? 'Safe, exact level unknown' : 'Exact level unknown');
  return `<div class="player-card water-meter-card ${waterClass(field)}">
    <div class="water-meter-layout">
      <div class="water-meter" aria-label="Water level ${escapeHtml(displayValue)} out of 20">
        ${known ? '' : `<div class="water-empty-readout water-readout-safe">
          <div class="water-fill-value">${escapeHtml(displayValue)}</div>
          <div class="water-fill-detail">${escapeHtml(detail)}</div>
        </div>`}
        <div class="water-fill" style="height:${percentage}%">
          <div class="water-fill-readout${known ? '' : ' hidden'}" style="${dangerColor ? `--water-text-color:${dangerColor}` : ''}">
            <div class="water-fill-value">${escapeHtml(displayValue)}</div>
            <div class="water-fill-detail">${escapeHtml(detail)}</div>
          </div>
        </div>
        ${waterMarker(5, 'Cargo Hold')}
        ${waterMarker(10, 'Waist Deep')}
        ${waterMarker(15, 'Neck Deep')}
        ${waterMarker(20, 'Sunk')}
      </div>
    </div>
  </div>`;
}

function waterTextColor(value){
  const ratio = Math.max(0, Math.min(1, Number(value) / 20));
  const red = Math.round(255);
  const green = Math.round(244 - ratio * 120);
  const blue = Math.round(214 - ratio * 155);
  return `rgb(${red}, ${green}, ${blue})`;
}

function waterMarker(level, label){
  const bottom = Math.max(0, Math.min(100, (level / 20) * 100));
  return `<div class="water-marker" style="bottom:${bottom}%">
    <span>${escapeHtml(label)}</span>
  </div>`;
}

// Handles known/unknown value objects published by tracker.js.
function stateValue(field, formatter = formatNumber){
  if (field && typeof field === 'object' && 'known' in field) {
    return field.known ? formatter(field.value) : '?';
  }
  return formatter(field);
}

function knownClass(field, classForValue){
  if (field && typeof field === 'object' && 'known' in field) {
    return field.known ? classForValue(field.value) : 'unknown';
  }
  return classForValue(field);
}

function renderEffects(effects){
  if (!effects.length) {
    q('playerEffects').innerHTML = '<span class="pill good">No active effects</span>';
    return;
  }
  q('playerEffects').innerHTML = effects.map(effect =>
    `<span class="player-effect-chip ${escapeHtml(effect.className || '')}">${escapeHtml(effectLabel(effect.title))}</span>`
  ).join('');
}

function renderCrew(crew){
  if (!crew.length) {
    q('playerCrew').innerHTML = '<span class="pill">No crew data</span>';
    return;
  }
  q('playerCrew').innerHTML = `<div class="player-crew-table">
    <div class="player-crew-header">
      <div>Name</div>
      <div>Labor</div>
      <div>Exhaustion</div>
      <div>Selected Action</div>
      <div>Done In</div>
    </div>
    ${crew.map(character => `<div class="player-crew-row">
      <div class="player-crew-name">${escapeHtml(character.name)}</div>
      <div class="player-crew-number">${escapeHtml(formatNumber(character.labor))}</div>
      <div class="player-crew-number">${escapeHtml(formatNumber(character.exhaustion))}</div>
      <div class="player-crew-action">${escapeHtml(crewActionText(character))}</div>
      <div class="player-crew-number player-done-in ${escapeHtml(character.doneInStatus || '')}">${escapeHtml(character.turnsRemaining || '-')}</div>
    </div>`).join('')}
  </div>`;
}

function crewActionText(character){
  if (character.currentAction) return actionLabel(character.currentAction);
  return character.lastAction ? `Last: ${actionLabel(character.lastAction)}` : 'No action selected';
}

function actionLabel(actionName){
  const action = actionMetadata(actionName) || actionMetadataByName(actionName);
  return action?.playerLabel || action?.name || actionName || 'No action selected';
}

function effectLabel(effectName){
  return PLAYER_EFFECT_LABELS[effectName] || effectName || 'Active Effect';
}
function waterClass(level){
  if (level && typeof level === 'object' && 'known' in level) {
    if (!level.known) return 'unknown';
    return waterClass(level.value);
  }
  const value = Number(level);
  if (value >= 15) return 'danger';
  if (value >= 5) return 'warn';
  return 'good';
}

function systemClass(status){
  return ['Working','Repaired','Ready','Intact'].includes(status) ? 'good' : 'danger';
}

function formatNumber(value){
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function turnCountLabel(value){
  const turns = Number(value);
  if (!Number.isFinite(turns)) return '--';
  return `${formatNumber(turns)} Turn${turns === 1 ? '' : 's'}`;
}

function formatTime(value){
  if (!value) return 'never';
  return new Date(value).toLocaleTimeString([], {hour:'numeric', minute:'2-digit', second:'2-digit'});
}

function escapeHtml(value){
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Storage events update this page when it is open in another tab/window.
window.addEventListener('storage', event => {
  if ([PLAYER_STATE_KEY, ...FULL_STATE_KEYS].includes(event.key)) render();
});
setInterval(render, 1000);
render();
