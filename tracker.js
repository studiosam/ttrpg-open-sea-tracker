const APP_VERSION = 5;
const PLAYER_STATE_KEY = 'openSeaPlayerState';
const ACTION_COMMIT_SNAPSHOT_KEY = 'openSeaActionCommitSnapshot';
const crewNames = ['Leopold', 'Delilah', 'Toady', 'Xander', 'Grumbo', 'Tommy'];
const defaultSailorPirateCrew = new Set(['Leopold', 'Toady']);

// Canonical starting state for a new tracker session.
// Migrations use this as a complete fallback when older saves are missing fields.
const defaultState = {
  version: APP_VERSION,
  day: 1,
  turn: 1,
  travel: 5.5,
  waterLevel: 1,
  minIngress: 1,
  activeLeaks: 0,
  food: 3.0,
  freshWater: 3.0,
  repairMaterials: 4,
  mastStatus: 'Working',
  rudderStatus: 'Working',
  pumpStatus: 'Working',
  netStatus: 'Ready',
  riggingStatus: 'Intact',
  salvagedTimber: 0,
  conditions: [],
  playerKnowledge: {
    travel: null,
    waterLevel: null,
    minIngress: null,
    totalIngress: null,
    food: null,
    freshWater: null,
    repairMaterials: null
  },
  waterKnowledge: {
    turnKey: '',
    knownThisTurn: false,
    lastKnownTurnKey: '',
    streak: 0
  },
  crew: crewNames.map(name => ({name, labor: 0, exhaustion: 0, lastAction: '', sailorPirateBackground: defaultSailorPirateCrew.has(name)})),
  plannedActions: {},
  confirmedActions: {},
  ongoing: [],
  pendingChecks: [],
  deferredCompletions: [],
  consumedMeals: {},
  appliedScriptedEvents: {},
  longRestLaborRecoveryPending: false,
  restMealStatus: {pending:false, dinnerAvailable:null, dinnerKey:'', breakfastAvailable:null, breakfastKey:''},
  noMealStreak: 0,
  turnLedger: {pumping: 0, buckets: 0},
  startedGroups: {},
  startPromptKey: '',
  turnStep: 1,
  scriptedCheckedThisTurn: false,
  eventResolvedThisTurn: false,
  actionsCommittedThisTurn: false,
  waterUpdatedThisTurn: false,
  waterTravelPenalty: 0,
  isNightOvertime: false,
  overtimeTurnCount: 0,
  overtimeExhaustion: Object.fromEntries(crewNames.map(name => [name, 0])),
  log: ''
};
let state = structuredClone(defaultState);
let undoStack = [];
let actionCommitSnapshot = null;

// Undo is intentionally in-memory only. Saves and exports remain clean current-state snapshots.
function pushUndo(label){
  undoStack.push({label, state:structuredClone(state)});
  if (undoStack.length > 20) undoStack.shift();
  renderUndoStatus();
}

function undoLastChange(){
  const snapshot = undoStack.pop();
  if (!snapshot) return;
  state = structuredClone(snapshot.state);
  migrateState();
  log(`Undid: ${snapshot.label}.`);
  saveStateSnapshot();
  render();
}

function renderUndoStatus(){
  const button = q('undoButton');
  if (!button) return;
  const last = undoStack[undoStack.length - 1];
  button.disabled = !last;
  button.textContent = 'Undo';
  button.title = last ? `Restore state before: ${last.label}` : 'No changes to undo';
}

function storeActionCommitSnapshot(snapshot){
  actionCommitSnapshot = structuredClone(snapshot);
  sessionStorage.setItem(ACTION_COMMIT_SNAPSHOT_KEY, JSON.stringify(actionCommitSnapshot));
}

function readActionCommitSnapshot(){
  if (actionCommitSnapshot) return actionCommitSnapshot;
  const raw = sessionStorage.getItem(ACTION_COMMIT_SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    actionCommitSnapshot = JSON.parse(raw);
    return actionCommitSnapshot;
  } catch {
    clearActionCommitSnapshot();
    return null;
  }
}

function clearActionCommitSnapshot(){
  actionCommitSnapshot = null;
  sessionStorage.removeItem(ACTION_COMMIT_SNAPSHOT_KEY);
}

// Open Sea Event table. Event handlers should only apply immediate effects and create prompts.
const events = {
  1: {title:'Hull Groans', text:'Minimum Water Ingress increases by 1.', apply:s => { s.minIngress += 1; }},
  2: {title:'Broadside Wave', text:'A wave hits the broadside and doubles every active leak.', apply:s => { s.activeLeaks *= 2; }},
  3: {title:'Nothing Happens', text:'The voyage continues uneventfully.'},
  4: {title:'Nothing Happens', text:'The voyage continues uneventfully.'},
  5: {title:'Nothing Happens', text:'The voyage continues uneventfully.'},
  6: {title:'Dense Fog', text:'Visibility is reduced to 30 feet for 2 turns. Helm checks, fishing checks, floating-object recovery, and ranged attacks against targets not actively engaged in melee are made at disadvantage.', apply:s => addCondition('Dense Fog', 2)},
  7: {title:'Dense Fog', text:'Visibility is reduced to 30 feet for 2 turns. Helm checks, fishing checks, floating-object recovery, and ranged attacks against targets not actively engaged in melee are made at disadvantage.', apply:s => addCondition('Dense Fog', 2)},
  8: {title:'Dense Fog', text:'Visibility is reduced to 30 feet for 2 turns. Helm checks, fishing checks, floating-object recovery, and ranged attacks against targets not actively engaged in melee are made at disadvantage.', apply:s => addCondition('Dense Fog', 2)},
  9: {title:'Large Wave', text:'A repair or seam gives way. Add 1 Active Leak.', apply:s => { s.activeLeaks += 1; }},
  10: {title:'Large Wave', text:'A repair or seam gives way. Add 1 Active Leak.', apply:s => { s.activeLeaks += 1; }},
  11: {title:'Large Wave', text:'A repair or seam gives way. Add 1 Active Leak.', apply:s => { s.activeLeaks += 1; }},
  12: {title:'Rigging Snaps', text:'Random creature on deck makes DC 13 DEX save or takes 2d6 bludgeoning. Rigging can be repaired with 1 Turn, 1 Labor.', apply:s => { s.riggingStatus = 'Broken'; addPrompt({phase:'preAction', type:'save', title:'Rigging Snaps', detail:'Random creature on deck: DC 13 Dexterity save or take 2d6 bludgeoning damage.', dc:13, ability:'DEX', effect:'damageNote'}); }},
  13: {title:'Pack of Gulls', text:'Run a Swarm of Ravens encounter. If not dispatched in 3 rounds, lose 0.5 days rations.', apply:s => { addCondition('Pack of Gulls', 1); log(`Pack of Gulls is active this turn. Characters may spend their action joining the fight for 0 Labor. If the gulls are not dispatched in 3 rounds, reduce Food by 0.5 days.${fogPackOfGullsText()}`); }},
  14: {title:'Bilge Pump Jams', text:'The pump is unusable until repaired. Bucket brigades still function.', apply:s => { s.pumpStatus = 'Jammed'; }},
  15: {title:'Floating Wreckage', text:'Recover with 1 Turn, 1 Labor, DC 12 DEX/Athletics. On success, gain salvaged timber.', apply:s => { addCondition('Floating Wreckage', 1); log(`Floating Wreckage is available this turn. Characters may recover it with a 1-turn, 1-Labor action and DC 12 Dexterity or Athletics check.${fogFloatingWreckageText()}`); }},
  16: {title:'School of Fish', text:'The next Cast Net action this turn has advantage. Harpoons gain no benefit.', apply:s => addCondition('School of Fish', 1)},
  17: {title:'Calm Seas', text:'The helmsman recovers 1 Labor instead of gaining 1 while steering this turn.', apply:s => addCondition('Calm Seas', 1)},
  18: {title:'Large Shadow', text:'A massive shape circles beneath the ship. It may be targeted with the harpoon.', apply:s => { addCondition('Large Shadow', 1); addPrompt({phase:'preAction', type:'manual', title:'Large Shadow', detail:`The shape may be targeted with the harpoon, subject to visibility.${fogLargeShadowText()}`, effect:'manual'}); }},
  19: {title:'Favorable Winds', text:'Travel Time -0.25 days if mast and rudder are functional.', apply:s => {
    if (canTravel()) s.travel = Math.max(0, s.travel - 0.25);
    else addPrompt({phase:'preAction', type:'manual', title:'Favorable Winds Blocked', detail:'Mast or rudder is not functional, so this event does not reduce travel unless manually overridden.', effect:'manual'});
  }},
  20: {title:'Phosphorescent Flying Fish & Rain', text:'Gain +1 day Food and +1 day Water. Characters may spend this turn collecting rainwater as a 0-Labor action.', apply:s => { s.food += 1; s.freshWater += 1; addCondition('Rainwater Collection', 1); }}
};

const scriptedEvents = [
  {
    id:s => `day-${s.day}-breakfast`,
    type:'breakfast',
    title:'Breakfast',
    detail:'Breakfast before Turn 1.',
    matches:s => Number(s.turn) === 1
  },
  {
    id:'day-1-turn-8-sehanines-storm',
    type:'encounter',
    title:`Sehanine's Storm`,
    detail:`A sudden storm arrives. Run this manually: Mance is knocked overboard by a massive wave after fixing the main sail, at least 2 of his skeletons are burnt to ash, the players must stay up doing Night Overtime repairs before bed, and Minimum Water Ingress increases to 2.`,
    stepDetail:`Run Sehanine's Storm before actions. No Open Sea Event is rolled this turn.`,
    activeDetail:'This turn is the sudden storm. Run the Mance overboard event manually, require Night Overtime repairs before bed, and Minimum Water Ingress is raised to 2.',
    className:'danger',
    dmOnly:true,
    blocking:true,
    blocksOpenSea:true,
    alert:true,
    matches:s => Number(s.day) === 1 && Number(s.turn) === 8,
    apply:s => { s.minIngress = Math.max(Number(s.minIngress || 0), 2); }
  },
  {
    id:'day-2-turn-7-nereids',
    type:'encounter',
    title:'Nereids Encounter',
    detail:'Handle roleplay manually; the ship still takes on water, and travel only progresses if someone mans the helm.',
    stepDetail:'Run the Nereids Encounter before actions. No Open Sea Event is rolled this turn.',
    activeDetail:'This turn is the Nereids encounter. Handle the roleplay manually; the ship still takes on water, and travel only progresses if someone mans the helm.',
    className:'good',
    dmOnly:true,
    blocking:true,
    blocksOpenSea:true,
    alert:true,
    matches:s => Number(s.day) === 2 && Number(s.turn) === 7
  },
  {
    id:'day-2-turn-8-bev',
    type:'encounter',
    title:'Bev Nightmare Encounter',
    detail:'Apply ship damage, stolen supplies, and encounter consequences manually. Bev takes out the mast and rudder; Minimum Water Ingress automatically increases to 3.',
    stepDetail:'Run the Bev Nightmare Encounter before actions. No Open Sea Event is rolled this turn.',
    activeDetail:'Apply Bev encounter consequences manually. Minimum Water Ingress is raised to 3 after the mast and rudder are taken out.',
    className:'danger',
    dmOnly:true,
    blocking:true,
    blocksOpenSea:true,
    alert:true,
    matches:s => Number(s.day) === 2 && Number(s.turn) === 8,
    apply:s => { s.minIngress = Math.max(Number(s.minIngress || 0), 3); }
  }
];

// Action definitions drive the dropdowns, validation, labor, prompts, and completion effects.
const actionBehaviors = {
  fightGulls: {complete:(s, actors) => log(`${actors.join(', ')} joined the fight to scare off the gulls.`)},
  collectRainwater: {complete:s => { s.freshWater += 0.5; }},
  helm: {labor:s => hasCondition('Calm Seas') ? -1 : 1},
  resetNet: {complete:s => { s.netStatus = 'Ready'; }},
  repairPump: {complete:s => { s.pumpStatus = 'Working'; }},
  repairRigging: {complete:s => { s.riggingStatus = 'Intact'; }},
  bucket: {complete:s => { s.turnLedger.buckets += 1; }},
  castNet: {complete:s => { s.netStatus = 'Tangled'; }},
  repairLeak: {
    repairCost:(s, actors) => Math.floor(actors.length / 2),
    complete:(s, actors) => { s.activeLeaks = Math.max(0, Number(s.activeLeaks) - Math.floor(actors.length / 2)); }
  },
  repairMast: {complete:s => { s.mastStatus = 'Repaired'; }},
  repairRudder: {complete:s => { s.rudderStatus = 'Repaired'; }}
};
const actions = ACTION_METADATA.map(action => ({...action, ...(actionBehaviors[action.id] || {})}));
const actionOrder = actions.map(a => a.id);

// The DM workflow follows the Core Turn Structure one phase at a time.
const turnSteps = [
  {id:1, title:'Scripted Events', panel:null},
  {id:2, title:'Open Sea Event', panel:'checksPanel'},
  {id:3, title:'Set Actions', panel:'crewPanel'},
  {id:4, title:'Checks', panel:'checksPanel'},
  {id:5, title:'Water / Advance', panel:'voyagePanel'}
];

