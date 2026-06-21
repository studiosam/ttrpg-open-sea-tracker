// Shared tracker state, rule tables, and low-level rule helpers.
const APP_VERSION = 9;
const PLAYER_STATE_KEY = 'openSeaPlayerState';
const ACTION_COMMIT_SNAPSHOT_KEY = 'openSeaActionCommitSnapshot';
const DEFAULT_SHIP_NAME = 'The Marrowwind';
const SHIP_NAME_MAX_LENGTH = 60;
const CREW_NAME_MAX_LENGTH = 30;
const TRAVEL_TICKS_PER_DAY = 8;
const DEFAULT_TRAVEL_TICKS = 44;
const DEFAULT_COURSE_METER = 12;
const COURSE_METER_MIN = 0;
const COURSE_METER_MAX = 12;
const MIN_CREW_SIZE = 4;
const MAX_CREW_SIZE = 7;
const crewNames = ['Leopold', 'Delilah', 'Toady', 'Xander', 'Grumbo', 'Tommy'];
const defaultSailorPirateCrew = new Set(['Leopold', 'Toady']);
const SETUP_CREW_TRAIT_FIELDS = [
  { field: 'sailorPirateBackground', label: 'Sailor/Pirate' },
  { field: 'fishermanBackground', label: 'Fisherman' },
  { field: 'waterVehiclesProficiency', label: 'Water Vehicles' },
  { field: 'navigatorToolsProficiency', label: "Navigator's Tools" },
  { field: 'cartographerToolsProficiency', label: "Cartographer's Tools" }
];

// Canonical starting state for a new tracker session.
// Migrations use this as a complete fallback when older saves are missing fields.
const defaultState = {
  version: APP_VERSION,
  setupComplete: true,
  shipName: DEFAULT_SHIP_NAME,
  day: 1,
  turn: 1,
  travelTicks: DEFAULT_TRAVEL_TICKS,
  travel: DEFAULT_TRAVEL_TICKS / TRAVEL_TICKS_PER_DAY,
  courseMeter: DEFAULT_COURSE_METER,
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
    courseState: null,
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
    exactKnownThisTurn: false,
    lastKnownTurnKey: '',
    streak: 0
  },
  crew: crewNames.map((name, index) => defaultCrewMember(index, name)),
  plannedActions: {},
  confirmedActions: {},
  salvageLumberBelowDeck: {},
  ongoing: [],
  pendingChecks: [],
  deferredCompletions: [],
  consumedMeals: {},
  appliedScriptedEvents: {},
  longRestLaborRecoveryPending: false,
  restMealStatus: {
    pending: false,
    dinnerAvailable: null,
    dinnerKey: '',
    breakfastAvailable: null,
    breakfastKey: ''
  },
  noMealStreak: 0,
  turnLedger: { pumping: 0, buckets: 0 },
  startedGroups: {},
  startPromptKey: '',
  turnStep: 1,
  scriptedCheckedThisTurn: false,
  eventResolvedThisTurn: false,
  actionsCommittedThisTurn: false,
  navigateResolvedThisTurn: false,
  scriptedSceneTurn: false,
  waterUpdatedThisTurn: false,
  waterTravelPenalty: 0,
  isNightOvertime: false,
  overtimeTurnCount: 0,
  overtimeExhaustion: Object.fromEntries(crewNames.map((name) => [name, 0])),
  log: ''
};
let state = structuredClone(defaultState);
let undoStack = [];
let actionCommitSnapshot = null;
let appMode = 'landing';
let setupDraft = defaultSetupDraft();

// Undo is intentionally in-memory only. Saves and exports remain clean current-state snapshots.
function pushUndo(label) {
  undoStack.push({ label, state: structuredClone(state) });
  if (undoStack.length > 20) undoStack.shift();
  renderUndoStatus();
}

function undoLastChange() {
  const snapshot = undoStack.pop();
  if (!snapshot) return;
  state = structuredClone(snapshot.state);
  migrateState();
  log(`Undid: ${snapshot.label}.`);
  saveStateSnapshot();
  render();
}