function q(id){ return document.getElementById(id); }
function h(value){
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
function totalIngress(){ return Number(state.minIngress) + Number(state.activeLeaks); }
function actionById(id){ return actions.find(a => a.id === id); }
function crewByName(name){ return state.crew.find(c => c.name === name); }
function hasCondition(name){ return state.conditions.some(c => c.name === name && c.turns > 0); }
function canTravel(){ return ['Working','Repaired'].includes(state.mastStatus) && ['Working','Repaired'].includes(state.rudderStatus); }
function valueOf(value, fallback){ return typeof value === 'function' ? value(state) : (value ?? fallback); }
function safeId(){ return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

// Fog affects only visibility-dependent checks. These helpers keep that wording consistent.
function denseFogActive(){ return hasCondition('Dense Fog'); }
function hasSailorPirateBackground(name){ return Boolean(crewByName(name)?.sailorPirateBackground); }
function fogHelmText(name){ return denseFogActive() ? (hasSailorPirateBackground(name) ? ' Dense Fog disadvantage is canceled by this character\'s sailor/pirate advantage, so roll normally.' : ' Dense Fog: roll this Survival check at disadvantage.') : ''; }
function fogFishingText(cancelledByAdvantage = false){ return denseFogActive() ? (cancelledByAdvantage ? ' Dense Fog disadvantage is canceled by advantage, so roll normally.' : ' Dense Fog: roll this fishing check at disadvantage.') : ''; }
function fogFloatingWreckageText(){ return denseFogActive() ? ' Dense Fog: this check is at disadvantage. If the wreckage is farther than 30 feet away, it cannot be attempted unless another cue reveals it.' : ''; }
function fogLargeShadowText(){ return denseFogActive() ? ' Dense Fog: harpoon attacks/checks are at disadvantage if the shadow is within 30 feet. If farther than 30 feet away, it cannot be targeted normally unless revealed by sound, light, magic, or another clear cue.' : ''; }
function fogPackOfGullsText(){ return denseFogActive() ? ' Dense Fog: ranged attacks against gulls are at disadvantage unless the gulls are actively swarming the attacker. Gulls beyond 30 feet cannot be targeted normally.' : ''; }
function hasActiveOngoingForAction(actionId){
  return state.ongoing.some(o => o.status === 'active' && o.actionId === actionId);
}
function selectedForAction(actionId){
  return state.crew.filter(c => state.plannedActions[c.name] === actionId).map(c => c.name);
}
function selectedCount(actionId){
  return selectedForAction(actionId).length;
}
function boostActive(action){
  return action.boostGroupSize && selectedForAction(action.id).length >= action.boostGroupSize;
}
function actionDuration(action){
  const base = boostActive(action) ? Number(valueOf(action.boostedDuration, 1)) : Number(valueOf(action.duration, 1));
  return base + belowDeckDurationPenalty(action);
}
function actionLaborCost(action){
  return Number(valueOf(action.labor, 0)) + belowDeckLaborPenalty(action);
}
function belowDeckDurationPenalty(action){
  return action?.belowDeck && !action?.noFloodedExtraTurn && Number(state.waterLevel) >= 5 ? 1 : 0;
}
function belowDeckLaborPenalty(action){
  return action?.belowDeck && Number(state.waterLevel) >= 10 ? 1 : 0;
}
function actionActors(name, action){
  if (action.groupSize || boostActive(action)) return selectedForAction(action.id);
  return [name];
}

// Pull values from the editable support panels before applying manual controls or phase changes.
function syncFromInputs(){
  ['day','turn','travel','waterLevel','minIngress','activeLeaks','food','freshWater','repairMaterials','salvagedTimber'].forEach(id => state[id] = Number(q(id).value));
  ['mastStatus','rudderStatus','pumpStatus','netStatus','riggingStatus'].forEach(id => state[id] = q(id).value);
}

// Single render pass for the GM app. Any state change should eventually flow through here.
function render(){
  migrateState();
  pruneUnavailablePlannedActions();
  ['day','turn','travel','waterLevel','minIngress','activeLeaks','food','freshWater','repairMaterials','salvagedTimber'].forEach(id => q(id).value = state[id]);
  ['mastStatus','rudderStatus','pumpStatus','netStatus','riggingStatus'].forEach(id => q(id).value = state[id]);
  q('totalIngress').textContent = totalIngress();
  renderScoreboard();
  renderWaterEffect();
  renderWaterLedger();
  renderTurnFlow();
  renderStepVisibility();
  renderCrewAdjustOptions();
  renderCrewSetup();
  renderCrew();
  renderActiveEffects();
  renderNightOvertimeControls();
  renderPendingChecks();
  renderConditions();
  renderUndoStatus();
  q('log').textContent = state.log;
  publishPlayerState();
}

function waterScoreClass(){
  const level = Number(state.waterLevel);
  if (level >= 15) return 'danger';
  if (level >= 5) return 'warn';
  return 'good';
}

function waterEffectTitle(){
  const level = Number(state.waterLevel);
  if (level >= 20) return 'Sunk';
  if (level >= 15) return 'Neck Deep';
  if (level >= 10) return 'Waist Deep';
  if (level >= 5) return 'Cargo Hold';
  return 'Bilge Only';
}

function waterEffectScoreClass(){
  const level = Number(state.waterLevel);
  if (level >= 15) return 'danger';
  if (level >= 5) return 'warn';
  return 'good';
}

function waterEffectsScoreItem(){
  const detail = `<div class="score-effect-list">${cumulativeWaterEffects().map(effect => `<div class="score-effect-line">${effect}</div>`).join('')}</div>`;
  return scoreItem('Water Effects', waterEffectTitle(), waterEffectScoreClass(), detail);
}

function cumulativeWaterEffects(){
  const level = Number(state.waterLevel);
  const effects = [];
  if (level < 5) effects.push('No below-deck water penalties.');
  if (level >= 5) effects.push('Cargo Hold: below-deck actions take +1 Turn.');
  if (level >= 10) effects.push('Waist Deep: below-deck actions cost +1 Labor.');
  if (level >= 15) effects.push(`Neck Deep: travel penalty is ${state.waterTravelPenalty || 0} day(s).`);
  if (level >= 20) effects.push('Sunk: the Marrowwind is sinking.');
  return effects;
}

function formatNumber(value){
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function turnCountLabel(value){
  const turns = Number(value);
  return `${formatNumber(turns)} Turn${turns === 1 ? '' : 's'}`;
}

// Always-visible GM scoreboard. This is the safest place for manual overrides mid-turn.
function renderScoreboard(){
  const board = q('scoreboard');
  const turn = q('scoreTurn');
  if (!board || !turn) return;
  const pendingPreAction = pendingPromptCount('preAction');
  const pendingAction = pendingPromptCount('action');
  const pendingWater = pendingPromptCount('water');
  const unresolvedChecks = pendingPreAction + pendingAction + pendingWater;
  const ongoingCount = state.ongoing.filter(o => o.status === 'active').length;
  const brokenSystems = [
    state.mastStatus !== 'Broken' ? '' : 'Mast',
    state.rudderStatus !== 'Broken' ? '' : 'Rudder',
    state.pumpStatus !== 'Jammed' ? '' : 'Pump',
    state.netStatus !== 'Tangled' ? '' : 'Net',
    state.riggingStatus !== 'Broken' ? '' : 'Rigging'
  ].filter(Boolean);
  turn.textContent = `Day ${state.day} Turn ${state.turn} - Step ${state.turnStep}: ${turnSteps.find(step => step.id === state.turnStep)?.title || 'Unknown'}`;
  board.innerHTML = [
    scoreItem('Day / Turn', `${state.day} / ${state.turn}`, '', '', dayTurnControls()),
    scoreItem('Water', state.waterLevel, waterScoreClass(), knowledgeStatus('waterLevel'), scoreControls('waterLevel', 1) + knowledgeControls('waterLevel')),
    waterEffectsScoreItem(),
    scoreItem('Min Ingress', state.minIngress, 'warn', `${knowledgeStatus('minIngress')} · Total ${totalIngress()}`, scoreControls('minIngress', 1) + knowledgeControls('minIngress') + knowledgeControls('totalIngress', 'Reveal Total')),
    scoreItem('Leaks', state.activeLeaks, Number(state.activeLeaks) > 0 ? 'warn' : 'good', '', scoreControls('activeLeaks', 1)),
    scoreItem('Food', formatNumber(state.food), Number(state.food) <= 1 ? 'danger' : '', knowledgeStatus('food'), scoreControls('food', 0.25) + knowledgeControls('food')),
    scoreItem('Fresh Water', formatNumber(state.freshWater), Number(state.freshWater) <= 1 ? 'danger' : '', knowledgeStatus('freshWater'), scoreControls('freshWater', 0.25) + knowledgeControls('freshWater')),
    scoreItem('Repairs', state.repairMaterials, Number(state.repairMaterials) <= 1 ? 'warn' : '', knowledgeStatus('repairMaterials'), scoreControls('repairMaterials', 1) + knowledgeControls('repairMaterials')),
    scoreItem('Travel', `${formatNumber(state.travel)}d`, canTravel() ? '' : 'danger', knowledgeStatus('travel') || (canTravel() ? '' : 'Mast/rudder blocked'), scoreControls('travel', 0.25) + knowledgeControls('travel')),
    systemsScoreItem(),
    scoreItem('Night', state.isNightOvertime ? 'Overtime' : 'Normal', state.isNightOvertime ? 'danger' : '', state.isNightOvertime ? `Save DC ${currentOvertimeSaveDC()} · ${state.overtimeTurnCount} turn(s)` : `Night at Turn ${nighttimeTurnForDay(state.day)}`),
    scoreItem('Checks', unresolvedChecks, unresolvedChecks ? 'warn' : 'good', scoreCheckDetail(pendingPreAction, pendingAction, pendingWater)),
    scoreItem('Ongoing', ongoingCount, ongoingCount ? 'warn' : '')
  ].join('');
  board.querySelectorAll('.score-item').forEach(item => {
    if (item.querySelector('.score-label')?.textContent === 'Night') item.remove();
  });
  updateCrewAdjustReadout();
}

function scoreCheckDetail(preActionCount, actionCount, waterCount){
  if (preActionCount) return `${preActionCount} before actions`;
  if (actionCount) return `${actionCount} action`;
  if (waterCount) return `${waterCount} water`;
  return '';
}

// Scoreboard cards can include compact controls so the DM does not need to leave the current phase.
function scoreItem(label, value, className = '', detail = '', controls = ''){
  return `<div class="score-item ${className}">
    <div class="score-label">${label}</div>
    <div class="score-value">${value}</div>
    ${controls}
    ${detail ? `<div class="score-detail">${detail}</div>` : ''}
  </div>`;
}

function systemsScoreItem(){
  const failed = [
    state.mastStatus === 'Broken',
    state.rudderStatus === 'Broken',
    state.pumpStatus === 'Jammed',
    state.netStatus === 'Tangled',
    state.riggingStatus === 'Broken'
  ].some(Boolean);
  return `<div class="score-item systems-score-item ${failed ? 'warn' : 'good'}">
    <div class="score-label">Systems</div>
    ${scoreSystemControls()}
  </div>`;
}

function scoreControls(field, step){
  return `<div class="score-controls">
    <button type="button" onclick="scoreboardChange('${field}',-${step})" title="Decrease ${field}">-</button>
    <button type="button" onclick="scoreboardChange('${field}',${step})" title="Increase ${field}">+</button>
  </div>`;
}

function dayTurnControls(){
  return `<div class="score-split-controls">
    <span>Day</span>
    <button type="button" onclick="scoreboardChange('day',-1)" title="Decrease Day">-</button>
    <button type="button" onclick="scoreboardChange('day',1)" title="Increase Day">+</button>
    <span>Turn</span>
    <button type="button" onclick="scoreboardChange('turn',-1)" title="Decrease Turn">-</button>
    <button type="button" onclick="scoreboardChange('turn',1)" title="Increase Turn">+</button>
  </div>`;
}

function knowledgeControls(field, revealLabel = 'Reveal'){
  return `<div class="score-knowledge-controls">
    <button type="button" onclick="revealPlayerKnowledge('${field}')" title="Tell players the current ${fieldLabel(field)}">${revealLabel}</button>
    <button type="button" onclick="forgetPlayerKnowledge('${field}')" title="Hide ${fieldLabel(field)} from the player view">?</button>
  </div>`;
}

function knowledgeStatus(field){
  const known = playerKnownValue(field);
  if (field === 'waterLevel' && Number(state.waterLevel) >= 5) return 'Visible: cargo hold';
  return known.known ? `Known: ${formatNumber(known.value)}` : 'Player view: ?';
}

function scoreSystemControls(){
  return `<div class="score-system-controls">
    ${systemControl('mastStatus', 'Mast', 'Working', 'Broken')}
    ${systemControl('rudderStatus', 'Rudder', 'Working', 'Broken')}
    ${systemControl('pumpStatus', 'Pump', 'Working', 'Jammed')}
    ${systemControl('netStatus', 'Net', 'Ready', 'Tangled')}
    ${systemControl('riggingStatus', 'Rigging', 'Intact', 'Broken')}
  </div>`;
}

function systemControl(field, label, repairedStatus, failedStatus){
  const failed = state[field] === failedStatus;
  return `<div class="score-system-control ${failed ? 'failed' : 'ok'}">
    <span>${label}</span>
    <button type="button" onclick="scoreboardSet('${field}','${repairedStatus}')" title="Reset ${label}">${repairedStatus === 'Ready' ? 'R' : 'OK'}</button>
    <button type="button" onclick="scoreboardSet('${field}','${failedStatus}')" title="Fail ${label}">!</button>
  </div>`;
}

function scoreboardChange(field, amount){
  syncFromInputs();
  pushUndo(`Changed ${fieldLabel(field)}`);
  const before = Number(state[field] || 0);
  state[field] = Math.max(0, before + Number(amount));
  if (field === 'waterLevel') updateWaterTravelPenalty();
  if (['day','turn'].includes(field)) reconcileManualNightOvertime();
  log(`Manual override: ${fieldLabel(field)} changed from ${formatNumber(before)} to ${formatNumber(state[field])}.`);
  render();
}

function scoreboardSet(field, value){
  syncFromInputs();
  pushUndo(`Set ${fieldLabel(field)}`);
  const before = state[field];
  state[field] = value;
  log(`Manual override: ${fieldLabel(field)} changed from ${before} to ${value}.`);
  render();
}

function revealPlayerKnowledge(field){
  syncFromInputs();
  pushUndo(`Revealed ${fieldLabel(field)}`);
  rememberPlayerKnowledge(field);
  render();
}

function forgetPlayerKnowledge(field){
  syncFromInputs();
  pushUndo(`Hid ${fieldLabel(field)}`);
  if (!state.playerKnowledge) state.playerKnowledge = structuredClone(defaultState.playerKnowledge);
  state.playerKnowledge[field] = null;
  if (field === 'waterLevel') {
    ensureWaterKnowledgeTurn();
    state.waterKnowledge.knownThisTurn = false;
    hideTotalIngressKnowledge();
  }
  log(`Players no longer have an exact known value for ${fieldLabel(field)}.`);
  render();
}

function renderTurnFlow(){
  const steps = q('turnSteps');
  const body = q('turnStepBody');
  steps.innerHTML = turnSteps.map(step => {
    const stateClass = step.id === state.turnStep ? ' active' : step.id < state.turnStep ? ' done' : '';
    return `<div class="turn-step${stateClass}">${step.id}. ${step.title}</div>`;
  }).join('');
  body.innerHTML = turnStepMarkup();
}

// Hide inactive workflow panels so each phase shows only what is needed to continue.
function renderStepVisibility(){
  const active = turnSteps.find(step => step.id === state.turnStep);
  ['voyagePanel','crewPanel','checksPanel'].forEach(id => q(id).classList.add('hidden'));
  [
    'voyageTopBlock','waterBlock','suppliesBlock','systemsBlock',
    'activeEffectsBlock','crewStatsBlock','turnControlsBlock',
    'pendingBlock','eventBlock','conditionsBlock'
  ].forEach(id => q(id).classList.add('hidden'));
  if (active && active.panel) q(active.panel).classList.remove('hidden');
  if (state.turnStep === 2) {
    const blocks = [];
    if (openSeaEventRequiredForTurn()) blocks.push('eventBlock');
    if (pendingPromptCount('preAction')) blocks.push('pendingBlock');
    if (blocks.length) showBlocks(blocks);
    else q('checksPanel').classList.add('hidden');
  }
  if (state.turnStep === 1 && pendingPromptCount('preAction')) {
    q('checksPanel').classList.remove('hidden');
    showBlocks(['pendingBlock']);
  }
  q('crewPanel').classList.remove('hidden');
  showBlocks(['crewSetupBlock']);
  if (state.turnStep === 3) showBlocks(['activeEffectsBlock','crewStatsBlock']);
  if (state.turnStep === 4) showBlocks(['pendingBlock']);
  if (state.turnStep === 5) {
    showBlocks(['waterBlock']);
  }
  if (state.isNightOvertime || isNightDecisionPoint()) {
    q('crewPanel').classList.remove('hidden');
    showBlocks(['turnControlsBlock']);
  }
  if (state.turnStep === 5 && pendingPromptCount('water')) {
    q('checksPanel').classList.remove('hidden');
    showBlocks(['pendingBlock']);
  }
}

function showBlocks(ids){
  ids.forEach(id => q(id).classList.remove('hidden'));
}

// Builds the instruction card and navigation controls for the active turn phase.
function turnStepMarkup(){
  const pendingCount = pendingPromptCount();
  const preActionCount = pendingPromptCount('preAction');
  const actionCheckCount = pendingPromptCount('action');
  const waterPromptCount = pendingPromptCount('water');
  const unconfirmedCount = state.crew.filter(c => state.plannedActions[c.name] && !state.confirmedActions[c.name]).length;
  const confirmableCount = state.crew.filter(c => canConfirmAction(c.name)).length;
  const eventRequired = openSeaEventRequiredForTurn();
  const eventStatus = !eventRequired ? 'No Open Sea Event is rolled this turn.'
    : state.eventResolvedThisTurn ? 'Event resolved.'
    : 'Enter the d20 result and resolve it before continuing.';
  const nightDecision = isNightDecisionPoint();
  const waterStatus = state.waterUpdatedThisTurn
    ? `Water update applied. ${waterPromptCount ? `${waterPromptCount} water-effect prompt(s) remain.` : (nightDecision ? 'Nightfall reached. Choose Rest or Night Overtime in the panel under the scoreboard.' : 'Use the scoreboard for any final manual overrides, then advance the turn.')}`
    : 'Apply the water formula, review the scoreboard, then advance the turn.';
  const scripted = scriptedEventForTurn();
  const scriptedText = scripted ? (scripted.stepDetail || scripted.title) : 'No scripted event for this day and turn.';
  const scriptedAlertClass = scripted?.alert ? ' scripted-alert' : '';
  const scriptedButtonClass = scripted?.alert ? 'primary warn' : 'primary';
  if (state.turnStep === 1) {
    if (preActionCount && !state.scriptedCheckedThisTurn) {
      return `<div class="prompt-title">1. Resolve start-turn prompts</div>
        <div class="prompt-detail">${preActionCount} start-turn prompt(s) must be resolved before rolling the Open Sea Event or selecting actions.</div>
        <div class="actions">
          <button class="primary" onclick="runScriptedStep()">Check Scripted Events</button>
        </div>`;
    }
    if (state.scriptedCheckedThisTurn) {
      return `<div class="prompt-title">1. Check scripted events or triggers</div>
        <div class="prompt-detail">${preActionCount ? `${preActionCount} scripted/start-turn prompt(s) remain. Resolve them before rolling the Open Sea Event.` : 'Scripted events and start-turn triggers are checked.'}</div>
        <div class="actions">
          <button onclick="runScriptedStep()">Check Again</button>
          <button class="primary" onclick="goToTurnStep(2)"${preActionCount ? ' disabled' : ''}>Roll Open Sea Event</button>
        </div>`;
    }
    return `<div class="${`scripted-check${scriptedAlertClass}`}">
      <div class="prompt-title">1. Check scripted events or triggers</div>
      ${scripted?.alert ? `<div class="scripted-banner">SCRIPTED ENCOUNTER: ${h(scripted.title)}</div>` : ''}
      <div class="prompt-detail">${scriptedText}</div>
      <div class="actions">
        <button class="${scriptedButtonClass}" onclick="runScriptedStep()">Check Scripted Events</button>
      </div>
    </div>`;
  }
  if (state.turnStep === 2) {
    return `<div class="prompt-title">2. Roll for Open Sea Event</div>
      <div class="prompt-detail">${preActionCount ? `${preActionCount} event check(s) must be resolved before actions can be selected.` : eventStatus}</div>
      <div class="actions">
        <button onclick="goToTurnStep(3)"${((!eventRequired || state.eventResolvedThisTurn) && !preActionCount) ? '' : ' disabled'}>Continue to Actions</button>
      </div>`;
  }
  if (state.turnStep === 3) {
    return `<div class="prompt-title">3. Set each character's action visibly</div>
      <div class="prompt-detail">${setActionsStepText(unconfirmedCount)}</div>
      <div class="actions">
        <button onclick="setUnsetActionsToIdle()">Set Unset to Idle</button>
        <button class="primary" onclick="confirmAllActions()"${confirmableCount ? '' : ' disabled'}>Confirm All Available</button>
        <button onclick="goToTurnStep(4)"${actionsStepComplete(unconfirmedCount) ? '' : ' disabled'}>Resolve Required Checks</button>
      </div>`;
  }
  if (state.turnStep === 5) {
    const advanceControls = state.isNightOvertime
      ? `<button class="primary" onclick="continueNightOvertime()"${state.waterUpdatedThisTurn && !waterPromptCount ? '' : ' disabled'}>Continue Night Overtime</button>
        <button class="good" onclick="endNightOvertimeAndRest()"${state.waterUpdatedThisTurn && !waterPromptCount ? '' : ' disabled'}>End Night Overtime and Rest</button>`
      : `<button class="primary" onclick="advanceTurn(true,true,false)"${state.waterUpdatedThisTurn && !waterPromptCount && !nightDecision ? '' : ' disabled'}>Advance Turn</button>`;
    return `<div class="prompt-title">5. Update Water and Advance</div>
      <div class="prompt-detail">${waterStatus} Review the water update preview in the Water panel.</div>
      <div class="actions">
        <button class="primary" onclick="endTurn()"${state.waterUpdatedThisTurn ? ' disabled' : ''}>Apply Water Formula</button>
        ${advanceControls}
      </div>`;
  }
  if (state.turnStep === 4) {
    return `<div class="prompt-title">4. Resolve required checks</div>
      <div class="prompt-detail">${actionCheckCount ? `${actionCheckCount} action check(s) remain. Resolve them before continuing unless you are intentionally overriding.` : 'No action checks remain.'}</div>
      <div class="actions">
        <button onclick="goToTurnStep(3)">Back to Actions</button>
        <button class="primary" onclick="goToTurnStep(5)"${actionCheckCount ? ' disabled' : ''}>Update Water</button>
      </div>`;
  }
  return `<div class="prompt-title">Turn Step</div>
    <div class="prompt-detail">Unknown turn step. Return to the current water/update step.</div>
    <div class="actions"><button class="primary" onclick="goToTurnStep(5)">Water / Advance</button></div>`;
}

function setActionsStepText(unconfirmedCount){
  const parts = [planReadyText()];
  if (unconfirmedCount) {
    parts.push(`${unconfirmedCount} planned action(s) still need confirmation. Labor changes, checks, and ongoing work are applied when you continue to the Checks step.`);
  } else if (allPlansReady()) {
    parts.push('All planned actions are confirmed. Continue to Checks to commit the action plan.');
  }
  return parts.join(' ');
}

function actionsStepComplete(unconfirmedCount){
  return allPlansReady() && unconfirmedCount === 0;
}

function planReadyText(){
  const missing = state.crew.filter(c => !state.plannedActions[c.name]).map(c => c.name);
  const warnings = groupWarnings();
  const parts = [];
  if (missing.length) parts.push(`Missing actions: ${missing.join(', ')}.`);
  if (warnings.length) parts.push(warnings.join(' '));
  if (!parts.length) parts.push('All characters have planned actions.');
  return parts.join(' ');
}

function allPlansReady(){
  const missing = state.crew.some(c => !state.plannedActions[c.name]);
  return !missing && groupWarnings().length === 0;
}

function goToTurnStep(step){
  pushUndo(`Moved to turn step ${step}`);
  const nextStep = Math.max(1, Math.min(turnSteps.length, Number(step)));
  if (state.turnStep === 3 && nextStep === 4 && !commitConfirmedActions()) {
    render();
    return;
  }
  if (state.turnStep === 4 && nextStep === 3 && state.actionsCommittedThisTurn) {
    rollbackActionCommit();
    return;
  }
  state.turnStep = nextStep;
  saveStateSnapshot();
  render();
}

function runScriptedStep(){
  syncFromInputs();
  pushUndo('Checked scripted events');
  addStartTurnTriggers();
  state.scriptedCheckedThisTurn = true;
  saveStateSnapshot();
  render();
}

function renderWaterEffect(){
  const wl = Number(state.waterLevel);
  let effect = 'Water in bilge only.';
  q('waterEffect').className = 'small';
  if (wl >= 20) {
    effect = 'The Marrowwind sinks.';
    q('waterEffect').className = 'small waterDanger';
  } else if (wl >= 15) {
    effect = `Neck deep. Each level above 15 adds ${Math.max(0, wl - 15)} day(s) to travel.`;
    q('waterEffect').className = 'small waterDanger';
  } else if (wl >= 10) {
    effect = 'Waist deep. Below-deck actions cost +1 Labor. Food and water begin to spoil.';
    q('waterEffect').className = 'small waterDanger';
  } else if (wl >= 5) {
    effect = 'Cargo hold flooding. Below-deck actions take +1 Turn.';
    q('waterEffect').className = 'small waterWarn';
  }
  q('waterEffect').textContent = effect;
}

function renderWaterLedger(){
  q('waterLedger').innerHTML = waterEquationMarkup();
}

function waterEquationValues(){
  const current = Number(state.waterLevel || 0);
  const ingress = totalIngress();
  const pumping = Number(state.turnLedger.pumping || 0);
  const buckets = Number(state.turnLedger.buckets || 0);
  const next = Math.max(0, current + ingress - pumping - buckets);
  return {current, ingress, pumping, buckets, next};
}

function waterEquationMarkup(){
  const values = waterEquationValues();
  return `<div class="water-equation-card">
    <div class="water-equation-title">Water Update Preview</div>
    <div class="water-equation-subtitle">This is what will happen when you apply the water formula.</div>
    <div class="water-equation">
      <span>${formatNumber(values.current)} current</span>
      <strong>+</strong>
      <span>${formatNumber(values.ingress)} ingress</span>
      <strong>-</strong>
      <span>${formatNumber(values.pumping)} pumping</span>
      <strong>-</strong>
      <span>${formatNumber(values.buckets)} buckets</span>
      <strong>=</strong>
      <span class="water-equation-result">${formatNumber(values.next)} after update</span>
    </div>
  </div>`;
}

function renderCrewAdjustOptions(){
  const select = q('crewAdjustSelect');
  if (!select) return;
  const previous = select.value;
  select.innerHTML = state.crew.map((character, index) =>
    `<option value="${index}">${h(character.name)}</option>`
  ).join('');
  if (previous && Number(previous) < state.crew.length) select.value = previous;
  updateCrewAdjustReadout();
}

function renderCrewSetup(){
  const box = q('crewSetup');
  if (!box) return;
  box.innerHTML = state.crew.map((character, index) => `<div class="crew-setup-row">
    <label>
      <span>Name</span>
      <input type="text" value="${h(character.name)}" onchange="renameCrewMember(${index}, this.value)" />
    </label>
    <label class="crew-background-toggle">
      <input type="checkbox" ${character.sailorPirateBackground ? ' checked' : ''} onchange="setCrewBackground(${index}, this.checked)" />
      <span>Sailor/Pirate background</span>
    </label>
  </div>`).join('');
}

function renderCrew(){
  const body = q('crewBody');
  body.innerHTML = '';
  state.crew.forEach((c, i) => {
    const status = characterStatus(c.name);
    const planned = state.plannedActions[c.name] || '';
    const locked = isAutoPlanned(c.name) || Boolean(state.confirmedActions[c.name]);
    const options = availableActionOptions(c.name).map(id => {
      const action = actionById(id);
      const selected = planned === id ? ' selected' : '';
      return `<option value="${id}"${selected}>${h(action.name)}</option>`;
    }).join('');
    const confirmed = state.confirmedActions[c.name] ? 'Confirmed' : 'Confirm';
    const confirmDisabled = canConfirmAction(c.name) ? '' : ' disabled';
    const groupHelp = groupHelpText(c.name);
    const tr = document.createElement('tr');
    tr.className = 'crewrow';
    tr.innerHTML = `<td>${h(c.name)}</td>
      <td>
        <select class="action-select" onchange="setPlannedAction(${i},this.value)"${locked ? ' disabled' : ''}>
          <option value="">Choose action...</option>
          ${options}
        </select>
        ${locked ? `<span class="pill warn">${state.confirmedActions[c.name] ? 'locked' : 'auto'}</span>` : ''}
        ${groupHelp ? `<div class="small">${h(groupHelp)}</div>` : ''}
      </td>
      <td>
        <div class="stat-stepper">
          <button onclick="crewChange(${i},'labor',-1)">-</button>
          <span>${c.labor}</span>
          <button onclick="crewChange(${i},'labor',1)">+</button>
        </div>
      </td>
      <td>
        <div class="stat-stepper">
          <button onclick="crewChange(${i},'exhaustion',-1)">-</button>
          <span>${c.exhaustion}</span>
          <button onclick="crewChange(${i},'exhaustion',1)">+</button>
        </div>
      </td>
      <td>${h(characterTurnsRemaining(c.name))}</td>
      <td>${h(status)}</td>
      <td>
        <div class="row-actions">
          <button class="primary" onclick="confirmCharacterActionByIndex(${i})"${confirmDisabled}>${confirmed}</button>
          <button onclick="clearCharacterActionByIndex(${i})">Clear</button>
        </div>
      </td>`;
    body.appendChild(tr);
  });
  renderPlanSummary();
}

function characterTurnsRemaining(name){
  const ongoing = state.ongoing.find(item => item.status === 'active' && item.actors.includes(name));
  if (ongoing) return String(Number(ongoing.remaining || 1));
  const action = actionById(state.plannedActions[name]);
  if (action) return String(actionDuration(action));
  return '-';
  return '—';
  if (!ongoing) return '—';
  return turnCountLabel(ongoing.remaining);
}

function characterDoneInStatus(name){
  const action = actionById(state.plannedActions[name]);
  if (action && belowDeckDurationPenalty(action) > 0) return 'flooded';
  return action || state.ongoing.some(item => item.status === 'active' && item.actors.includes(name)) ? 'normal' : '';
}

// Recomputed every render so impossible actions disappear as ship state changes.
function availableActionOptions(name){
  return actionOrder
    .filter(actionId => isActionDropdownAvailable(name, actionById(actionId)))
    .sort((leftId, rightId) => actionById(leftId).name.localeCompare(actionById(rightId).name));
}

// Availability checks are ordered from hard requirements to per-turn capacity limits.
function isActionDropdownAvailable(name, action){
  if (!action) return false;
  if (state.confirmedActions[name] === action.id) return true;
  if (isLockedGroupMember(action.id, name)) return true;
  if (actionRequirementProblem(action)) return false;
  if (wouldViolateOncePerTurn(name, action.id)) return false;
  if (wouldViolateGroupCapacity(name, action)) return false;
  return true;
}

// Prevent mutually exclusive or limited actions from being over-assigned in the same turn.
function wouldViolateOncePerTurn(name, actionId){
  if (actionId === 'helm') return selectedByOthers(name, ['helm']) > 0;
  if (actionId === 'pump') return selectedByOthers(name, ['pump','pumpCoop']) > 0;
  if (actionId === 'pumpCoop') return selectedByOthers(name, ['pump']) > 0 || selectedByOthers(name, ['pumpCoop']) >= 2;
  if (actionId === 'harpoon') return selectedByOthers(name, ['harpoon','assistHarpoon']) > 0;
  if (actionId === 'assistHarpoon') return selectedByOthers(name, ['harpoon']) > 0 || selectedByOthers(name, ['assistHarpoon']) >= 2;
  if (actionId === 'castNet') return selectedByOthers(name, ['castNet']) >= 2;
  if (actionId === 'recoverWreckage') return selectedByOthers(name, ['recoverWreckage']) > 0;
  return false;
}

// Capacity checks handle fixed-size teams and multiple leak-repair teams.
function wouldViolateGroupCapacity(name, action){
  if (action.id === 'repairLeak') {
    const maxRepairers = Number(state.activeLeaks || 0) * action.groupSize;
    return maxRepairers <= 0 || selectedByOthers(name, ['repairLeak']) >= maxRepairers;
  }
  if (action.groupSize && !action.allowMultipleGroups) {
    return selectedByOthers(name, [action.id]) >= action.groupSize;
  }
  return false;
}

function selectedByOthers(name, actionIds){
  return state.crew.filter(crew => crew.name !== name && actionIds.includes(state.plannedActions[crew.name])).length;
}

// If state changes make a pending choice illegal, remove it before rendering the dropdown.
function pruneUnavailablePlannedActions(){
  state.crew.forEach(character => {
    const actionId = state.plannedActions[character.name];
    if (!actionId) return;
    if (state.confirmedActions[character.name] === actionId) return;
    const action = actionById(actionId);
    if (!action || !isActionDropdownAvailable(character.name, action)) {
      delete state.plannedActions[character.name];
      delete state.confirmedActions[character.name];
    }
  });
}

function characterStatus(name){
  const ongoing = state.ongoing.find(o => o.actors.includes(name) && o.status === 'active');
  if (ongoing) {
    const action = actionById(ongoing.actionId);
    return `${action.name} (${turnCountLabel(ongoing.remaining)})`;
  }
  if (state.confirmedActions[name]) return 'Confirmed';
  return 'Active';
}

// A character can confirm only when requirements, group sizes, and per-turn limits are satisfied.
function canConfirmAction(name){
  const action = actionById(state.plannedActions[name]);
  if (!action) return false;
  if (state.confirmedActions[name]) return false;
  if (isLockedGroupMember(action.id, name)) return true;
  if (actionRequirementProblem(action)) return false;
  if (actionPlanProblemsFor(action.id).length) return false;
  if (action.groupSize && !groupIsReady(action.id)) return false;
  return true;
}

function groupHelpText(name){
  const action = actionById(state.plannedActions[name]);
  if (!action) return '';
  const requirementProblem = actionRequirementProblem(action);
  if (requirementProblem && !isLockedGroupMember(action.id, name)) return requirementProblem;
  const problems = actionPlanProblemsFor(action.id);
  if (problems.length) return problems.join(' ');
  if (!action.groupSize || groupIsReady(action.id)) return '';
  const selected = state.crew.filter(c => state.plannedActions[c.name] === action.id).length;
  return `${action.name} requires ${action.groupSize} players. ${selected}/${action.groupSize} selected.`;
}

// Summary is intentionally plain text so problems are readable while scanning the crew table.
function renderPlanSummary(){
  const lines = state.crew.map(c => {
    const id = state.plannedActions[c.name];
    const action = actionById(id);
    const confirmed = state.confirmedActions[c.name] ? ' confirmed' : '';
    return `${c.name}: ${action ? action.name : 'No action set'}${confirmed}`;
  });
  const groupLines = groupWarnings();
  q('planSummary').textContent = lines.concat(groupLines).join('\n');
}

function groupWarnings(){
  return [...new Set(actionPlanProblems().map(problem => problem.message))];
}

function actionPlanProblemsFor(actionId){
  return actionPlanProblems()
    .filter(problem => problem.actionIds.includes(actionId))
    .map(problem => problem.message);
}

// Collect all action-planning issues before the DM commits confirmations.
function actionPlanProblems(){
  const problems = [];
  addOncePerTurnProblems(problems);
  addGroupedActionProblems(problems);
  addRepairLeakProblems(problems);
  return problems;
}

function addPlanProblem(problems, actionIds, message){
  problems.push({actionIds, message});
}

function addOncePerTurnProblems(problems){
  if (selectedCount('helm') > 1) {
    addPlanProblem(problems, ['helm'], 'Man Helm can only be assigned once per turn.');
  }
  if (selectedCount('pump') > 1 || (selectedCount('pump') > 0 && selectedCount('pumpCoop') > 0)) {
    addPlanProblem(problems, ['pump','pumpCoop'], 'Only one bilge pump action can be assigned per turn: solo or cooperative.');
  }
  if (selectedCount('harpoon') > 1 || (selectedCount('harpoon') > 0 && selectedCount('assistHarpoon') > 0)) {
    addPlanProblem(problems, ['harpoon','assistHarpoon'], 'Only one harpoon fishing action can be assigned per turn: solo or assisted.');
  }
}

function addGroupedActionProblems(problems){
  actions.filter(action => action.groupSize && !action.allowMultipleGroups).forEach(action => {
    const count = selectedCount(action.id);
    if (count > 0 && count !== action.groupSize) {
      addPlanProblem(problems, [action.id], `${action.name} requires exactly ${action.groupSize} player${action.groupSize === 1 ? '' : 's'}. ${count}/${action.groupSize} selected.`);
    }
  });
}

function addRepairLeakProblems(problems){
  const count = selectedCount('repairLeak');
  if (!count) return;
  const activeLeaks = Number(state.activeLeaks || 0);
  if (activeLeaks <= 0) {
    addPlanProblem(problems, ['repairLeak'], 'Repair Active Leak cannot be assigned because there are no active leaks.');
    return;
  }
  if (count % 2 !== 0) {
    addPlanProblem(problems, ['repairLeak'], `Repair Active Leak requires 2 players per leak. ${count} selected.`);
  }
  const repairTeams = Math.floor(count / 2);
  if (repairTeams > activeLeaks) {
    addPlanProblem(problems, ['repairLeak'], `Only ${activeLeaks} active leak${activeLeaks === 1 ? '' : 's'} can be repaired this turn. Assign at most ${activeLeaks * 2} repair crew members.`);
  }
}

function renderActiveEffects(){
  const box = q('activeEffects');
  if (!box) return;
  box.innerHTML = '';
  const effects = activePlayEffects();
  if (!effects.length) {
    box.innerHTML = '<span class="pill good">No active effects changing action choices</span>';
    return;
  }
  effects.forEach(effect => {
    const row = document.createElement('div');
    row.className = `progress-row state-effect ${effect.className || ''}`;
    row.innerHTML = `<div class="prompt-title">${effect.title}</div>
      <div class="prompt-detail">${effect.detail}</div>`;
    box.appendChild(row);
  });
}

function activePlayEffects(){
  const effects = [];
  if (state.isNightOvertime) {
    effects.push({title:'Night Overtime', detail:'The crew is working through the night. Exhaustion risk is increasing.', className:'danger'});
  }
  const waterEffect = activeWaterEffect();
  if (waterEffect) effects.push(waterEffect);
  const scripted = scriptedEventForTurn();
  if (scripted?.activeDetail) {
    effects.push({title:scripted.title, detail:scripted.activeDetail, className:scripted.className || '', dmOnly:scripted.dmOnly !== false});
  }
  state.conditions
    .filter(condition => Number(condition.turns) > 0)
    .forEach(condition => effects.push(conditionEffect(condition)));
  if (state.riggingStatus === 'Broken') {
    effects.push({title:'Broken Rigging', detail:'At the start of each turn, a random top-deck creature may need a DC 13 Dexterity save.', className:'danger'});
  }
  if (state.pumpStatus === 'Jammed') {
    effects.push({title:'Bilge Pump Jammed', detail:'Bilge pump actions are unavailable until Repair Bilge Pump is completed.', className:'warn'});
  }
  if (state.netStatus === 'Tangled') {
    effects.push({title:'Fishing Net Tangled', detail:'Cast Fishing Net is unavailable until Reset Fishing Net is completed.', className:'warn'});
  }
  if (!canTravel()) {
    effects.push({title:'Travel Impaired', detail:'Mast or rudder is not functional. Helm and favorable winds cannot reduce travel normally.', className:'danger'});
  }
  return effects;
}

function activeWaterEffect(){
  const level = Number(state.waterLevel);
  if (level >= 20) return {title:'Sunk', detail:'The Marrowwind is sinking.', className:'danger'};
  if (level >= 15) return {title:'Neck-Deep Flooding', detail:`Below-deck actions take +1 Turn and +1 Labor. Travel penalty is currently ${state.waterTravelPenalty || 0} day(s), and decreases as water drops.`, className:'danger'};
  if (level >= 10) return {title:'Waist-Deep Flooding', detail:'Below-deck actions take +1 Turn and cost +1 Labor.', className:'warn'};
  if (level >= 5) return {title:'Cargo Hold Flooding', detail:'Below-deck actions take +1 Turn.', className:'warn'};
  return null;
}

function conditionEffect(condition){
  const turns = Number(condition.turns);
  const suffix = `${turns} turn${turns === 1 ? '' : 's'} remaining.`;
  const effects = {
    'Dense Fog': {title:'Dense Fog', detail:`Visibility is reduced to 30 feet. Helm checks, fishing checks, attempts to recover floating objects, and ranged attacks against targets not actively engaged in melee are made at disadvantage. Targets or objects farther than 30 feet away cannot be targeted normally unless revealed by sound, light, magic, or another clear cue. ${suffix}`, className:'warn'},
    'School of Fish': {title:'School of Fish', detail:`The next Cast Fishing Net action this turn has advantage. Harpoons gain no benefit. ${suffix}`, className:'good'},
    'Pack of Gulls': {title:'Pack of Gulls', detail:`Gulls are swarming the ship. Characters may spend their action joining the fight to scare them off for 0 Labor. If not dispatched in 3 rounds, reduce Food by 0.5 days.${fogPackOfGullsText()} ${suffix}`, className:'warn'},
    'Calm Seas': {title:'Calm Seas', detail:`The helmsman recovers 1 Labor instead of gaining 1 while steering this turn. ${suffix}`, className:'good'},
    'Floating Wreckage': {title:'Floating Wreckage', detail:`Wreckage can be recovered this turn with a 1-Labor action and DC 12 Dexterity or Athletics check.${fogFloatingWreckageText()} ${suffix}`, className:'warn'},
    'Large Shadow': {title:'Large Shadow', detail:`A massive shape is beneath the ship and can be targeted with the harpoon. ${suffix}`, className:'warn'},
    'Rainwater Collection': {title:'Rain and Flying Fish', detail:`Characters may spend their action collecting rainwater for 0 Labor. ${suffix}`, className:'good'}
  };
  return effects[condition.name] || {title:condition.name, detail:suffix, className:''};
}

// Shows only checks that belong to the current phase; unresolved prompts block advancement.
function renderPendingChecks(){
  const box = q('pendingChecks');
  box.innerHTML = '';
  const pending = pendingPromptsForCurrentStep();
  if (!pending.length) {
    box.innerHTML = '<span class="pill good">No pending checks</span>';
    return;
  }
  pending.forEach(prompt => {
    const card = document.createElement('div');
    card.className = `prompt-card ${prompt.type || 'manual'} ${prompt.emphasis || ''} ${promptRollClass(prompt)}`;
    const dcText = prompt.dc ? ` DC ${prompt.dc}` : '';
    const actorText = prompt.character ? `${prompt.character}: ` : '';
    const outcomeButtons = orderedPromptOutcomes(prompt.outcomes || []).map(outcome =>
      `<button class="${outcome.className || ''}" onclick="resolvePromptOutcome('${prompt.id}','${outcome.id}')">${outcome.label}</button>`
    ).join('');
    const defaultButtons = outcomeButtons || (prompt.type === 'manual'
      ? `<button onclick="resolvePrompt('${prompt.id}','manual')">Done</button>`
      : `<button class="good" onclick="resolvePrompt('${prompt.id}','success')">Success</button>
        <button onclick="resolvePrompt('${prompt.id}','manual')">Manual / Done</button>
        <button class="danger" onclick="resolvePrompt('${prompt.id}','failure')">Failure</button>`);
    card.innerHTML = `<div class="prompt-title">${actorText}${prompt.title}${dcText}</div>
      <div class="prompt-detail">${prompt.detail}</div>
      <div class="actions">
        ${defaultButtons}
      </div>`;
    box.appendChild(card);
  });
}

// Prompt card borders communicate advantage/disadvantage without changing the underlying rules.
function promptRollClass(prompt){
  const detail = String(prompt.detail || '').toLowerCase();
  if (detail.includes('disadvantage')) {
    if (detail.includes('canceled') || detail.includes('cancelled') || detail.includes('roll normally')) return '';
    return 'disadvantage';
  }
  if (detail.includes('advantage')) return 'advantage';
  return '';
}

// Keeps success-style outcomes left and failure-style outcomes right.
function orderedPromptOutcomes(outcomes){
  return [...outcomes].sort((left, right) => promptOutcomeRank(left) - promptOutcomeRank(right));
}

function promptOutcomeRank(outcome){
  const text = `${outcome.id || ''} ${outcome.label || ''} ${outcome.className || ''}`.toLowerCase();
  if (text.includes('fail') || text.includes('failure') || text.includes('no success') || text.includes('danger')) return 3;
  if (text.includes('success') || text.includes('recover') || text.includes('good')) return 1;
  return 2;
}

function renderConditions(){
  const div = q('conditions');
  div.innerHTML = '';
  if (!state.conditions.length) {
    div.innerHTML = '<span class="pill">None</span>';
    return;
  }
  state.conditions.forEach(c => {
    const span = document.createElement('span');
    span.className = 'pill';
    span.textContent = `${c.name} (${c.turns})`;
    div.appendChild(span);
  });
}

// Phase filtering is what lets pre-action, action, and water prompts appear at the right time.
function pendingPrompts(phase = null){
  return state.pendingChecks.filter(prompt => {
    if (prompt.status === 'resolved') return false;
    if (!phase) return true;
    return promptPhase(prompt) === phase;
  });
}

function pendingPromptCount(phase = null){
  return pendingPrompts(phase).length;
}

function promptPhase(prompt){
  return prompt.phase || 'action';
}

function pendingPromptsForCurrentStep(){
  if (state.turnStep === 1 || state.turnStep === 2) return pendingPrompts('preAction');
  if (state.turnStep === 4) return pendingPrompts('action');
  if (state.turnStep === 5) return pendingPrompts('water');
  return pendingPrompts();
}

function setPlannedAction(index, actionId){
  syncFromInputs();
  const name = state.crew[index].name;
  pushUndo(actionId ? `Planned ${name}'s action` : `Cleared ${name}'s planned action`);
  clearActionCommitSnapshot();
  state.actionsCommittedThisTurn = false;
  if (actionId) state.plannedActions[name] = actionId;
  else delete state.plannedActions[name];
  delete state.confirmedActions[name];
  const action = actionById(actionId);
  log(action ? `${name} is planning to ${action.name}.` : `${name}'s planned action was cleared.`);
  render();
}

function setUnsetActionsToIdle(){
  syncFromInputs();
  const unsetCrew = state.crew.filter(character => !state.plannedActions[character.name]);
  if (!unsetCrew.length) return;
  pushUndo('Set unset actions to Idle');
  unsetCrew.forEach(character => {
    state.plannedActions[character.name] = 'idle';
    delete state.confirmedActions[character.name];
  });
  log(`Set unset actions to Idle for ${unsetCrew.map(character => character.name).join(', ')}.`);
  render();
}

function clearCharacterAction(name){
  syncFromInputs();
  pushUndo(`Cleared ${name}'s planned action`);
  clearActionCommitSnapshot();
  state.actionsCommittedThisTurn = false;
  delete state.plannedActions[name];
  delete state.confirmedActions[name];
  log(`${name}'s planned action was cleared.`);
  render();
}

function confirmCharacterActionByIndex(index){
  const character = state.crew[index];
  if (character) confirmCharacterAction(character.name);
}

function clearCharacterActionByIndex(index){
  const character = state.crew[index];
  if (character) clearCharacterAction(character.name);
}

function renameCrewMember(index, rawName){
  syncFromInputs();
  const character = state.crew[index];
  if (!character) return;
  const oldName = character.name;
  const newName = String(rawName || '').trim();
  if (!newName || newName === oldName) {
    render();
    return;
  }
  if (state.crew.some((crewMember, crewIndex) => crewIndex !== index && crewMember.name === newName)) {
    alert(`Crew name "${newName}" is already in use.`);
    render();
    return;
  }
  pushUndo(`Renamed ${oldName}`);
  remapCrewName(oldName, newName);
  character.name = newName;
  log(`Crew setup: ${oldName} was renamed to ${newName}.`);
  saveStateSnapshot();
  render();
}

function setCrewBackground(index, hasBackground){
  const character = state.crew[index];
  if (!character) return;
  pushUndo(`Changed ${character.name}'s background`);
  character.sailorPirateBackground = Boolean(hasBackground);
  log(`Crew setup: ${character.name} ${character.sailorPirateBackground ? 'has' : 'does not have'} a sailor/pirate background.`);
  saveStateSnapshot();
  render();
}

function remapCrewName(oldName, newName){
  remapObjectKey(state.plannedActions, oldName, newName);
  remapObjectKey(state.confirmedActions, oldName, newName);
  remapObjectKey(state.overtimeExhaustion, oldName, newName);
  state.ongoing.forEach(item => { item.actors = remapNameList(item.actors, oldName, newName); });
  state.deferredCompletions.forEach(item => { item.actors = remapNameList(item.actors, oldName, newName); });
  Object.keys(state.startedGroups || {}).forEach(actionId => {
    state.startedGroups[actionId] = remapNameList(state.startedGroups[actionId], oldName, newName);
  });
  state.pendingChecks.forEach(prompt => {
    if (prompt.character === oldName) prompt.character = newName;
  });
}

function remapObjectKey(object, oldName, newName){
  if (!object || !Object.prototype.hasOwnProperty.call(object, oldName)) return;
  object[newName] = object[oldName];
  delete object[oldName];
}

function remapNameList(names, oldName, newName){
  return (names || []).map(name => name === oldName ? newName : name);
}

function confirmAllActions(){
  syncFromInputs();
  pushUndo('Confirmed available actions');
  state.crew.forEach(c => {
    if (canConfirmAction(c.name)) confirmCharacterAction(c.name, false, false);
  });
  render();
}

// Confirming marks player intent only. Labor, checks, and action starts commit when leaving Set Actions.
function confirmCharacterAction(name, shouldRender = true, shouldSync = true){
  if (shouldSync) syncFromInputs();
  if (state.confirmedActions[name]) {
    if (shouldRender) render();
    return;
  }
  const id = state.plannedActions[name];
  const action = actionById(id);
  const character = crewByName(name);
  if (!action || !character) return;
  if (shouldRender) pushUndo(`Confirmed ${name}'s action`);
  if (!action.allowMultipleGroups && groupAlreadyStarted(action.id) && !isLockedGroupMember(action.id, name)) {
    addPrompt({type:'manual', character:name, title:`Cannot Confirm ${action.name}`, detail:'This grouped action has already started with a different selected group.', effect:'manual'});
    log(`${name} could not confirm ${action.name} because another group has already started that action.`);
    if (shouldRender) render();
    return;
  }
  const requirementProblem = actionRequirementProblem(action);
  const planProblems = isLockedGroupMember(action.id, name) ? [] : actionPlanProblemsFor(action.id);
  if (planProblems.length) {
    addPrompt({type:'manual', character:name, title:`Cannot Confirm ${action.name}`, detail:planProblems.join(' '), effect:'manual'});
    log(`${name} could not confirm ${action.name}. ${planProblems.join(' ')}`);
    if (shouldRender) render();
    return;
  }
  if (requirementProblem) {
    addPrompt({type:'manual', character:name, title:`Cannot Confirm ${action.name}`, detail:requirementProblem, effect:'manual'});
    log(`${name} could not confirm ${action.name}. ${requirementProblem}`);
    if (shouldRender) render();
    return;
  }
  if (action.groupSize && !groupIsReady(action.id)) {
    addPrompt({type:'manual', character:name, title:`Waiting on ${action.name}`, detail:`This action requires ${action.groupSize} players. Select the required participants, then confirm them.`, effect:'manual'});
    log(`${name} selected ${action.name}; waiting for ${action.groupSize} total participants.`);
    if (shouldRender) render();
    return;
  }
  state.confirmedActions[name] = action.id;
  log(`${name} confirmed intent to ${action.name}.`);
  if (shouldRender) render();
}

function commitConfirmedActions(){
  const unconfirmedCount = state.crew.filter(c => state.plannedActions[c.name] && !state.confirmedActions[c.name]).length;
  if (!actionsStepComplete(unconfirmedCount)) return false;
  if (state.actionsCommittedThisTurn) return true;
  storeActionCommitSnapshot(state);
  state.crew.forEach(character => {
    const action = actionById(state.confirmedActions[character.name]);
    if (action) commitConfirmedAction(character, action);
  });
  state.actionsCommittedThisTurn = true;
  log('Committed the confirmed action plan and created required checks.');
  return true;
}

function commitConfirmedAction(character, action){
  const continuing = state.ongoing.find(o => o.status === 'active' && o.actionId === action.id && o.actors.includes(character.name));
  const isLaterTurn = continuing && (continuing.createdDay !== state.day || continuing.createdTurn !== state.turn);
  if (continuing && isLaterTurn) {
    character.lastAction = action.name;
    if (continuing.remaining <= 0) completeOngoing(continuing.id, false);
    else log(`${character.name} continued ${action.name}.`);
    return;
  }
  applyActionStart(character, action);
}

function rollbackActionCommit(){
  const snapshot = readActionCommitSnapshot();
  if (!snapshot) {
    state.turnStep = 3;
    log('Returned to Set Actions, but no action rollback snapshot was available.');
    saveStateSnapshot();
    render();
    return;
  }
  state = structuredClone(snapshot);
  state.turnStep = 3;
  state.actionsCommittedThisTurn = false;
  log('Returned to Set Actions and removed unadvanced action effects.');
  clearActionCommitSnapshot();
  saveStateSnapshot();
  render();
}

function groupIsReady(actionId){
  const action = actionById(actionId);
  if (!action.groupSize) return true;
  const count = selectedCount(actionId);
  if (action.allowMultipleGroups) {
    return count >= action.groupSize && count % action.groupSize === 0;
  }
  return count === action.groupSize;
}

// Starts a single action after validation. Multi-turn and deferred work branch here.
function applyActionStart(character, action){
  const before = Number(character.labor);
  const laborChange = actionLaborCost(action);
  character.labor = Math.max(0, before + laborChange);
  character.lastAction = action.name;
  const isSharedRun = action.sharedStart || action.groupSize || boostActive(action);
  const alreadyStarted = groupAlreadyStarted(action.id);
  const actors = actionActors(character.name, action);
  const completionActors = action.allowMultipleGroups ? confirmedActionActors(action.id, character.name) : actors;
  const allActorsConfirmed = actors.every(name => name === character.name || state.confirmedActions[name] === action.id);
  if (isSharedRun && !alreadyStarted && !action.allowMultipleGroups) lockStartedGroup(action);
  if (action.start && (!isSharedRun || (!hasActiveOngoingForAction(action.id) && !alreadyStarted))) action.start(state, character);
  const duration = actionDuration(action);
  log(`${character.name} confirmed ${action.name}. Labor changed from ${before} to ${character.labor}.`);
  maybeAddLaborSave(character, before);
  maybeAddActionPrompt(character, action);
  const canCompleteNow = action.completeAfterAllConfirmed ? allActorsConfirmed : (!isSharedRun || !alreadyStarted);
  if (duration > 1) createOngoing(character.name, action, duration - 1);
  else if (action.deferComplete && (!isSharedRun || !alreadyStarted || action.allowMultipleGroups)) {
    deferActionCompletion(action, completionActors);
  }
  else if ((action.completeOnConfirm || (!action.check && !action.completeChoice)) && canCompleteNow) {
    completeAction(action, actors);
  }
}

function confirmedActionActors(actionId, currentName){
  return state.crew
    .filter(character => state.plannedActions[character.name] === actionId)
    .filter(character => character.name === currentName || state.confirmedActions[character.name] === actionId)
    .map(character => character.name);
}

// Deferred completions resolve during the water/end-turn phase, not immediately on confirmation.
function deferActionCompletion(action, actors){
  if (!state.deferredCompletions) state.deferredCompletions = [];
  const alreadyQueued = state.deferredCompletions.find(item =>
    item.actionId === action.id &&
    item.createdDay === state.day &&
    item.createdTurn === state.turn &&
    item.status === 'pending'
  );
  if (alreadyQueued) {
    alreadyQueued.actors = [...new Set([...alreadyQueued.actors, ...actors])];
    return;
  }
  state.deferredCompletions.push({
    id: safeId(),
    actionId: action.id,
    actors,
    createdDay: state.day,
    createdTurn: state.turn,
    status: 'pending'
  });
  log(`${action.name} will finish at the end of the turn for ${actors.join(', ')}.`);
}

function createOngoing(name, action, remaining){
  if (state.ongoing.some(o => o.status === 'active' && o.actionId === action.id && o.actors.includes(name))) return;
  const actors = actionActors(name, action);
  state.ongoing.push({id:safeId(), actionId:action.id, actors, remaining, status:'active', createdDay:state.day, createdTurn:state.turn});
  log(`${actors.join(', ')} started ${action.name}; ${remaining} turn${remaining === 1 ? '' : 's'} remaining.`);
}

function completeOngoing(id, shouldRender = true){
  if (shouldRender) syncFromInputs();
  const ongoing = state.ongoing.find(o => o.id === id);
  if (!ongoing || ongoing.status !== 'active') return;
  const action = actionById(ongoing.actionId);
  completeAction(action, ongoing.actors);
  ongoing.status = 'resolved';
  ongoing.remaining = 0;
  ongoing.actors.forEach(name => delete state.plannedActions[name]);
  log(`${ongoing.actors.join(', ')} completed ${action.name}.`);
  if (shouldRender) render();
}

function interruptSelectedWork(){
  syncFromInputs();
  state.ongoing.filter(o => o.status === 'active').forEach(o => {
    const shouldCancel = o.actors.some(name => state.plannedActions[name] && state.plannedActions[name] !== o.actionId);
    if (shouldCancel) {
      o.status = 'cancelled';
      log(`Interrupted ${actionById(o.actionId).name} for ${o.actors.join(', ')}.`);
    }
  });
  render();
}

// Completion applies action effects, resource costs, and player knowledge reveals.
function completeAction(action, actors){
  if (action.completeChoice === 'rest') {
    actors.forEach(name => addPrompt({
      phase:'preAction',
      type:'manual',
      character:name,
      title:'Complete Rest',
      detail:'Choose the rest benefit for this character before they select an action this turn.',
      effect:'restChoice',
      outcomes:[
        {id:'recoverLabor', label:'Recover 2 Labor', className:'good'},
        {id:'recoverExhaustion', label:'Recover 1 Exhaustion', className:'good'}
      ]
    }));
    return;
  }
  if (action.manual) {
    if (action.reveals?.length) {
      action.reveals.forEach(key => rememberPlayerKnowledge(key));
      log(`${actors.join(', ')} completed ${action.name}. Players learned the current ${action.reveals.map(fieldLabel).join(', ')}.`);
    } else {
      log(`${actors.join(', ')} completed ${action.name}. ${action.manual}`);
    }
  }
  if (action.complete) action.complete(state, actors);
  spendRepairMaterialsFor(action, actors);
}

function spendRepairMaterialsFor(action, actors){
  const cost = Number(valueOfRepairCost(action.repairCost, actors));
  if (!cost) return;
  const before = Number(state.repairMaterials || 0);
  state.repairMaterials = Math.max(0, before - cost);
  log(`${action.name} used ${cost} repair material${cost === 1 ? '' : 's'}. Repair supplies changed from ${before} to ${state.repairMaterials}.`);
  if (before < cost) {
    addPrompt({type:'manual', title:'Repair Materials Shortfall', detail:`${action.name} needed ${cost} Repair Material(s), but only ${before} were available. Apply manual override if needed.`, effect:'manual'});
  }
}

function valueOfRepairCost(cost, actors){
  if (typeof cost === 'function') return cost(state, actors);
  return cost || 0;
}

// Adds only checks that actually need adjudication; automatic/manual "done" work is logged.
function maybeAddActionPrompt(character, action){
  const name = character.name;
  if (action.check === 'helm') {
    if (!canTravel()) {
      addPrompt({type:'manual', character:name, title:'Helm Cannot Reduce Travel', detail:'Mast or rudder is broken, so helm cannot reduce travel unless manually overridden.', effect:'manual'});
      return;
    }
    const advantage = hasSailorPirateBackground(name) ? ' This character rolls with advantage from sailor/pirate background.' : '';
    addPrompt({type:'check', character:name, title:'Helm Check', detail:`Survival DC 12 to reduce Travel Remaining by 0.25 days.${advantage}${fogHelmText(name)}`, dc:12, effect:'helmSuccess'});
  }
  if (action.check === 'bilgeRod') {
    addPrompt({
      type:'check',
      character:name,
      title:'Bilge Sounding Rod',
      detail:'Investigation DC 15. Any reading gives the current Water Level. If the players know Water Level for two turns in a row, Total Water Ingress becomes known.',
      dc:15,
      ability:'Investigation',
      effect:'bilgeRod',
      failureReveals:['waterLevel'],
      successReveals:['waterLevel']
    });
  }
  if (action.check === 'pumpSolo') {
    addPrompt({type:'check', character:name, title:'Operate Bilge Pump', detail:'Strength DC 15. Success reduces Water Level by 3; failure reduces Water Level by 2.', dc:15, effect:'pumpSolo', outcomes:[
      {id:'pumpTwo', label:'Fail: Water -2', className:'danger'},
      {id:'pumpThree', label:'Success: Water -3', className:'good'}
    ]});
  }
  if (action.check === 'pumpCoop' && firstConfirmedForGroup(name, action.id)) {
    addPrompt({type:'check', title:'Operate Bilge Pump (Cooperative)', detail:'Both players roll Strength DC 15. Only one success is required. Success reduces Water Level by 4; failure reduces Water Level by 3.', dc:15, effect:'pumpCoop', outcomes:[
      {id:'pumpThree', label:'No Successes: Water -3', className:'danger'},
      {id:'pumpFour', label:'At Least 1 Success: Water -4', className:'good'}
    ]});
  }
  if (action.check === 'recoverWreckage') {
    addPrompt({type:'check', character:name, title:'Recover Floating Wreckage', detail:`Dexterity or Athletics DC 12. Success gains 1 Salvaged Timber.${fogFloatingWreckageText()}`, dc:12, effect:'wreckageSuccess'});
  }
  if (action.id === 'repairRigging') {
    addPrompt({
      type:'save',
      character:name,
      title:'Repairing Snapped Rigging',
      detail:`${name} is repairing the snapped rigging. Dexterity save DC 13 or take 2d6 bludgeoning damage.`,
      dc:13,
      ability:'DEX',
      effect:'damageNote'
    });
  }
  if (action.check === 'castNet' && firstConfirmedForGroup(name, action.id)) {
    const hasFishAdvantage = hasCondition('School of Fish');
    const advantage = hasFishAdvantage ? ' School of Fish grants advantage to this Cast Net action.' : '';
    addPrompt({type:'check', title:'Cast Fishing Net', detail:`Both players roll Survival DC 15. Each success grants +0.25 days rations.${advantage}${fogFishingText(hasFishAdvantage)}`, dc:15, effect:'castNetSuccess', outcomes:[
      {id:'fail', label:'0 Successes', className:'danger'},
      {id:'foodQuarter', label:'1 Success: +0.25 Food', className:'good'},
      {id:'foodHalf', label:'2 Successes: +0.5 Food', className:'good'}
    ]});
  }
  if (action.check === 'harpoon') {
    const hasShadowAdvantage = hasCondition('Large Shadow');
    const advantage = hasShadowAdvantage ? ' Large Shadow grants advantage to this Harpoon Fishing check.' : '';
    addPrompt({type:'check', character:name, title:'Harpoon Fishing', detail:`Survival check. DC 18: +0.5 Food. DC 20: +1 Food.${advantage}${fogFishingText(hasShadowAdvantage)}`, effect:'harpoon', outcomes:[
      {id:'fail', label:'Fail', className:'danger'},
      {id:'foodHalf', label:'+0.5 Food', className:'good'},
      {id:'foodOne', label:'+1 Food', className:'good'}
    ]});
  }
  if (action.check === 'assistHarpoon' && firstConfirmedForGroup(name, action.id)) {
    const hasShadowAdvantage = hasCondition('Large Shadow');
    const advantage = hasShadowAdvantage ? ' Large Shadow grants advantage to this Harpoon Fishing check.' : '';
    addPrompt({type:'check', title:'Harpoon Fishing (Cooperative)', detail:`Both players roll Survival; only the higher roll counts. DC 15: +0.5 Food. DC 18: +1 Food. DC 20: +2 Food.${advantage}${fogFishingText(hasShadowAdvantage)}`, effect:'assistHarpoon', outcomes:[
      {id:'fail', label:'Fail', className:'danger'},
      {id:'foodHalf', label:'+0.5 Food', className:'good'},
      {id:'foodOne', label:'+1 Food', className:'good'},
      {id:'foodTwo', label:'+2 Food', className:'good'}
    ]});
  }
}

function firstConfirmedForGroup(name, actionId){
  const names = state.crew.filter(c => state.plannedActions[c.name] === actionId).map(c => c.name);
  return names[0] === name;
}

function maybeAddLaborSave(character, before){
  const after = Number(character.labor);
  if (after < 4 || after <= before) return;
  const dc = laborSaveDC(after);
  addPrompt({type:'save', character:character.name, title:'Labor Overexertion', detail:`Labor reached ${after}. On failure, add 1 Exhaustion. The task still completes.`, dc, effect:'laborExhaustion'});
}

function laborSaveDC(laborAfter){
  if (laborAfter < 4) return null;
  return Math.min(20, 10 + (laborAfter - 3) * 2);
}

// Hard requirements are checked before group-size warnings so the DM sees root-cause failures first.
function actionRequirementProblem(action){
  if (action.id === 'rest' && state.isNightOvertime) return 'Recover is not normally available during Night Overtime.';
  if (action.groupSize && groupAlreadyStarted(action.id)) return '';
  if (action.requirement === 'pumpWorking' && state.pumpStatus !== 'Working') return 'Bilge Pump is jammed.';
  if (action.requirement === 'pumpJammed' && state.pumpStatus !== 'Jammed') return 'Bilge Pump is not jammed.';
  if (action.requirement === 'netReady' && state.netStatus !== 'Ready') return 'Net is tangled.';
  if (action.requirement === 'netTangled' && state.netStatus !== 'Tangled') return 'Fishing net does not need to be reset.';
  if (action.requirement === 'activeLeaks' && Number(state.activeLeaks || 0) <= 0) return 'There are no active leaks to repair.';
  if (action.requirement === 'rainwaterAvailable' && !hasCondition('Rainwater Collection')) return 'Rainwater collection is only available after the natural 20 open sea event.';
  if (action.requirement === 'gullsPresent' && !hasCondition('Pack of Gulls')) return 'There is no active Pack of Gulls encounter.';
  if (action.requirement === 'wreckageAvailable' && !hasCondition('Floating Wreckage')) return 'There is no floating wreckage to recover.';
  if (action.requirement === 'timberAvailable' && Number(state.salvagedTimber) <= 0) return 'No salvaged timber is available.';
  if (action.requirement === 'riggingBroken' && state.riggingStatus !== 'Broken') return 'Rigging is not snapped.';
  if (action.requirement === 'mastBroken' && state.mastStatus !== 'Broken') return 'Mast is not broken.';
  if (action.requirement === 'rudderBroken' && state.rudderStatus !== 'Broken') return 'Rudder is not broken.';
  return '';
}

// Started groups are locked so the second member of a two-person action can still confirm after the first.
function groupAlreadyStarted(actionId){
  return Boolean(state.startedGroups?.[actionId]);
}

function lockStartedGroup(action){
  if (!state.startedGroups) state.startedGroups = {};
  state.startedGroups[action.id] = actionActors('', action);
}

function isLockedGroupMember(actionId, name){
  return Boolean(state.startedGroups?.[actionId]?.includes(name));
}

// Manual reminders that only say "Done" are converted to log entries so they do not slow phase advancement.
function addPrompt(prompt){
  if (isDoneOnlyManualPrompt(prompt)) {
    log(`${prompt.title}: ${prompt.detail}`);
    return;
  }
  state.pendingChecks.push({
    id: prompt.id || safeId(),
    phase: prompt.phase || 'action',
    type: prompt.type || 'manual',
    character: prompt.character || '',
    title: prompt.title,
    detail: prompt.detail,
    dc: prompt.dc || null,
    ability: prompt.ability || '',
    effect: prompt.effect || 'manual',
    outcomes: prompt.outcomes || null,
    reveals: prompt.reveals || null,
    successReveals: prompt.successReveals || null,
    failureReveals: prompt.failureReveals || null,
    emphasis: prompt.emphasis || '',
    status: 'pending'
  });
}

function isDoneOnlyManualPrompt(prompt){
  return (prompt.type || 'manual') === 'manual' &&
    !prompt.blocking &&
    !(prompt.outcomes || []).length;
}

// Generic prompt resolution handles pass/fail/manual buttons.
function resolvePrompt(id, result){
  syncFromInputs();
  const prompt = state.pendingChecks.find(p => p.id === id);
  if (!prompt || prompt.status === 'resolved') return;
  pushUndo(`Resolved ${prompt.title}`);
  applyPromptEffect(prompt, result);
  applyPromptReveals(prompt, result);
  prompt.status = 'resolved';
  log(`${prompt.character ? `${prompt.character}'s ` : ''}${prompt.title} was resolved as ${result}.`);
  saveStateSnapshot();
  render();
}

// Outcome prompts directly apply common resource results without requiring extra manual steps.
function resolvePromptOutcome(id, outcomeId){
  const result = ['fail'].includes(outcomeId) ? 'failure' : 'success';
  const prompt = state.pendingChecks.find(p => p.id === id);
  if (!prompt) return;
  pushUndo(`Resolved ${prompt.title}`);
  if (outcomeId === 'recoverLabor') applyRestChoice(prompt.character, 'labor');
  if (outcomeId === 'recoverExhaustion') applyRestChoice(prompt.character, 'exhaustion');
  if (outcomeId === 'pumpTwo') state.turnLedger.pumping += 2;
  if (outcomeId === 'pumpThree') state.turnLedger.pumping += 3;
  if (outcomeId === 'pumpFour') state.turnLedger.pumping += 4;
  if (outcomeId === 'foodQuarter') state.food += 0.25;
  if (outcomeId === 'foodHalf') state.food += 0.5;
  if (outcomeId === 'foodOne') state.food += 1;
  if (outcomeId === 'foodTwo') state.food += 2;
  applyPromptReveals(prompt, result);
  prompt.status = 'resolved';
  log(`${prompt.character ? `${prompt.character}'s ` : ''}${prompt.title} outcome was ${humanOutcome(outcomeId)}.`);
  saveStateSnapshot();
  render();
}

function applyPromptReveals(prompt, result){
  const reveals = [
    ...(prompt.reveals || []),
    ...(result === 'success' ? (prompt.successReveals || []) : []),
    ...(result === 'failure' ? (prompt.failureReveals || []) : [])
  ];
  [...new Set(reveals)].forEach(key => rememberPlayerKnowledge(key));
}

// Player knowledge is snapshot-based: players keep seeing the last value they successfully learned.
function rememberPlayerKnowledge(key){
  if (!state.playerKnowledge) state.playerKnowledge = structuredClone(defaultState.playerKnowledge);
  const value = key === 'totalIngress' ? totalIngress() : Number(state[key]);
  state.playerKnowledge[key] = value;
  if (key === 'waterLevel') markWaterKnownForCurrentTurn('water level was revealed');
  log(`Players learned the current ${fieldLabel(key)}: ${formatNumber(value)}.`);
}

function currentTurnKey(){
  return `${Number(state.day || 0)}-${Number(state.turn || 0)}`;
}

function parseTurnKey(key){
  const [day, turn] = String(key || '').split('-').map(Number);
  return {day, turn};
}

function isConsecutiveTurn(previousKey, currentKey){
  if (!previousKey || !currentKey) return false;
  const previous = parseTurnKey(previousKey);
  const current = parseTurnKey(currentKey);
  if (!Number.isFinite(previous.day) || !Number.isFinite(previous.turn) || !Number.isFinite(current.day) || !Number.isFinite(current.turn)) return false;
  if (current.day === previous.day) return current.turn === previous.turn + 1;
  return current.day === previous.day + 1 && current.turn === 1 && previous.turn >= nighttimeTurnForDay(previous.day);
}

function ensureWaterKnowledgeTurn(){
  if (!state.waterKnowledge) state.waterKnowledge = structuredClone(defaultState.waterKnowledge);
  const key = currentTurnKey();
  if (state.waterKnowledge.turnKey === key) return;
  state.waterKnowledge.turnKey = key;
  state.waterKnowledge.knownThisTurn = false;
  hideTotalIngressKnowledge();
}

function initializeWaterKnowledgeForCurrentTurn(){
  ensureWaterKnowledgeTurn();
  if (Number(state.waterLevel) >= 5) markWaterKnownForCurrentTurn('water is visibly in the cargo hold');
}

function finalizeWaterKnowledgeForCurrentTurn(){
  initializeWaterKnowledgeForCurrentTurn();
  if (state.waterKnowledge.knownThisTurn) return;
  state.waterKnowledge.streak = 0;
  state.waterKnowledge.lastKnownTurnKey = '';
  hideTotalIngressKnowledge();
}

function markWaterKnownForCurrentTurn(reason){
  if (!state.playerKnowledge) state.playerKnowledge = structuredClone(defaultState.playerKnowledge);
  ensureWaterKnowledgeTurn();
  if (state.waterKnowledge.knownThisTurn) return;
  const key = currentTurnKey();
  const streak = isConsecutiveTurn(state.waterKnowledge.lastKnownTurnKey, key)
    ? Number(state.waterKnowledge.streak || 0) + 1
    : 1;
  state.waterKnowledge.knownThisTurn = true;
  state.waterKnowledge.lastKnownTurnKey = key;
  state.waterKnowledge.streak = streak;
  if (streak >= 2) {
    const value = totalIngress();
    const before = state.playerKnowledge.totalIngress;
    state.playerKnowledge.totalIngress = value;
    if (before !== value) log(`Players inferred Total Water Ingress (${formatNumber(value)}) because ${reason} for two turns in a row.`);
  } else {
    hideTotalIngressKnowledge();
  }
}

function hideTotalIngressKnowledge(){
  if (!state.playerKnowledge) state.playerKnowledge = structuredClone(defaultState.playerKnowledge);
  state.playerKnowledge.totalIngress = null;
}

// Prompt effects are intentionally narrow; larger action effects belong in completeAction().
function applyPromptEffect(prompt, result){
  if (result === 'manual') return;
  if (prompt.effect === 'laborExhaustion' && result === 'failure') {
    const character = crewByName(prompt.character);
    if (character) character.exhaustion += 1;
  }
  if (prompt.effect === 'helmSuccess' && result === 'success') state.travel = Math.max(0, Number(state.travel) - 0.25);
  if (prompt.effect === 'wreckageSuccess' && result === 'success') state.salvagedTimber += 1;
  if (prompt.effect === 'castNetSuccess' && result === 'success') state.food += 0.5;
  if (prompt.effect === 'mealExhaustion' && result === 'failure') {
    const character = crewByName(prompt.character);
    if (character) character.exhaustion += 1;
  }
  if (prompt.effect === 'overtimeExhaustion' && result === 'failure') {
    const character = crewByName(prompt.character);
    if (character) {
      character.exhaustion += 1;
      state.overtimeExhaustion[character.name] = Number(state.overtimeExhaustion[character.name] || 0) + 1;
      log(`${character.name} gained 1 overtime Exhaustion.`);
    }
  }
}

function applyRestChoice(name, choice){
  const character = crewByName(name);
  if (!character) return;
  if (choice === 'labor') character.labor = Math.max(0, Number(character.labor) - 2);
  if (choice === 'exhaustion') character.exhaustion = Math.max(0, Number(character.exhaustion) - 1);
}

function addManualPrompt(){
  syncFromInputs();
  const title = prompt('Prompt title?', 'Manual Check');
  if (!title) return;
  const detail = prompt('Prompt detail?', 'Resolve manually.');
  pushUndo('Added manual prompt');
  addPrompt({type:'manual', title, detail:detail || 'Resolve manually.', effect:'manual', blocking:true});
  render();
}

function clearResolvedPrompts(){
  pushUndo('Cleared resolved prompts');
  state.pendingChecks = state.pendingChecks.filter(p => p.status !== 'resolved');
  render();
}

function change(id, amount){
  syncFromInputs();
  pushUndo(`Changed ${fieldLabel(id)}`);
  const before = Number(state[id] || 0);
  state[id] = Math.max(0, Number(state[id]) + amount);
  if (id === 'waterLevel') updateWaterTravelPenalty();
  log(`Manual override: ${fieldLabel(id)} changed from ${formatNumber(before)} to ${formatNumber(state[id])}.`);
  render();
}

function crewChange(index, field, amount){
  const character = state.crew[index];
  pushUndo(`Changed ${character.name}'s ${fieldLabel(field)}`);
  const before = Number(character[field] || 0);
  state.crew[index][field] = Math.max(0, Number(state.crew[index][field]) + amount);
  log(`Manual override: ${character.name}'s ${fieldLabel(field)} changed from ${formatNumber(before)} to ${formatNumber(character[field])}.`);
  render();
}

function quickCrewChange(field, amount){
  const index = Number(q('crewAdjustSelect')?.value);
  const character = state.crew[index];
  if (!character) return;
  pushUndo(`Changed ${character.name}'s ${fieldLabel(field)}`);
  const before = Number(character[field] || 0);
  character[field] = Math.max(0, before + Number(amount));
  log(`Manual override: ${character.name}'s ${fieldLabel(field)} changed from ${formatNumber(before)} to ${formatNumber(character[field])}.`);
  render();
}

function updateCrewAdjustReadout(){
  const index = Number(q('crewAdjustSelect')?.value);
  const character = state.crew[index];
  const labor = q('crewAdjustLabor');
  const exhaustion = q('crewAdjustExhaustion');
  if (!character || !labor || !exhaustion) return;
  labor.textContent = formatNumber(character.labor);
  exhaustion.textContent = formatNumber(character.exhaustion);
}

// End-of-turn water update resolves deferred action effects before advancing to the next turn.
function endTurn(){
  syncFromInputs();
  if (state.waterUpdatedThisTurn) {
    goToTurnStep(5);
    return;
  }
  pushUndo('Applied water update');
  tickOngoing();
  const before = Number(state.waterLevel);
  const ingress = totalIngress();
  const pumping = Number(state.turnLedger.pumping || 0);
  const buckets = Number(state.turnLedger.buckets || 0);
  const after = Math.max(0, before + ingress - pumping - buckets);
  state.waterLevel = after;
  updateWaterTravelPenalty();
  log(`Water was updated: ${before} + ${ingress} ingress - ${pumping} pumping - ${buckets} buckets = ${after}.`);
  completeDeferredActions();
  addWaterThresholdPrompts(before, after);
  addNightOvertimePrompts();
  state.turnLedger = {pumping: 0, buckets: 0};
  state.waterUpdatedThisTurn = true;
  state.turnStep = 5;
  saveStateSnapshot();
  render();
}

// Threshold prompts explain newly-entered danger bands without requiring extra success/failure clicks.
function addWaterThresholdPrompts(before, after){
  [5, 10, 15, 20].forEach(level => {
    if (before < level && after >= level) {
      const text = level === 5 ? 'Below-deck actions take +1 Turn.'
        : level === 10 ? 'Below-deck actions cost +1 additional Labor. Food and water begin to spoil.'
        : level === 15 ? 'Each additional level above 15 adds 1 day to Travel Time.'
        : 'The Marrowwind sinks.';
      addPrompt({phase:'water', type:'manual', title:`Water Level ${level}+`, detail:text, effect:'manual'});
    }
  });
}

// Neck-deep water adds temporary travel delay and removes it as the water drops.
function updateWaterTravelPenalty(){
  const previousPenalty = Number(state.waterTravelPenalty || 0);
  const nextPenalty = Math.max(0, Number(state.waterLevel || 0) - 15);
  const delta = nextPenalty - previousPenalty;
  if (!delta) return;
  state.travel = Math.max(0, Number(state.travel || 0) + delta);
  state.waterTravelPenalty = nextPenalty;
  if (delta > 0) {
    addPrompt({phase:'water', type:'manual', title:'Neck-Deep Flooding', detail:`Added ${delta} day(s) to Travel Remaining from water above neck-deep level. This penalty is removed as water drops.`, effect:'manual'});
    log(`Neck-deep flooding added ${delta} day(s) to travel. Current water travel penalty is ${nextPenalty} day(s).`);
  } else {
    log(`Water dropped below prior neck-deep levels, removing ${Math.abs(delta)} day(s) from travel. Current water travel penalty is ${nextPenalty} day(s).`);
  }
}

// Advances the calendar and resets per-turn flags after the water step is finished.
function advanceTurn(doRender = true, shouldSync = true, shouldTickOngoing = true){
  if (shouldSync) syncFromInputs();
  if (isNightDecisionPoint()) {
    log('Nightfall reached. Choose Rest or Night Overtime before advancing.');
    if (doRender) render();
    return;
  }
  pushUndo('Advanced turn');
  finalizeWaterKnowledgeForCurrentTurn();
  const completedDay = Number(state.day);
  const completedTurn = Number(state.turn);
  tickConditions();
  if (shouldTickOngoing) tickOngoing();
  if (!state.isNightOvertime && completedTurn >= nighttimeTurnForDay(completedDay)) {
    const nightTurn = nighttimeTurnForDay(completedDay);
    addMealPrompts('dinner', 'preAction', {key:`day-${completedDay}-after-turn-${nightTurn}-dinner`, timing:`after Turn ${nightTurn}`});
    addLongRestPrompt('preAction');
    state.day = completedDay + 1;
    state.turn = 1;
  } else {
    state.turn = completedTurn + 1;
  }
  state.confirmedActions = {};
  state.startedGroups = {};
  state.actionsCommittedThisTurn = false;
  clearActionCommitSnapshot();
  state.scriptedCheckedThisTurn = false;
  state.eventResolvedThisTurn = false;
  state.waterUpdatedThisTurn = false;
  state.turnStep = 1;
  autoPlanOngoing();
  initializeWaterKnowledgeForCurrentTurn();
  log(`Advanced to Day ${state.day}, Turn ${state.turn}.`);
  saveStateSnapshot();
  if (doRender) render();
}

function nighttimeTurnForDay(day){
  return 8;
}

function isNightDecisionPoint(){
  return !state.isNightOvertime && state.waterUpdatedThisTurn && Number(state.turn) >= nighttimeTurnForDay(state.day);
}

function currentOvertimeSaveDC(){
  return Math.min(18, 10 + Number(state.overtimeTurnCount || 0) * 2);
}

// Night overtime saves are created only for characters who actually worked that overtime turn.
function addNightOvertimePrompts(){
  if (!state.isNightOvertime) return;
  const dc = currentOvertimeSaveDC();
  const workers = state.crew.filter(character => {
    const actionId = state.confirmedActions[character.name];
    return actionId && actionId !== 'idle';
  });
  workers.forEach(character => addPrompt({
    phase:'water',
    type:'save',
    character:character.name,
    title:'Night Overtime',
    detail:`${character.name} worked through the night. Constitution save DC ${dc}. On failure, gain 1 overtime Exhaustion.`,
    dc,
    ability:'CON',
    effect:'overtimeExhaustion'
  }));
  state.overtimeTurnCount = Number(state.overtimeTurnCount || 0) + 1;
  log(`Night Overtime turn ${state.overtimeTurnCount} completed. ${workers.length} overtime Constitution save prompt${workers.length === 1 ? '' : 's'} created at DC ${dc}.`);
}

function tickConditions(){
  state.conditions = state.conditions.map(c => ({...c, turns: Number(c.turns) - 1})).filter(c => c.turns > 0);
}

// Ongoing work only ticks down after the character confirms the automatic continuation.
function tickOngoing(){
  state.ongoing.filter(o => o.status === 'active').forEach(o => {
    if (o.createdDay === state.day && o.createdTurn === state.turn) return;
    const allConfirmed = o.actors.every(name => state.confirmedActions[name] === o.actionId);
    if (!allConfirmed) return;
    o.remaining = Math.max(0, Number(o.remaining) - 1);
    if (o.remaining === 0) {
      const action = actionById(o.actionId);
      completeAction(action, o.actors);
      o.status = 'resolved';
      o.actors.forEach(name => delete state.plannedActions[name]);
      log(`${o.actors.join(', ')} completed ${action.name} at the end of the turn.`);
    }
  });
}

// Deferred completions are for effects that should not change the game state mid-action selection.
function completeDeferredActions(){
  (state.deferredCompletions || [])
    .filter(item => item.status === 'pending')
    .forEach(item => {
      const action = actionById(item.actionId);
      if (!action) {
        item.status = 'cancelled';
        return;
      }
      completeAction(action, item.actors);
      item.status = 'resolved';
      item.actors.forEach(name => delete state.plannedActions[name]);
      log(`${item.actors.join(', ')} completed ${action.name} at the end of the turn.`);
    });
}

// Characters locked into multi-turn work are automatically assigned their continuation action.
function autoPlanOngoing(){
  state.ongoing.filter(o => o.status === 'active').forEach(o => {
    o.actors.forEach(name => { state.plannedActions[name] = o.actionId; });
    if (o.remaining <= 0) addPrompt({type:'manual', title:`${actionById(o.actionId).name} Ready`, detail:`Confirm completion for ${o.actors.join(', ')}.`, effect:'manual'});
  });
}

function startTurnPrompts(shouldSync = true, shouldRender = true){
  if (shouldSync) syncFromInputs();
  addStartTurnTriggers();
  if (shouldRender) render();
}

// Start-turn triggers run before the open sea event according to the core turn structure.
function addStartTurnTriggers(){
  const key = `${state.day}-${state.turn}`;
  if (state.startPromptKey === key) return;
  state.startPromptKey = key;
  if (state.riggingStatus === 'Broken') {
    addPrompt({phase:'preAction', type:'save', title:'Broken Rigging', detail:'At start of turn, choose a random top-deck creature. DC 13 Dexterity save or take 2d6 bludgeoning damage.', dc:13, effect:'damageNote'});
  }
  const scripted = scriptedEventForTurn();
  if (scripted) addScriptedPrompt(scripted);
}

function addScriptedPrompt(scripted){
  if (scripted.type === 'breakfast') {
    addMealPrompts('breakfast', 'preAction', {key:`day-${state.day}-before-turn-1-breakfast`, timing:'before Turn 1'});
    return;
  }
  if (scripted.apply && !state.appliedScriptedEvents?.[scripted.id]) {
    if (!state.appliedScriptedEvents) state.appliedScriptedEvents = {};
    scripted.apply(state);
    state.appliedScriptedEvents[scripted.id] = true;
    log(`${scripted.title} scripted effect applied.`);
  }
  addPrompt({phase:'preAction', type:'manual', title:scripted.title || 'Scripted Event', detail:scripted.detail, effect:'manual', blocking:Boolean(scripted.blocking), emphasis:scripted.alert ? 'scripted' : ''});
}

function scriptedEventForTurn(){
  const definition = scriptedEvents.find(event => event.matches(state));
  if (definition) return materializeScriptedEvent(definition);
  return null;
}

function materializeScriptedEvent(definition){
  return {
    ...definition,
    id: typeof definition.id === 'function' ? definition.id(state) : definition.id
  };
}

function openSeaEventRequiredForTurn(){
  const scripted = scriptedEventForTurn();
  if (scripted?.blocksOpenSea) return false;
  if (Number(state.day) === 1) {
    const turn = Number(state.turn);
    return turn >= 2 && turn <= 6 && turn % 2 === 0;
  }
  return true;
}

function rollOpenSeaEvent(){
  syncFromInputs();
  if (!openSeaEventRequiredForTurn()) {
    q('eventTitle').textContent = 'No Open Sea Event';
    q('eventText').textContent = 'This turn does not call for an Open Sea Event roll.';
    return;
  }
  pushUndo('Rolled Open Sea Event');
  const roll = Math.floor(Math.random() * 20) + 1;
  q('eventRoll').value = roll;
  previewOpenSeaEvent(roll);
}

// Manual edits to the d20 input update the event preview before confirmation.
function previewOpenSeaEvent(roll){
  const event = events[Number(roll)];
  if (!event) {
    q('eventTitle').textContent = 'Invalid roll';
    q('eventText').textContent = 'Enter or roll 1-20.';
    return;
  }
  q('eventTitle').textContent = `Rolled ${roll}. ${event.title}`;
  q('eventText').textContent = `${event.text} Confirm Event to apply this result.`;
}

function bindEventListeners(){
  q('eventRoll').addEventListener('input', event => previewOpenSeaEvent(event.target.value));
  q('eventRoll').addEventListener('change', event => previewOpenSeaEvent(event.target.value));
  q('crewAdjustSelect')?.addEventListener('change', updateCrewAdjustReadout);
  q('importFile')?.addEventListener('change', event => importStateFile(event.target.files?.[0]));
}

function resolveEvent(){
  syncFromInputs();
  if (!openSeaEventRequiredForTurn()) {
    q('eventTitle').textContent = 'No Open Sea Event';
    q('eventText').textContent = 'This turn does not call for an Open Sea Event roll.';
    return;
  }
  const roll = Number(q('eventRoll').value);
  const event = events[roll];
  if (!event) {
    q('eventTitle').textContent = 'Invalid roll';
    q('eventText').textContent = 'Enter 1-20.';
    return;
  }
  pushUndo(`Confirmed Open Sea Event ${roll}`);
  q('eventTitle').textContent = `${roll}. ${event.title}`;
  q('eventText').textContent = event.text;
  if (event.apply) event.apply(state);
  state.eventResolvedThisTurn = true;
  state.turnStep = pendingPromptCount('preAction') ? 2 : Math.max(state.turnStep, 3);
  log(`Open Sea Event ${roll} was confirmed: ${event.title}. ${event.text}`);
  saveStateSnapshot();
  render();
}

function addCondition(name, turns){
  const existing = state.conditions.find(c => c.name === name);
  if (existing) existing.turns = Math.max(existing.turns, turns);
  else state.conditions.push({name, turns});
}

function addFog(){
  syncFromInputs();
  pushUndo('Added fog');
  addCondition('Dense Fog', 2);
  render();
}

function clearConditions(){
  pushUndo('Cleared conditions');
  state.conditions = [];
  render();
}

function meal(type){
  syncFromInputs();
  pushUndo(`${capitalize(type)} meal`);
  addMealPrompts(type);
  render();
}

function longRest(){
  syncFromInputs();
  pushUndo('Added long rest prompt');
  addLongRestPrompt();
  render();
}

function startNightOvertime(){
  syncFromInputs();
  pushUndo('Started Night Overtime');
  resolveNightDinner('preAction', `day-${state.day}-turn-${state.turn}-dinner-before-overtime`, 'before Night Overtime');
  beginNightOvertime();
  saveStateSnapshot();
  render();
}

function continueNightOvertime(){
  advanceTurn(true, true, false);
}

function overtimeTurnsFromCurrentTurn(){
  return Math.max(0, Number(state.turn) - nighttimeTurnForDay(state.day));
}

function reconcileManualNightOvertime(){
  const overtimeTurns = overtimeTurnsFromCurrentTurn();
  const beforeActive = state.isNightOvertime;
  const beforeCount = Number(state.overtimeTurnCount || 0);
  if (overtimeTurns <= 0) {
    state.isNightOvertime = false;
    state.overtimeTurnCount = 0;
    clearPendingNightOvertimePrompts();
    if (beforeActive) log('Manual turn change left Night Overtime. Night Overtime alert cleared.');
    return;
  }
  state.isNightOvertime = true;
  state.overtimeTurnCount = overtimeTurns;
  updatePendingNightOvertimePromptDC();
  if (!beforeActive) {
    log(`Manual turn change entered Night Overtime. Current overtime save DC is ${currentOvertimeSaveDC()}.`);
  } else if (beforeCount !== overtimeTurns) {
    log(`Manual turn change updated Night Overtime to turn ${overtimeTurns}. Current overtime save DC is ${currentOvertimeSaveDC()}.`);
  }
}

function updatePendingNightOvertimePromptDC(){
  const dc = currentOvertimeSaveDC();
  state.pendingChecks.forEach(prompt => {
    if (prompt.status === 'resolved' || prompt.effect !== 'overtimeExhaustion') return;
    prompt.dc = dc;
    const characterName = prompt.character || 'This character';
    prompt.detail = `${characterName} worked through the night. Constitution save DC ${dc}. On failure, gain 1 overtime Exhaustion.`;
  });
}

function clearPendingNightOvertimePrompts(){
  state.pendingChecks.forEach(prompt => {
    if (prompt.status !== 'resolved' && prompt.effect === 'overtimeExhaustion') prompt.status = 'resolved';
  });
}

function beginNightOvertime(reason = 'Night Overtime begins.'){
  if (state.isNightOvertime) return;
  state.isNightOvertime = true;
  log(`${reason} Current overtime save DC is ${currentOvertimeSaveDC()}.`);
}

function endNightOvertimeAndRest(){
  syncFromInputs();
  pushUndo('Ended Night Overtime and rested');
  const wasActive = state.isNightOvertime;
  finalizeWaterKnowledgeForCurrentTurn();
  if (!hasDinnerStatusForRest()) {
    resolveNightDinner('preAction', `night-overtime-end-day-${state.day}-turn-${state.turn}-dinner`, 'before rest');
  }
  addLongRestPrompt('preAction');
  state.isNightOvertime = false;
  state.overtimeTurnCount = 0;
  const completedDay = Number(state.day);
  state.day = completedDay + 1;
  state.turn = 1;
  state.confirmedActions = {};
  state.startedGroups = {};
  state.actionsCommittedThisTurn = false;
  clearActionCommitSnapshot();
  state.scriptedCheckedThisTurn = false;
  state.eventResolvedThisTurn = false;
  state.waterUpdatedThisTurn = false;
  state.turnStep = 1;
  autoPlanOngoing();
  initializeWaterKnowledgeForCurrentTurn();
  log(`${wasActive ? 'Night Overtime ends' : 'Night rest begins'}. Dinner was checked, rest is pending breakfast, and the tracker advanced to Day ${state.day}, Turn ${state.turn}.`);
  saveStateSnapshot();
  render();
}

function changeOvertimeTurnCount(amount){
  syncFromInputs();
  pushUndo('Changed Night Overtime turn count');
  const before = Number(state.overtimeTurnCount || 0);
  state.overtimeTurnCount = Math.max(0, before + Number(amount));
  updatePendingNightOvertimePromptDC();
  log(`Manual override: Night Overtime turn count changed from ${before} to ${state.overtimeTurnCount}.`);
  saveStateSnapshot();
  render();
}

function clearOvertimeExhaustion(shouldRender = true){
  if (shouldRender) pushUndo('Cleared overtime Exhaustion');
  state.crew.forEach(character => {
    const overtime = Number(state.overtimeExhaustion?.[character.name] || 0);
    if (!overtime) return;
    const before = Number(character.exhaustion || 0);
    character.exhaustion = Math.max(0, before - overtime);
    state.overtimeExhaustion[character.name] = 0;
    log(`${character.name}'s overtime Exhaustion was cleared. Visible Exhaustion changed from ${before} to ${character.exhaustion}.`);
  });
  state.crew.forEach(character => { state.overtimeExhaustion[character.name] = Number(state.overtimeExhaustion[character.name] || 0); });
  if (shouldRender) {
    saveStateSnapshot();
    render();
  }
}

function clearOvertimeExhaustionAmount(amount){
  const clearAmount = Math.max(0, Number(amount || 0));
  if (!clearAmount) return;
  state.crew.forEach(character => {
    const overtime = Number(state.overtimeExhaustion?.[character.name] || 0);
    const removed = Math.min(clearAmount, overtime);
    if (!removed) return;
    const before = Number(character.exhaustion || 0);
    character.exhaustion = Math.max(0, before - removed);
    state.overtimeExhaustion[character.name] = Math.max(0, overtime - removed);
    log(`${character.name} cleared ${removed} overtime Exhaustion. Visible Exhaustion changed from ${before} to ${character.exhaustion}.`);
  });
  state.crew.forEach(character => { state.overtimeExhaustion[character.name] = Number(state.overtimeExhaustion[character.name] || 0); });
}

// Shown only at the night decision point or while Night Overtime is active.
function renderNightOvertimeControls(){
  const box = q('nightOvertimeControls');
  if (!box) return;
  const wrapper = box.closest('.night-overtime-wrapper');
  const shouldShow = state.isNightOvertime || isNightDecisionPoint();
  if (wrapper) wrapper.classList.toggle('hidden', !shouldShow);
  if (!shouldShow) {
    box.innerHTML = '';
    return;
  }
  const dc = currentOvertimeSaveDC();
  const rows = state.crew.map(character => {
    const count = Number(state.overtimeExhaustion?.[character.name] || 0);
    return `<span class="pill ${count ? 'warn' : 'good'}">${character.name}: ${count}</span>`;
  }).join('');
  const mainButton = state.isNightOvertime
    ? `<button class="good" onclick="endNightOvertimeAndRest()">End Night Overtime and Rest</button>`
    : `<button class="warn" onclick="startNightOvertime()">Start Night Overtime</button>`;
  box.innerHTML = `<div class="night-overtime-panel ${state.isNightOvertime ? 'active' : ''}">
    <div class="prompt-title">${state.isNightOvertime ? `Night Overtime Active. Current overtime save DC: ${dc}.` : 'Nightfall reached. Eat dinner, then rest or start Night Overtime.'}</div>
    <div class="prompt-detail">Turns beyond nightfall: ${state.overtimeTurnCount}. Dinner: ${mealStatusText(state.restMealStatus?.dinnerAvailable)}. Overtime Exhaustion: ${rows}</div>
    <div class="actions">
      ${mainButton}
      ${state.isNightOvertime ? '' : '<button class="good" onclick="endNightOvertimeAndRest()">Rest and Advance to Next Day</button>'}
    </div>
    <details class="night-overtime-advanced">
      <summary>Advanced overrides</summary>
      <div class="actions">
        <button onclick="changeOvertimeTurnCount(-1)">Overtime Turn -1</button>
        <button onclick="changeOvertimeTurnCount(1)">Overtime Turn +1</button>
        <button onclick="clearOvertimeExhaustion()">Clear Overtime Exhaustion</button>
      </div>
    </details>
  </div>`;
}

// Dinner and breakfast are resolved separately, then breakfast applies the overnight rest outcome.
function addMealPrompts(type, phase = 'action', options = {}){
  const result = consumeMealSupplies(type, options);
  if (!result.consumed) return false;
  recordMealAvailability(type, result, options);
  log(`${capitalize(type)} ${result.available ? 'was available and' : 'was short but still'} consumed up to 0.5 Food and 0.5 Water. Food changed from ${formatNumber(result.beforeFood)} to ${formatNumber(state.food)}. Fresh Water changed from ${formatNumber(result.beforeWater)} to ${formatNumber(state.freshWater)}.`);
  if (type === 'breakfast') applyOvernightRestOutcome(phase);
  return true;
}

// Meal keys prevent breakfast/dinner from being accidentally charged twice.
function consumeMealSupplies(type, options = {}){
  if (!state.consumedMeals) state.consumedMeals = {};
  if (options.key && state.consumedMeals[options.key]) return {consumed:false};
  const beforeFood = Number(state.food || 0);
  const beforeWater = Number(state.freshWater || 0);
  state.food = Math.max(0, beforeFood - 0.5);
  state.freshWater = Math.max(0, beforeWater - 0.5);
  if (options.key) state.consumedMeals[options.key] = true;
  return {
    consumed:true,
    beforeFood,
    beforeWater,
    shortFood: beforeFood < 0.5,
    shortWater: beforeWater < 0.5,
    available: beforeFood >= 0.5 && beforeWater >= 0.5
  };
}

function addLongRestPrompt(phase = 'action'){
  state.longRestLaborRecoveryPending = true;
  state.restMealStatus = {
    ...structuredClone(defaultState.restMealStatus),
    ...(state.restMealStatus || {}),
    pending:true,
    breakfastAvailable:null,
    breakfastKey:''
  };
  addPrompt({phase, type:'manual', title:'Long Rest', detail:'Resolve breakfast to determine overnight recovery from dinner and breakfast availability.', effect:'manual'});
  log('Added a Long Rest prompt. Breakfast will resolve overnight Labor and overtime Exhaustion recovery.');
}

function recordMealAvailability(type, result, options = {}){
  if (!state.restMealStatus) state.restMealStatus = structuredClone(defaultState.restMealStatus);
  if (type === 'dinner') {
    state.restMealStatus.dinnerAvailable = Boolean(result.available);
    state.restMealStatus.dinnerKey = options.key || state.restMealStatus.dinnerKey || '';
    log(`Dinner availability for the next rest was recorded as ${result.available ? 'available' : 'not available'}.`);
  }
  if (type === 'breakfast') {
    state.restMealStatus.breakfastAvailable = Boolean(result.available);
    state.restMealStatus.breakfastKey = options.key || state.restMealStatus.breakfastKey || '';
    log(`Breakfast availability for overnight recovery was recorded as ${result.available ? 'available' : 'not available'}.`);
  }
}

function hasDinnerStatusForRest(){
  return state.restMealStatus && state.restMealStatus.dinnerAvailable !== null && state.restMealStatus.dinnerAvailable !== undefined;
}

function resolveNightDinner(phase, key, timing){
  return addMealPrompts('dinner', phase, {key, timing});
}

function mealStatusText(value){
  if (value === true) return 'available';
  if (value === false) return 'not available';
  return 'not checked';
}

function applyOvernightRestOutcome(phase = 'preAction'){
  if (!state.longRestLaborRecoveryPending && !state.restMealStatus?.pending) return;
  const dinnerAvailable = Boolean(state.restMealStatus?.dinnerAvailable);
  const breakfastAvailable = Boolean(state.restMealStatus?.breakfastAvailable);
  let laborRecovery = 1;
  let longRestBenefits = false;
  let clearMode = 'none';
  let title = 'Poor Rest';

  if (dinnerAvailable && breakfastAvailable) {
    title = 'Full Rest and Meals';
    laborRecovery = 3;
    longRestBenefits = true;
    clearMode = 'all';
  } else if (dinnerAvailable) {
    title = 'Dinner Only Rest';
    laborRecovery = 1;
    longRestBenefits = true;
    clearMode = 'all';
  } else if (breakfastAvailable) {
    title = 'Breakfast Only Rest';
    laborRecovery = 2;
    longRestBenefits = true;
    clearMode = 'one';
  } else {
    title = 'No Overnight Meals';
    laborRecovery = 1;
    clearMode = 'none';
    state.noMealStreak = Number(state.noMealStreak || 0) + 1;
    const noMealDc = noMealSaveDC();
    state.crew.forEach(character => addPrompt({
      phase,
      type:'save',
      character:character.name,
      title:'No Overnight Meals',
      detail:`No dinner or breakfast was available. Constitution save DC ${noMealDc} or gain 1 Exhaustion. This DC increases by 2 for each consecutive day without meals.`,
      dc:noMealDc,
      ability:'CON',
      effect:'mealExhaustion'
    }));
  }

  if (dinnerAvailable || breakfastAvailable) state.noMealStreak = 0;
  recoverCrewLabor(laborRecovery, title);
  if (clearMode === 'all') clearOvertimeExhaustion(false);
  if (clearMode === 'one') clearOvertimeExhaustionAmount(1);
  log(`${title}: ${longRestBenefits ? 'long rest benefits apply' : 'long rest benefits do not apply'}, ${laborRecovery} Labor recovered, overtime Exhaustion clear mode: ${clearMode}.`);
  state.longRestLaborRecoveryPending = false;
  state.restMealStatus = structuredClone(defaultState.restMealStatus);
}

function noMealSaveDC(){
  return 15 + Math.max(0, Number(state.noMealStreak || 1) - 1) * 2;
}

function recoverCrewLabor(amount, reason){
  state.crew.forEach(character => {
    const before = Number(character.labor || 0);
    character.labor = Math.max(0, before - Number(amount));
    if (before !== character.labor) {
      log(`${character.name} recovered ${amount} Labor from ${reason}. Labor changed from ${formatNumber(before)} to ${formatNumber(character.labor)}.`);
    }
  });
}

function saveState(){
  syncFromInputs();
  saveStateSnapshot();
  log('Saved the tracker state.');
  render();
}

// Browser export creates a portable backup file in the user's normal download location.
function exportState(){
  syncFromInputs();
  state.version = APP_VERSION;
  const exportState = structuredClone(state);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `marrowwind-tracker-day-${state.day}-turn-${state.turn}-${timestamp}.json`;
  const blob = new Blob([JSON.stringify(exportState, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  log(`Exported tracker state to ${filename}.`);
  saveStateSnapshot();
  render();
}

function chooseImportFile(){
  const input = q('importFile');
  if (!input) return;
  input.value = '';
  input.click();
}

// Import restores a previously exported JSON state, then runs migration for compatibility.
function importStateFile(file){
  if (!file) return;
  const reader = new FileReader();
  reader.onload = event => {
    try {
      const importedState = JSON.parse(event.target.result);
      if (!importedState || typeof importedState !== 'object' || Array.isArray(importedState)) {
        throw new Error('Import file did not contain a tracker state object.');
      }
      pushUndo('Imported tracker state');
      clearActionCommitSnapshot();
      state = importedState;
      migrateState();
      log(`Imported tracker state from ${file.name}.`);
      saveStateSnapshot();
      render();
    } catch (error) {
      alert(`Import failed: ${error.message}`);
    }
  };
  reader.onerror = () => alert('Import failed: the file could not be read.');
  reader.readAsText(file);
}

function saveStateSnapshot(){
  state.version = APP_VERSION;
  localStorage.setItem('openSeaTracker', JSON.stringify(state));
}

// Publish a filtered state object for player_view.html.
// Anything not included here is intentionally hidden from the player-facing screen.
function publishPlayerState(){
  initializeWaterKnowledgeForCurrentTurn();
  const snapshot = {
    version: APP_VERSION,
    updatedAt: Date.now(),
    day: state.day,
    turn: state.turn,
    travel: playerKnownValue('travel'),
    waterLevel: playerKnownWaterLevel(),
    activeLeaks: state.activeLeaks,
    waterTravelPenalty: state.waterTravelPenalty || 0,
    totalIngress: playerKnownValue('totalIngress'),
    food: playerKnownValue('food'),
    freshWater: playerKnownValue('freshWater'),
    repairMaterials: playerKnownValue('repairMaterials'),
    systems: {
      mast: state.mastStatus,
      rudder: state.rudderStatus,
      pump: state.pumpStatus,
      net: state.netStatus,
      rigging: state.riggingStatus
    },
    effects: activePlayEffects()
      .filter(effect => !effect.dmOnly)
      .map(effect => ({
        title: effect.title,
        detail: effect.detail,
        className: effect.className || ''
      })),
    ongoing: state.ongoing
      .filter(item => item.status === 'active')
      .map(item => ({
        name: actionById(item.actionId)?.name || item.actionId,
        actors: item.actors,
        remaining: item.remaining
      })),
    crew: state.crew.map(character => ({
      name: character.name,
      labor: Number(character.labor || 0),
      exhaustion: Number(character.exhaustion || 0),
      currentAction: playerCrewAction(character.name),
      turnsRemaining: characterTurnsRemaining(character.name),
      doneInStatus: characterDoneInStatus(character.name),
      actionConfirmed: Boolean(state.confirmedActions[character.name]),
      lastAction: character.lastAction || ''
    }))
  };
  localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify(snapshot));
}

function playerCrewAction(name){
  const plannedAction = actionById(state.plannedActions?.[name]);
  if (plannedAction) return plannedAction.name;
  return crewByName(name)?.lastAction || '';
}

function playerKnownValue(key){
  const value = state.playerKnowledge?.[key];
  return {
    known: value !== null && value !== undefined,
    value: value ?? null
  };
}

// Below cargo hold, players only know the ship is safe unless the rod has been checked.
function playerKnownWaterLevel(){
  if (Number(state.waterLevel) >= 5) {
    return {known:true, value:Number(state.waterLevel), automatic:true};
  }
  const known = playerKnownValue('waterLevel');
  if (known.known) return known;
  return {known:false, value:null, safeBelowCargo:true};
}

function loadState(){
  const raw = localStorage.getItem('openSeaTracker') || localStorage.getItem('openSeaTrackerDraft');
  if (raw) {
    pushUndo('Loaded saved state');
    clearActionCommitSnapshot();
    state = JSON.parse(raw);
    migrateState();
    render();
  }
}

function resetState(){
  if (confirm('Reset tracker?')) {
    pushUndo('Reset tracker');
    clearActionCommitSnapshot();
    state = structuredClone(defaultState);
    render();
  }
}

function runDevValidator(){
  const results = devValidationChecks();
  const box = q('devValidatorResults');
  if (!box) return;
  box.innerHTML = results.map(result =>
    `<div class="dev-validator-row ${result.pass ? 'pass' : 'fail'}">${result.pass ? 'PASS' : 'FAIL'}: ${h(result.label)}${result.detail ? ` - ${h(result.detail)}` : ''}</div>`
  ).join('');
}

function devValidationChecks(){
  const originalState = state;
  const results = [];
  const check = (label, pass, detail = '') => results.push({label, pass:Boolean(pass), detail});
  const withState = (partial, callback) => {
    state = {...structuredClone(defaultState), ...partial};
    migrateState();
    try {
      callback();
    } finally {
      state = originalState;
    }
  };

  check('Initial defaults', Number(defaultState.travel) === 5.5 && Number(defaultState.minIngress) === 1 && Number(defaultState.activeLeaks) === 0 && Number(defaultState.repairMaterials) === 4, 'Travel 5.5, min ingress 1, leaks 0, repairs 4.');
  check('Action metadata loaded once', Array.isArray(ACTION_METADATA) && ACTION_METADATA.length === actions.length && ACTION_METADATA.every(action => actionById(action.id)), `${ACTION_METADATA.length} metadata actions.`);
  check('Player duplicate duration tables removed', typeof PLAYER_ACTION_BASE_DURATIONS === 'undefined' && typeof PLAYER_FLOODED_EXTRA_TURN_ACTIONS === 'undefined', 'Player view should use shared action metadata.');

  withState({day:1, turn:8}, () => {
    const scripted = scriptedEventForTurn();
    check('Day 1 Turn 8 scripted event', scripted?.title === `Sehanine's Storm` && scripted.blocksOpenSea === true, scripted?.title || 'missing');
    check('Day 1 Turn 8 skips Open Sea Event', openSeaEventRequiredForTurn() === false);
  });
  withState({day:2, turn:7}, () => {
    const scripted = scriptedEventForTurn();
    check('Day 2 Turn 7 scripted event', scripted?.title === 'Nereids Encounter' && scripted.blocksOpenSea === true, scripted?.title || 'missing');
  });
  withState({day:2, turn:8}, () => {
    const scripted = scriptedEventForTurn();
    check('Day 2 Turn 8 scripted event', scripted?.title === 'Bev Nightmare Encounter' && scripted.blocksOpenSea === true, scripted?.title || 'missing');
  });
  withState({day:1, turn:2}, () => {
    check('Day 1 Turn 2 rolls Open Sea Event', openSeaEventRequiredForTurn() === true);
  });
  withState({day:1, turn:3}, () => {
    check('Day 1 Turn 3 skips Open Sea Event', openSeaEventRequiredForTurn() === false);
  });
  withState({waterLevel:4}, () => {
    check('Inventory normal duration', actionDuration(actionById('inventoryFood')) === 1, `got ${actionDuration(actionById('inventoryFood'))}`);
  });
  withState({waterLevel:5}, () => {
    check('Inventory flooded duration', actionDuration(actionById('inventoryFood')) === 2, `got ${actionDuration(actionById('inventoryFood'))}`);
    check('Study Map ignores flooded duration', actionDuration(actionById('studyMap')) === 1, `got ${actionDuration(actionById('studyMap'))}`);
    check('Bilge Rod ignores flooded extra turn', actionDuration(actionById('examineRod')) === 1, `got ${actionDuration(actionById('examineRod'))}`);
  });
  withState({conditions:[{name:'Floating Wreckage', turns:1}]}, () => {
    check('Recover wreckage appears during event', isActionDropdownAvailable(defaultState.crew[0].name, actionById('recoverWreckage')));
  });
  withState({conditions:[]}, () => {
    check('Recover wreckage hidden without event', !isActionDropdownAvailable(defaultState.crew[0].name, actionById('recoverWreckage')));
  });
  withState({noMealStreak:1}, () => {
    check('No-meal save starts at DC 15', noMealSaveDC() === 15, `got ${noMealSaveDC()}`);
  });
  withState({noMealStreak:2}, () => {
    check('No-meal save increases by 2', noMealSaveDC() === 17, `got ${noMealSaveDC()}`);
  });

  const passCount = results.filter(result => result.pass).length;
  results.unshift({label:`Dev validator summary: ${passCount}/${results.length} checks passed`, pass:passCount === results.length, detail:''});
  return results;
}

// Normalize old localStorage/export shapes into the current versioned state.
function migrateState(){
  state = {...structuredClone(defaultState), ...state};
  state.version = APP_VERSION;
  if (typeof state.mast === 'boolean') state.mastStatus = state.mast ? 'Repaired' : 'Broken';
  if (typeof state.rudder === 'boolean') state.rudderStatus = state.rudder ? 'Repaired' : 'Broken';
  if (typeof state.pump === 'boolean') state.pumpStatus = state.pump ? 'Working' : 'Jammed';
  if (typeof state.net === 'boolean') state.netStatus = state.net ? 'Ready' : 'Tangled';
  if (typeof state.rigging === 'boolean') state.riggingStatus = state.rigging ? 'Intact' : 'Broken';
  if (typeof state.timber === 'boolean') state.salvagedTimber = state.timber ? 1 : Number(state.salvagedTimber || 0);
  state.crew = crewNames.map((defaultName, index) => {
    const existing = (state.crew || [])[index] || (state.crew || []).find(c => c.name === defaultName) || {};
    const name = existing.name || defaultName;
    const background = existing.sailorPirateBackground ?? existing.sailorBackground ?? defaultSailorPirateCrew.has(defaultName);
    return {
      name,
      labor:Number(existing.labor || 0),
      exhaustion:Number(existing.exhaustion || 0),
      lastAction:existing.lastAction || '',
      sailorPirateBackground:Boolean(background)
    };
  });
  state.conditions = Array.isArray(state.conditions) ? state.conditions : [];
  state.playerKnowledge = {...structuredClone(defaultState.playerKnowledge), ...(state.playerKnowledge || {})};
  state.waterKnowledge = {...structuredClone(defaultState.waterKnowledge), ...(state.waterKnowledge || {})};
  state.waterKnowledge.streak = Math.max(0, Number(state.waterKnowledge.streak || 0));
  state.waterKnowledge.knownThisTurn = Boolean(state.waterKnowledge.knownThisTurn);
  state.pendingChecks = Array.isArray(state.pendingChecks) ? state.pendingChecks : [];
  state.deferredCompletions = Array.isArray(state.deferredCompletions) ? state.deferredCompletions : [];
  state.consumedMeals = state.consumedMeals && typeof state.consumedMeals === 'object' ? state.consumedMeals : {};
  state.appliedScriptedEvents = state.appliedScriptedEvents && typeof state.appliedScriptedEvents === 'object' ? state.appliedScriptedEvents : {};
  state.longRestLaborRecoveryPending = Boolean(state.longRestLaborRecoveryPending);
  state.restMealStatus = {
    ...structuredClone(defaultState.restMealStatus),
    ...(state.restMealStatus && typeof state.restMealStatus === 'object' ? state.restMealStatus : {})
  };
  state.noMealStreak = Math.max(0, Number(state.noMealStreak || 0));
  state.ongoing = Array.isArray(state.ongoing) ? state.ongoing : [];
  state.plannedActions = state.plannedActions || {};
  state.confirmedActions = state.confirmedActions || {};
  state.isNightOvertime = Boolean(state.isNightOvertime);
  state.overtimeTurnCount = Math.max(0, Number(state.overtimeTurnCount || 0));
  state.overtimeExhaustion = state.overtimeExhaustion && typeof state.overtimeExhaustion === 'object' ? state.overtimeExhaustion : {};
  state.crew.forEach(character => { state.overtimeExhaustion[character.name] = Number(state.overtimeExhaustion[character.name] || 0); });
  state.turnLedger = state.turnLedger || {pumping:0, buckets:0};
  state.startedGroups = state.startedGroups || {};
  state.salvagedTimber = Number(state.salvagedTimber || 0);
  state.turnStep = Math.max(1, Math.min(turnSteps.length, Number(state.turnStep || 1)));
  state.eventResolvedThisTurn = Boolean(state.eventResolvedThisTurn);
  state.scriptedCheckedThisTurn = Boolean(state.scriptedCheckedThisTurn);
  state.actionsCommittedThisTurn = Boolean(state.actionsCommittedThisTurn);
  state.waterUpdatedThisTurn = Boolean(state.waterUpdatedThisTurn);
  state.waterTravelPenalty = Number(state.waterTravelPenalty || 0);
}

function isAutoPlanned(name){
  return state.ongoing.some(o => o.status === 'active' && o.actors.includes(name) && state.plannedActions[name] === o.actionId);
}

function log(message){
  state.log = `Day ${state.day}, Turn ${state.turn}: ${message}\n` + (state.log || '');
}

function fieldLabel(field){
  const labels = {
    day:'Day',
    turn:'Turn',
    travel:'Travel Remaining',
    waterLevel:'Water Level',
    minIngress:'Minimum Water Ingress',
    totalIngress:'Total Water Ingress',
    activeLeaks:'Active Leaks',
    food:'Food',
    freshWater:'Fresh Water',
    repairMaterials:'Repair Supplies',
    salvagedTimber:'Salvaged Timber',
    mastStatus:'Mast',
    rudderStatus:'Rudder',
    pumpStatus:'Bilge Pump',
    netStatus:'Fishing Net',
    riggingStatus:'Rigging',
    pumping:'Pumping',
    buckets:'Bucket Brigade',
    labor:'Labor',
    exhaustion:'Exhaustion'
  };
  return labels[field] || field;
}

function humanOutcome(outcomeId){
  const outcomes = {
    recoverLabor:'Recover 2 Labor',
    recoverExhaustion:'Recover 1 Exhaustion',
    pumpTwo:'Water reduced by 2',
    pumpThree:'Water reduced by 3',
    pumpFour:'Water reduced by 4',
    foodQuarter:'+0.25 Food',
    foodHalf:'+0.5 Food',
    foodOne:'+1 Food',
    foodTwo:'+2 Food',
    fail:'Failure'
  };
  return outcomes[outcomeId] || outcomeId;
}

function capitalize(value){
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

bindEventListeners();
render();