function renderUndoStatus() {
  const button = q('undoButton');
  if (!button) return;
  const last = undoStack[undoStack.length - 1];
  button.disabled = !last;
  button.textContent = 'Undo';
  button.title = last ? `Restore state before: ${last.label}` : 'No changes to undo';
}

function storeActionCommitSnapshot(snapshot) {
  actionCommitSnapshot = structuredClone(snapshot);
  sessionStorage.setItem(ACTION_COMMIT_SNAPSHOT_KEY, JSON.stringify(actionCommitSnapshot));
}

function readActionCommitSnapshot() {
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

function clearActionCommitSnapshot() {
  actionCommitSnapshot = null;
  sessionStorage.removeItem(ACTION_COMMIT_SNAPSHOT_KEY);
}

// Open Sea Event table. Event handlers should only apply immediate effects and create prompts.
const events = {
  1: {
    title: 'Hull Groans',
    text: 'Minimum Water Ingress increases by 1.',
    apply: (s) => {
      s.minIngress += 1;
    }
  },
  2: {
    title: 'Broadside Wave',
    text: 'A wave hits the broadside and doubles every active leak.',
    apply: (s) => {
      s.activeLeaks *= 2;
    }
  },
  3: { title: 'Nothing Happens', text: 'The voyage continues uneventfully.' },
  4: { title: 'Nothing Happens', text: 'The voyage continues uneventfully.' },
  5: { title: 'Nothing Happens', text: 'The voyage continues uneventfully.' },
  6: {
    title: 'Dense Fog',
    text: 'Visibility is reduced to 30 feet for 2 turns. Helm checks, fishing checks, floating-object recovery, and ranged attacks against targets not actively engaged in melee are made at disadvantage.',
    apply: (s) => addCondition('Dense Fog', 2)
  },
  7: {
    title: 'Dense Fog',
    text: 'Visibility is reduced to 30 feet for 2 turns. Helm checks, fishing checks, floating-object recovery, and ranged attacks against targets not actively engaged in melee are made at disadvantage.',
    apply: (s) => addCondition('Dense Fog', 2)
  },
  8: {
    title: 'Dense Fog',
    text: 'Visibility is reduced to 30 feet for 2 turns. Helm checks, fishing checks, floating-object recovery, and ranged attacks against targets not actively engaged in melee are made at disadvantage.',
    apply: (s) => addCondition('Dense Fog', 2)
  },
  9: {
    title: 'Large Wave',
    text: 'A repair or seam gives way. Add 1 Active Leak.',
    apply: (s) => {
      s.activeLeaks += 1;
    }
  },
  10: {
    title: 'Large Wave',
    text: 'A repair or seam gives way. Add 1 Active Leak.',
    apply: (s) => {
      s.activeLeaks += 1;
    }
  },
  11: {
    title: 'Large Wave',
    text: 'A repair or seam gives way. Add 1 Active Leak.',
    apply: (s) => {
      s.activeLeaks += 1;
    }
  },
  12: {
    title: 'Rigging Snaps',
    text: 'Random creature on deck makes DC 13 DEX save or takes 2d6 bludgeoning. Rigging can be repaired with 1 Turn, 1 Labor.',
    apply: (s) => {
      s.riggingStatus = 'Broken';
      addPrompt({
        phase: 'preAction',
        type: 'save',
        title: 'Rigging Snaps',
        detail: 'Random creature on deck: DC 13 Dexterity save or take 2d6 bludgeoning damage.',
        dc: 13,
        ability: 'DEX',
        effect: 'damageNote'
      });
    }
  },
  13: {
    title: 'Pack of Gulls',
    text: 'Run a Swarm of Ravens encounter. If not dispatched in 3 rounds, lose 0.5 days rations.',
    apply: (s) => {
      addCondition('Pack of Gulls', 1);
      log(
        `Pack of Gulls is active this turn. Characters may spend their action joining the fight for 0 Labor. If the gulls are not dispatched in 3 rounds, reduce Food by 0.5 days.${fogPackOfGullsText()}`
      );
    }
  },
  14: {
    title: 'Bilge Pump Jams',
    text: 'The pump is unusable until repaired. Bucket brigades still function.',
    apply: (s) => {
      s.pumpStatus = 'Jammed';
    }
  },
  15: {
    title: 'Floating Wreckage',
    text: 'Recover with 1 Turn, 1 Labor, DC 12 DEX/Athletics. On success, gain salvaged timber.',
    apply: (s) => {
      addCondition('Floating Wreckage', 1);
      log(
        `Floating Wreckage is available this turn. Characters may recover it with a 1-turn, 1-Labor action and DC 12 Dexterity or Athletics check.${fogFloatingWreckageText()}`
      );
    }
  },
  16: {
    title: 'School of Fish',
    text: 'The next Cast Net action this turn has advantage. Harpoons gain no benefit.',
    apply: (s) => addCondition('School of Fish', 1)
  },
  17: {
    title: 'Calm Seas',
    text: 'The helmsman recovers 1 Labor instead of gaining 1 while steering this turn.',
    apply: (s) => addCondition('Calm Seas', 1)
  },
  18: {
    title: 'Large Shadow',
    text: 'A massive shape circles beneath the ship. It may be targeted with the harpoon.',
    apply: (s) => {
      addCondition('Large Shadow', 1);
      addPrompt({
        phase: 'preAction',
        type: 'manual',
        title: 'Large Shadow',
        detail: `The shape may be targeted with the harpoon, subject to visibility.${fogLargeShadowText()}`,
        effect: 'manual'
      });
    }
  },
  19: {
    title: 'Favorable Winds',
    text: 'Travel Time -0.25 days (-2 ticks) if mast and rudder are functional.',
    apply: (s) => {
      if (canTravel()) applyTravelTicks(-2);
      else
        addPrompt({
          phase: 'preAction',
          type: 'manual',
          title: 'Favorable Winds Blocked',
          detail:
            'Mast or rudder is not functional, so this event does not reduce travel unless manually overridden.',
          effect: 'manual'
        });
    }
  },
  20: {
    title: 'Phosphorescent Flying Fish & Rain',
    text: 'Gain +1 day Food and +1 day Water. Characters may spend this turn collecting rainwater as a 0-Labor action.',
    apply: (s) => {
      s.food += 1;
      s.freshWater += 1;
      addCondition('Rainwater Collection', 1);
    }
  }
};

const scriptedEvents = [
  {
    id: (s) => `day-${s.day}-breakfast`,
    type: 'breakfast',
    title: 'Breakfast',
    detail: 'Breakfast before Turn 1.',
    matches: (s) => Number(s.turn) === 1
  },
  {
    id: 'day-1-turn-8-sehanines-storm',
    type: 'encounter',
    title: `Sehanine's Storm`,
    detail: `A sudden storm arrives. Run this manually: Mance is knocked overboard by a massive wave after fixing the main sail, at least 2 of his skeletons are burnt to ash, the players must stay up doing Night Overtime repairs before bed, and Minimum Water Ingress increases to 2.`,
    stepDetail: `Run Sehanine's Storm before actions. No Open Sea Event is rolled this turn.`,
    activeDetail:
      'This turn is the sudden storm. Run the Mance overboard event manually, require Night Overtime repairs before bed, and Minimum Water Ingress is raised to 2.',
    className: 'danger',
    dmOnly: true,
    blocking: true,
    blocksOpenSea: true,
    alert: true,
    matches: (s) => Number(s.day) === 1 && Number(s.turn) === 8,
    apply: (s) => {
      s.minIngress = Math.max(Number(s.minIngress || 0), 2);
    }
  },
  {
    id: 'day-2-turn-7-nereids',
    type: 'encounter',
    title: 'Nereids Encounter',
    detail:
      'Handle roleplay manually; the ship still takes on water, and travel only progresses if someone mans the helm.',
    stepDetail: 'Run the Nereids Encounter before actions. No Open Sea Event is rolled this turn.',
    activeDetail:
      'This turn is the Nereids encounter. Handle the roleplay manually; the ship still takes on water, and travel only progresses if someone mans the helm.',
    className: 'good',
    dmOnly: true,
    blocking: true,
    blocksOpenSea: true,
    alert: true,
    matches: (s) => Number(s.day) === 2 && Number(s.turn) === 7
  },
  {
    id: 'day-2-turn-8-bev',
    type: 'encounter',
    title: 'Bev Nightmare Encounter',
    detail:
      'Apply ship damage, stolen supplies, and encounter consequences manually. Bev takes out the mast and rudder; Minimum Water Ingress automatically increases to 3.',
    stepDetail:
      'Run the Bev Nightmare Encounter before actions. No Open Sea Event is rolled this turn.',
    activeDetail:
      'Apply Bev encounter consequences manually. Minimum Water Ingress is raised to 3 after the mast and rudder are taken out.',
    className: 'danger',
    dmOnly: true,
    blocking: true,
    blocksOpenSea: true,
    alert: true,
    matches: (s) => Number(s.day) === 2 && Number(s.turn) === 8,
    apply: (s) => {
      s.minIngress = Math.max(Number(s.minIngress || 0), 3);
    }
  }
];

// Action definitions drive the dropdowns, validation, labor, prompts, and completion effects.
const actionBehaviors = {
  fightGulls: {
    complete: (s, actors) => log(`${actors.join(', ')} joined the fight to scare off the gulls.`)
  },
  collectRainwater: {
    complete: (s) => {
      s.freshWater += 0.5;
    }
  },
  salvageLumber: {
    complete: (s, actors) => {
      const before = Number(s.repairMaterials || 0);
      s.repairMaterials = before + 2;
      log(
        `${actors.join(', ')} salvaged lumber. Repair supplies increased from ${before} to ${s.repairMaterials}.`
      );
    }
  },
  helm: { labor: (s) => (hasCondition('Calm Seas') ? -1 : 1) },
  resetNet: {
    complete: (s) => {
      s.netStatus = 'Ready';
    }
  },
  repairPump: {
    complete: (s) => {
      s.pumpStatus = 'Working';
    }
  },
  repairRigging: {
    complete: (s) => {
      s.riggingStatus = 'Intact';
    }
  },
  bucket: {
    complete: (s) => {
      s.turnLedger.buckets += 1;
    }
  },
  castNet: {
    complete: (s) => {
      s.netStatus = 'Tangled';
    }
  },
  repairLeak: {
    repairCost: (s, actors) => Math.floor(actors.length / 2),
    complete: (s, actors) => {
      s.activeLeaks = Math.max(0, Number(s.activeLeaks) - Math.floor(actors.length / 2));
    }
  },
  repairMast: {
    complete: (s) => {
      s.mastStatus = 'Repaired';
    }
  },
  repairRudder: {
    complete: (s) => {
      s.rudderStatus = 'Repaired';
    }
  }
};
const actions = ACTION_METADATA.map((action) => ({
  ...action,
  ...(actionBehaviors[action.id] || {})
}));
const actionOrder = actions.map((a) => a.id);

// The DM workflow follows the Core Turn Structure one phase at a time.
const turnSteps = [
  { id: 1, title: 'Scripted Events', panel: null },
  { id: 2, title: 'Open Sea Event', panel: 'checksPanel' },
  { id: 3, title: 'Set Actions', panel: 'crewPanel' },
  { id: 4, title: 'Checks', panel: 'checksPanel' },
  { id: 5, title: 'Water / Advance', panel: 'voyagePanel' }
];

function q(id) {
  return document.getElementById(id);
}
function h(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
function normalizedShipName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  return name || DEFAULT_SHIP_NAME;
}
function normalizedSetupShipName(value) {
  return typeof value === 'string' ? value.trim() : '';
}
function defaultSetupDraft() {
  return {
    voyagePreset: 'marrowwind',
    shipName: DEFAULT_SHIP_NAME,
    crewSize: crewNames.length,
    crew: crewNames.map((name, index) => setupCrewDraftFromMember(defaultCrewMember(index, name)))
  };
}
function setupCrewSizeOptions() {
  return Array.from(
    { length: MAX_CREW_SIZE - MIN_CREW_SIZE + 1 },
    (_, index) => MIN_CREW_SIZE + index
  );
}
function clampSetupCrewSize(value) {
  const size = Math.round(Number(value));
  if (!Number.isFinite(size)) return crewNames.length;
  return Math.min(MAX_CREW_SIZE, Math.max(MIN_CREW_SIZE, size));
}
function setupCrewDraftFromMember(member) {
  return {
    name: member.name,
    ...Object.fromEntries(
      SETUP_CREW_TRAIT_FIELDS.map(({ field }) => [field, Boolean(member[field])])
    )
  };
}
function normalizedSetupCrewName(value) {
  return typeof value === 'string' ? value.trim() : '';
}
function setupCrewForValidation(draft) {
  const crew = draft && Array.isArray(draft.crew) ? draft.crew : [];
  const crewSize = clampSetupCrewSize(draft?.crewSize ?? (crew.length || crewNames.length));
  return Array.from(
    { length: crewSize },
    (_, index) => crew[index] || { name: defaultCrewName(index) }
  );
}
function setupCrewNameValidationErrors(draft) {
  const seenNames = new Map();
  const errors = [];
  setupCrewForValidation(draft).forEach((character, index) => {
    const label = `Crew ${index + 1}`;
    const name = normalizedSetupCrewName(character.name);
    if (!name) {
      errors.push(`${label} name is required.`);
      return;
    }
    if (name.length > CREW_NAME_MAX_LENGTH) {
      errors.push(`${label} name must be ${CREW_NAME_MAX_LENGTH} characters or fewer.`);
    }
    const duplicateKey = name.toLocaleLowerCase();
    if (seenNames.has(duplicateKey)) {
      errors.push(`${label} name duplicates ${seenNames.get(duplicateKey)}.`);
      return;
    }
    seenNames.set(duplicateKey, label);
  });
  return errors;
}
function setupShipNameValidationErrors(draft) {
  const name = normalizedSetupShipName(draft?.shipName);
  const errors = [];
  if (!name) errors.push('Ship name is required.');
  if (name.length > SHIP_NAME_MAX_LENGTH) {
    errors.push(`Ship name must be ${SHIP_NAME_MAX_LENGTH} characters or fewer.`);
  }
  return errors;
}
function setupValidationErrors(draft) {
  return [...setupShipNameValidationErrors(draft), ...setupCrewNameValidationErrors(draft)];
}
function setupDraftIsValid(draft) {
  return setupValidationErrors(draft).length === 0;
}
function defaultCrewName(index) {
  return crewNames[index] || `Player ${index + 1}`;
}
function defaultCrewMember(index, explicitName = defaultCrewName(index)) {
  return {
    name: explicitName,
    labor: 0,
    exhaustion: 0,
    lastAction: '',
    sailorPirateBackground: defaultSailorPirateCrew.has(explicitName),
    fishermanBackground: false,
    waterVehiclesProficiency: false,
    navigatorToolsProficiency: false,
    cartographerToolsProficiency: false
  };
}
function clampCrewSize(size) {
  return Math.max(MIN_CREW_SIZE, Math.min(MAX_CREW_SIZE, Number(size) || crewNames.length));
}
function uniqueCrewName(baseName) {
  const existingNames = new Set((state.crew || []).map((character) => character.name));
  if (!existingNames.has(baseName)) return baseName;
  let suffix = 2;
  while (existingNames.has(`${baseName} ${suffix}`)) suffix += 1;
  return `${baseName} ${suffix}`;
}
function totalIngress() {
  return Number(state.minIngress) + Number(state.activeLeaks);
}
function activeLeaksSeverityClass(value = state.activeLeaks) {
  const leaks = Number(value || 0);
  if (leaks <= 0) return 'good';
  if (leaks <= 2) return 'warn';
  return 'danger';
}
function totalIngressSeverityClass(total = totalIngress(), minimum = state.minIngress) {
  const overMinimum = Number(total || 0) - Number(minimum || 0);
  if (overMinimum <= 0) return 'good';
  if (overMinimum === 1) return 'warn';
  return 'danger';
}
function actionById(id) {
  return actions.find((a) => a.id === id);
}
function crewByName(name) {
  return state.crew.find((c) => c.name === name);
}
function hasCondition(name) {
  return state.conditions.some((c) => c.name === name && c.turns > 0);
}
function mastFunctional() {
  return ['Working', 'Repaired'].includes(state.mastStatus);
}
function rudderFunctional() {
  return ['Working', 'Repaired'].includes(state.rudderStatus);
}
function canUseNormalHelm() {
  return mastFunctional() && rudderFunctional();
}
function canTravel() {
  return canUseNormalHelm();
}
function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}
function clampCourseMeter(value) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : DEFAULT_COURSE_METER;
  return clampNumber(Math.round(numeric), COURSE_METER_MIN, COURSE_METER_MAX);
}
function daysToTravelTicks(days) {
  return Math.max(0, Math.round(Number(days || 0) * TRAVEL_TICKS_PER_DAY));
}
function travelDaysFromTicks(ticks = state.travelTicks) {
  return Number(ticks || 0) / TRAVEL_TICKS_PER_DAY;
}
function playerTravelDaysFromTicks(ticks = state.travelTicks) {
  return Math.round(travelDaysFromTicks(ticks) * 2) / 2;
}
function syncTravelDaysFromTicks() {
  state.travel = travelDaysFromTicks();
}
function courseStateForMeter(meter = state.courseMeter) {
  const score = clampCourseMeter(meter);
  if (score >= 10) return { name: 'True Course', deltaTicks: -2, className: 'good' };
  if (score >= 7) return { name: 'Drifting', deltaTicks: -1, className: 'warn' };
  if (score >= 4) return { name: 'Off Course', deltaTicks: 0, className: 'warn' };
  return { name: 'Lost', deltaTicks: 1, className: 'danger' };
}
function worseCourseStateName(courseStateName) {
  const order = ['True Course', 'Drifting', 'Off Course', 'Lost'];
  const index = order.indexOf(courseStateName);
  return order[Math.min(order.length - 1, Math.max(0, index) + 1)];
}
function betterCourseStateName(courseStateName) {
  const order = ['True Course', 'Drifting', 'Off Course', 'Lost'];
  const index = order.indexOf(courseStateName);
  return order[Math.max(0, index - 1)];
}
function courseStateTravelDeltaTicks(courseStateName) {
  return (
    {
      'True Course': -2,
      Drifting: -1,
      'Off Course': 0,
      Lost: 1
    }[courseStateName] ?? 0
  );
}
function randomCourseStateName() {
  const courseStates = ['True Course', 'Drifting', 'Off Course', 'Lost'];
  return courseStates[Math.floor(Math.random() * courseStates.length)];
}
function applyTravelTicks(deltaTicks) {
  state.travelTicks = Math.max(0, Number(state.travelTicks || 0) + Number(deltaTicks || 0));
  syncTravelDaysFromTicks();
}
function formatTravelDays(ticks = state.travelTicks) {
  return `${formatNumber(travelDaysFromTicks(ticks))}d`;
}
function signedTicks(value) {
  return `${Number(value) > 0 ? '+' : ''}${Number(value || 0)}`;
}
function applyCourseMeterChange(amount, reason) {
  const before = clampCourseMeter(state.courseMeter);
  state.courseMeter = clampCourseMeter(before + Number(amount || 0));
  if (state.courseMeter !== before || amount)
    log(`${reason}: Course Meter changed from ${before} to ${state.courseMeter}.`);
}
function raiseCourseMeterOneState(reason) {
  const currentState = courseStateForMeter();
  const betterState = betterCourseStateName(currentState.name);
  if (betterState === currentState.name) {
    log(`${reason}: Course Meter is already on True Course.`);
    return;
  }
  const minimumForState = {
    'True Course': 10,
    Drifting: 7,
    'Off Course': 4,
    Lost: 0
  }[betterState];
  const before = clampCourseMeter(state.courseMeter);
  state.courseMeter = clampCourseMeter(Math.max(before, minimumForState));
  log(
    `${reason}: Course improved from ${currentState.name} to ${betterState}. Course Meter changed from ${before} to ${state.courseMeter}.`
  );
}
function decayCourseMeter() {
  if (state.navigateResolvedThisTurn) {
    log(
      'End-of-turn Course Meter decay was skipped because Navigate / Study Map was resolved this turn.'
    );
    return;
  }
  const before = clampCourseMeter(state.courseMeter);
  state.courseMeter = Math.max(COURSE_METER_MIN, before - 1);
  if (state.courseMeter !== before)
    log(
      `End-of-turn Course Meter decay changed Course Meter from ${before} to ${state.courseMeter}.`
    );
}
function applyHelmTravelOutcome(outcome) {
  const currentState = courseStateForMeter();
  const appliedStateName =
    outcome === 'helmCriticalSuccess'
      ? betterCourseStateName(currentState.name)
      : outcome === 'helmSuccess'
        ? currentState.name
        : worseCourseStateName(currentState.name);
  const deltaTicks = courseStateTravelDeltaTicks(appliedStateName);
  const beforeTicks = Number(state.travelTicks || 0);
  if (outcome === 'helmCriticalSuccess') raiseCourseMeterOneState('Critical helm success');
  if (outcome === 'helmCriticalFailure') applyCourseMeterChange(-1, 'Critical helm failure');
  applyTravelTicks(deltaTicks);
  log(
    `Helm used ${appliedStateName}; Travel Remaining changed from ${formatTravelDays(beforeTicks)} (${beforeTicks} ticks) to ${formatTravelDays()} (${state.travelTicks} ticks).`
  );
}
function applyAutomaticHelmSystemOutcome(name) {
  if (!mastFunctional()) {
    log(`Mast broken: ${name} manned the helm, but the Marrowwind could not make sail progress.`);
    return true;
  }
  if (!rudderFunctional()) {
    const appliedStateName = randomCourseStateName();
    const deltaTicks = courseStateTravelDeltaTicks(appliedStateName);
    const beforeTicks = Number(state.travelTicks || 0);
    applyTravelTicks(deltaTicks);
    log(
      `Rudder broken: ${name} wrestled the helm, but the Marrowwind answered unpredictably. Random applied state: ${appliedStateName}. Travel changed by ${signedTicks(deltaTicks)} tick${Math.abs(deltaTicks) === 1 ? '' : 's'} from ${formatTravelDays(beforeTicks)} (${beforeTicks} ticks) to ${formatTravelDays()} (${state.travelTicks} ticks).`
    );
    return true;
  }
  return false;
}
function applyNavigateResult(outcomeId) {
  const changes = {
    navigateCriticalFailure: 0,
    navigateFailure: 2,
    navigateSuccess: 4,
    navigateCriticalSuccess: 5
  };
  state.navigateResolvedThisTurn = true;
  applyCourseMeterChange(changes[outcomeId] ?? 0, 'Navigate / Study Map');
}
function valueOf(value, fallback) {
  return typeof value === 'function' ? value(state) : (value ?? fallback);
}
function safeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Fog affects only visibility-dependent checks. These helpers keep that wording consistent.
function denseFogActive() {
  return hasCondition('Dense Fog');
}
function hasHelmAdvantage(name) {
  const character = crewByName(name);
  return Boolean(character?.sailorPirateBackground || character?.waterVehiclesProficiency);
}
function advantageSourceText(name, type) {
  const character = crewByName(name);
  if (!character) return '';
  const sources = [];
  if (type === 'helm') {
    if (character.sailorPirateBackground) sources.push('Sailor/Pirate background');
    if (character.waterVehiclesProficiency) sources.push('Water Vehicles proficiency');
  }
  if (type === 'navigate') {
    if (character.navigatorToolsProficiency) sources.push("Navigator's Tools proficiency");
    if (character.cartographerToolsProficiency) sources.push("Cartographer's Tools proficiency");
  }
  return sources.length
    ? ` This character rolls with advantage from ${sources.join(' and ')}.`
    : '';
}
function fogHelmText(name) {
  return denseFogActive()
    ? hasHelmAdvantage(name)
      ? " Dense Fog disadvantage is canceled by this character's helm advantage, so roll normally."
      : ' Dense Fog: roll this Survival check at disadvantage.'
    : '';
}
function hasFishermanBackground(name) {
  return Boolean(crewByName(name)?.fishermanBackground);
}
function fishingAdvantageText(names, eventAdvantageText = '') {
  const actors = names.filter(Boolean);
  const fisherfolk = actors.filter(hasFishermanBackground);
  const parts = [];
  if (eventAdvantageText) parts.push(eventAdvantageText);
  if (fisherfolk.length) {
    parts.push(
      `${fisherfolk.join(', ')} ${fisherfolk.length === 1 ? 'rolls' : 'roll'} with advantage from Fisherman background.`
    );
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}
function fishingFogText(names, eventAdvantageActive = false) {
  if (!denseFogActive()) return '';
  const actors = names.filter(Boolean);
  const fisherfolk = actors.filter(hasFishermanBackground);
  if (eventAdvantageActive || (actors.length && fisherfolk.length === actors.length)) {
    return ' Dense Fog disadvantage is canceled by fishing advantage, so roll normally.';
  }
  if (fisherfolk.length) {
    return ` Dense Fog: ${fisherfolk.join(', ')} ${fisherfolk.length === 1 ? 'offsets' : 'offset'} fog with Fisherman background; non-fisherman fishing rolls are at disadvantage.`;
  }
  return ' Dense Fog: roll this fishing check at disadvantage.';
}
function fogFloatingWreckageText() {
  return denseFogActive()
    ? ' Dense Fog: this check is at disadvantage. If the wreckage is farther than 30 feet away, it cannot be attempted unless another cue reveals it.'
    : '';
}
function fogLargeShadowText() {
  return denseFogActive()
    ? ' Dense Fog: harpoon attacks/checks are at disadvantage if the shadow is within 30 feet. If farther than 30 feet away, it cannot be targeted normally unless revealed by sound, light, magic, or another clear cue.'
    : '';
}
function fogPackOfGullsText() {
  return denseFogActive()
    ? ' Dense Fog: ranged attacks against gulls are at disadvantage unless the gulls are actively swarming the attacker. Gulls beyond 30 feet cannot be targeted normally.'
    : '';
}
function hasActiveOngoingForAction(actionId) {
  return state.ongoing.some((o) => o.status === 'active' && o.actionId === actionId);
}
function selectedForAction(actionId) {
  return state.crew.filter((c) => state.plannedActions[c.name] === actionId).map((c) => c.name);
}
function selectedCount(actionId) {
  return selectedForAction(actionId).length;
}
function boostActive(action) {
  return action.boostGroupSize && selectedForAction(action.id).length >= action.boostGroupSize;
}
function actionDuration(action, name = '') {
  const base = boostActive(action)
    ? Number(valueOf(action.boostedDuration, 1))
    : Number(valueOf(action.duration, 1));
  return base + belowDeckDurationPenalty(action, name);
}
function actionLaborCost(action, name = '') {
  return Number(valueOf(action.labor, 0)) + belowDeckLaborPenalty(action, name);
}
function actionIsBelowDeck(action, name = '') {
  if (action?.belowDeck) return true;
  return Boolean(action?.deckChoice && name && state.salvageLumberBelowDeck?.[name]);
}
function belowDeckDurationPenalty(action, name = '') {
  return actionIsBelowDeck(action, name) &&
    !action?.noFloodedExtraTurn &&
    Number(state.waterLevel) >= 5
    ? 1
    : 0;
}
function belowDeckLaborPenalty(action, name = '') {
  return actionIsBelowDeck(action, name) && Number(state.waterLevel) >= 10 ? 1 : 0;
}
function actionActors(name, action) {
  if (action.groupSize || boostActive(action)) return selectedForAction(action.id);
  return [name];
}

// Pull values from the editable support panels before applying manual controls or phase changes.
