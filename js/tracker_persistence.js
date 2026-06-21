// Save/load, player-state publishing, validation, migration, and labels.
const IMPORT_MAX_BYTES = 1024 * 1024;
const UNSAFE_IMPORT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const IMPORT_NUMERIC_FIELDS = [
  'version',
  'day',
  'turn',
  'travel',
  'travelTicks',
  'courseMeter',
  'waterLevel',
  'minIngress',
  'activeLeaks',
  'food',
  'freshWater',
  'repairMaterials',
  'salvagedTimber',
  'noMealStreak',
  'turnStep',
  'waterTravelPenalty',
  'overtimeTurnCount'
];
const IMPORT_OBJECT_FIELDS = [
  'playerKnowledge',
  'waterKnowledge',
  'plannedActions',
  'confirmedActions',
  'salvageLumberBelowDeck',
  'consumedMeals',
  'appliedScriptedEvents',
  'restMealStatus',
  'turnLedger',
  'startedGroups',
  'overtimeExhaustion'
];
const IMPORT_ARRAY_FIELDS = [
  'crew',
  'conditions',
  'ongoing',
  'pendingChecks',
  'deferredCompletions'
];
const IMPORT_STATUS_ENUMS = {
  mastStatus: ['Working', 'Broken', 'Repaired'],
  rudderStatus: ['Working', 'Broken', 'Repaired'],
  pumpStatus: ['Working', 'Jammed'],
  netStatus: ['Ready', 'Tangled'],
  riggingStatus: ['Intact', 'Broken']
};
const IMPORT_PROMPT_PHASES = ['preAction', 'action', 'water'];
const IMPORT_PROMPT_TYPES = ['manual', 'check', 'save'];
const IMPORT_PROMPT_STATUSES = ['pending', 'resolved'];
const IMPORT_WORK_STATUSES = ['active', 'pending', 'resolved', 'cancelled'];
const IMPORT_TEXT_MAX_LENGTH = 5000;
function saveState() {
  syncFromInputs();
  saveStateSnapshot();
  log('Saved the tracker state.');
  render();
}

// Browser export creates a portable backup file in the user's normal download location.
function exportState() {
  syncFromInputs();
  state.version = APP_VERSION;
  state.shipName = normalizedShipName(state.shipName);
  const exportState = structuredClone(state);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `marrowwind-tracker-day-${state.day}-turn-${state.turn}-${timestamp}.json`;
  const blob = new Blob([JSON.stringify(exportState, null, 2)], {
    type: 'application/json'
  });
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

function chooseImportFile() {
  const input = q('importFile');
  if (!input) return;
  input.value = '';
  input.click();
}

function readSavedVoyageState() {
  const raw = localStorage.getItem('openSeaTracker') || localStorage.getItem('openSeaTrackerDraft');
  if (!raw) return null;
  try {
    return normalizeImportedState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function enterTrackerMode() {
  appMode = 'tracker';
  if (typeof document !== 'undefined') document.body?.classList.remove('landing-active');
}

function resumeCurrentVoyage() {
  const savedState = readSavedVoyageState();
  if (!savedState) {
    renderLandingScreen();
    return;
  }
  clearActionCommitSnapshot();
  undoStack = [];
  state = savedState;
  log('Resumed the current voyage from this browser.');
  enterTrackerMode();
  render();
}

function importSavedVoyage() {
  chooseImportFile();
}

// Import restores a previously exported JSON state, then runs migration for compatibility.
function importStateFile(file) {
  if (!file) return;
  if (Number(file.size || 0) > IMPORT_MAX_BYTES) {
    alert(
      `Import failed: ${file.name || 'Selected file'} is too large. Maximum supported size is ${formatNumber(IMPORT_MAX_BYTES / 1024)} KB.`
    );
    return;
  }
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const importedState = parseImportedStateJson(event.target.result);
      const normalizedState = normalizeImportedState(importedState);
      pushUndo('Imported tracker state');
      clearActionCommitSnapshot();
      state = normalizedState;
      log(`Imported tracker state from ${file.name}.`);
      saveStateSnapshot();
      enterTrackerMode();
      render();
    } catch (error) {
      alert(`Import failed: ${error.message}`);
    }
  };
  reader.onerror = () => alert('Import failed: the file could not be read.');
  reader.readAsText(file);
}

function parseImportedStateJson(rawText) {
  const importedState = JSON.parse(String(rawText || ''));
  validateImportedStatePayload(importedState);
  return importedState;
}

function normalizeImportedState(importedState) {
  validateImportedStatePayload(importedState);
  const previousState = state;
  state = structuredClone(importedState);
  try {
    migrateState();
    validateMigratedImportState(state);
    return structuredClone(state);
  } finally {
    state = previousState;
  }
}

function validateImportedStatePayload(importedState) {
  const errors = [];
  if (!isPlainImportObject(importedState)) {
    throw new Error('Import file did not contain a tracker state object.');
  }
  collectUnsafeImportKeys(importedState, 'state', errors);
  IMPORT_NUMERIC_FIELDS.forEach((field) => {
    if (
      Object.prototype.hasOwnProperty.call(importedState, field) &&
      !isFiniteNumericImportValue(importedState[field])
    ) {
      errors.push(`${fieldLabel(field)} must be a finite number.`);
    }
  });
  IMPORT_OBJECT_FIELDS.forEach((field) => {
    if (
      Object.prototype.hasOwnProperty.call(importedState, field) &&
      !isPlainImportObject(importedState[field])
    ) {
      errors.push(`${fieldLabel(field)} must be an object.`);
    }
  });
  IMPORT_ARRAY_FIELDS.forEach((field) => {
    if (
      Object.prototype.hasOwnProperty.call(importedState, field) &&
      !Array.isArray(importedState[field])
    ) {
      errors.push(`${fieldLabel(field)} must be an array.`);
    }
  });
  Object.entries(IMPORT_STATUS_ENUMS).forEach(([field, allowed]) => {
    if (
      Object.prototype.hasOwnProperty.call(importedState, field) &&
      !allowed.includes(importedState[field])
    ) {
      errors.push(`${fieldLabel(field)} has unsupported status "${importedState[field]}".`);
    }
  });
  validateImportedRanges(importedState, errors);
  validateImportedCrewPayload(importedState.crew, errors);
  validateImportedObjectMaps(importedState, errors);
  validateImportedKnowledgePayloads(importedState, errors);
  validateImportedConditionsPayload(importedState.conditions, errors);
  validateImportedWorkItemsPayload(importedState.ongoing, 'Ongoing work', errors);
  validateImportedWorkItemsPayload(
    importedState.deferredCompletions,
    'Deferred completion',
    errors
  );
  validateImportedPendingChecksPayload(importedState.pendingChecks, errors);
  validateImportedTurnLedger(importedState.turnLedger, errors);
  validateImportedRestMealStatus(importedState.restMealStatus, errors);
  validateImportedStartedGroups(importedState.startedGroups, errors);
  validateImportedText(importedState.shipName, 'Ship name', errors, {
    maxLength: SHIP_NAME_MAX_LENGTH
  });
  validateImportedBoolean(importedState.setupComplete, 'Setup complete flag', errors);
  if (errors.length) {
    throw new Error(`Import validation failed: ${errors.slice(0, 5).join(' ')}`);
  }
  return true;
}

function validateMigratedImportState(candidate) {
  const errors = [];
  const numericFields = [
    'day',
    'turn',
    'travel',
    'travelTicks',
    'courseMeter',
    'waterLevel',
    'minIngress',
    'activeLeaks',
    'food',
    'freshWater',
    'repairMaterials',
    'salvagedTimber',
    'turnStep',
    'waterTravelPenalty'
  ];
  numericFields.forEach((field) => {
    if (!Number.isFinite(Number(candidate[field])))
      errors.push(`${fieldLabel(field)} is not a finite number after migration.`);
  });
  if (
    !Array.isArray(candidate.crew) ||
    candidate.crew.length < MIN_CREW_SIZE ||
    candidate.crew.length > MAX_CREW_SIZE
  ) {
    errors.push(`Crew size must be between ${MIN_CREW_SIZE} and ${MAX_CREW_SIZE}.`);
  }
  if (
    typeof candidate.shipName !== 'string' ||
    !candidate.shipName.trim() ||
    candidate.shipName.length > SHIP_NAME_MAX_LENGTH
  ) {
    errors.push('Ship name is invalid after migration.');
  }
  const actionIds = new Set(actions.map((action) => action.id));
  Object.values(candidate.plannedActions || {}).forEach((actionId) => {
    if (!actionIds.has(actionId)) errors.push(`Unknown planned action "${actionId}".`);
  });
  Object.values(candidate.confirmedActions || {}).forEach((actionId) => {
    if (!actionIds.has(actionId)) errors.push(`Unknown confirmed action "${actionId}".`);
  });
  [...(candidate.ongoing || []), ...(candidate.deferredCompletions || [])].forEach((item) => {
    if (item?.actionId && !actionIds.has(item.actionId))
      errors.push(`Unknown ongoing action "${item.actionId}".`);
  });
  if (errors.length) {
    throw new Error(`Import migration failed: ${errors.slice(0, 5).join(' ')}`);
  }
  return true;
}

function isPlainImportObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumericImportValue(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string' || !value.trim()) return false;
  return Number.isFinite(Number(value));
}

function collectUnsafeImportKeys(value, path, errors, depth = 0) {
  if (!value || typeof value !== 'object') return;
  if (depth > 30) {
    errors.push(`${path} is too deeply nested.`);
    return;
  }
  Object.keys(value).forEach((key) => {
    if (UNSAFE_IMPORT_KEYS.has(key)) {
      errors.push(`Unsafe key "${key}" at ${path}.`);
      return;
    }
    if (errors.length >= 10) return;
    collectUnsafeImportKeys(value[key], `${path}.${key}`, errors, depth + 1);
  });
}

function hasImportField(object, field) {
  return Object.prototype.hasOwnProperty.call(object, field);
}

function validateImportedRanges(importedState, errors) {
  [
    ['version', 1],
    ['day', 1],
    ['turn', 1],
    ['travel', 0],
    ['travelTicks', 0],
    ['waterLevel', 0],
    ['minIngress', 0],
    ['activeLeaks', 0],
    ['food', 0],
    ['freshWater', 0],
    ['repairMaterials', 0],
    ['salvagedTimber', 0],
    ['noMealStreak', 0],
    ['waterTravelPenalty', 0],
    ['overtimeTurnCount', 0]
  ].forEach(([field, min]) =>
    validateImportedNumberRange(importedState, field, min, Infinity, errors)
  );
  validateImportedNumberRange(
    importedState,
    'courseMeter',
    COURSE_METER_MIN,
    COURSE_METER_MAX,
    errors
  );
  validateImportedNumberRange(importedState, 'turnStep', 1, turnSteps.length, errors);
}

function validateImportedNumberRange(object, field, min, max, errors) {
  if (!hasImportField(object, field) || !isFiniteNumericImportValue(object[field])) return;
  const value = Number(object[field]);
  if (value < min || value > max) {
    errors.push(
      Number.isFinite(max)
        ? `${fieldLabel(field)} must be between ${formatNumber(min)} and ${formatNumber(max)}.`
        : `${fieldLabel(field)} must be ${formatNumber(min)} or greater.`
    );
  }
}

function validateImportedText(
  value,
  label,
  errors,
  { required = false, maxLength = IMPORT_TEXT_MAX_LENGTH } = {}
) {
  if (value === undefined || value === null) {
    if (required) errors.push(`${label} is required.`);
    return;
  }
  if (typeof value !== 'string') {
    errors.push(`${label} must be text.`);
    return;
  }
  if (value.length > maxLength) errors.push(`${label} is too long.`);
}

function validateImportedBoolean(value, label, errors) {
  if (value !== undefined && typeof value !== 'boolean')
    errors.push(`${label} must be true or false.`);
}

function validateImportedStringArray(value, label, errors, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) errors.push(`${label} is required.`);
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array.`);
    return;
  }
  value.forEach((entry, index) =>
    validateImportedText(entry, `${label} entry ${index + 1}`, errors)
  );
}

function validateImportedEnum(value, label, allowed, errors) {
  if (value !== undefined && !allowed.includes(value))
    errors.push(`${label} has unsupported value "${value}".`);
}

function validateImportedCrewPayload(crew, errors) {
  if (crew === undefined) return;
  if (!Array.isArray(crew)) return;
  if (crew.length < MIN_CREW_SIZE || crew.length > MAX_CREW_SIZE) {
    errors.push(`Crew size must be between ${MIN_CREW_SIZE} and ${MAX_CREW_SIZE}.`);
  }
  crew.forEach((character, index) => {
    if (!isPlainImportObject(character)) {
      errors.push(`Crew entry ${index + 1} must be an object.`);
      return;
    }
    validateImportedText(character.name, `Crew entry ${index + 1} name`, errors);
    validateImportedText(character.lastAction, `Crew entry ${index + 1} last action`, errors);
    ['labor', 'exhaustion'].forEach((field) => {
      if (character[field] !== undefined && !isFiniteNumericImportValue(character[field]))
        errors.push(`Crew entry ${index + 1} ${fieldLabel(field)} must be a finite number.`);
      if (
        character[field] !== undefined &&
        isFiniteNumericImportValue(character[field]) &&
        Number(character[field]) < 0
      )
        errors.push(`Crew entry ${index + 1} ${fieldLabel(field)} must be 0 or greater.`);
    });
    [
      'sailorPirateBackground',
      'sailorBackground',
      'fishermanBackground',
      'waterVehiclesProficiency',
      'navigatorToolsProficiency',
      'cartographerToolsProficiency'
    ].forEach((field) =>
      validateImportedBoolean(
        character[field],
        `Crew entry ${index + 1} ${fieldLabel(field)}`,
        errors
      )
    );
  });
}

function validateImportedObjectMaps(importedState, errors) {
  ['plannedActions', 'confirmedActions', 'salvageLumberBelowDeck', 'overtimeExhaustion'].forEach(
    (field) => {
      const map = importedState[field];
      if (!isPlainImportObject(map)) return;
      Object.entries(map).forEach(([key, value]) => {
        if (typeof key !== 'string') errors.push(`${fieldLabel(field)} contains a non-text key.`);
        if (field === 'overtimeExhaustion' && !isFiniteNumericImportValue(value))
          errors.push(`${fieldLabel(field)} value for ${key} must be numeric.`);
        if (field === 'salvageLumberBelowDeck' && typeof value !== 'boolean')
          errors.push(`${fieldLabel(field)} value for ${key} must be true or false.`);
        if (
          field !== 'overtimeExhaustion' &&
          field !== 'salvageLumberBelowDeck' &&
          typeof value !== 'string'
        )
          errors.push(`${fieldLabel(field)} value for ${key} must be an action id.`);
      });
    }
  );
}

function validateImportedKnowledgePayloads(importedState, errors) {
  if (isPlainImportObject(importedState.playerKnowledge)) {
    Object.entries(importedState.playerKnowledge).forEach(([key, value]) => {
      validateImportedText(key, 'Player knowledge key', errors);
      if (value !== null && typeof value !== 'string' && !isFiniteNumericImportValue(value)) {
        errors.push(`Player knowledge value for ${key} must be text, numeric, or null.`);
      }
    });
  }
  if (isPlainImportObject(importedState.waterKnowledge)) {
    validateImportedText(importedState.waterKnowledge.turnKey, 'Water knowledge turn key', errors);
    validateImportedText(
      importedState.waterKnowledge.lastKnownTurnKey,
      'Water knowledge last known turn key',
      errors
    );
    validateImportedBoolean(
      importedState.waterKnowledge.knownThisTurn,
      'Water knowledge known-this-turn flag',
      errors
    );
    validateImportedBoolean(
      importedState.waterKnowledge.exactKnownThisTurn,
      'Water knowledge exact-known-this-turn flag',
      errors
    );
    if (importedState.waterKnowledge.streak !== undefined) {
      if (!isFiniteNumericImportValue(importedState.waterKnowledge.streak))
        errors.push('Water knowledge streak must be numeric.');
      else if (Number(importedState.waterKnowledge.streak) < 0)
        errors.push('Water knowledge streak must be 0 or greater.');
    }
  }
}

function validateImportedConditionsPayload(conditions, errors) {
  if (conditions === undefined) return;
  if (!Array.isArray(conditions)) return;
  conditions.forEach((condition, index) => {
    if (!isPlainImportObject(condition)) {
      errors.push(`Condition ${index + 1} must be an object.`);
      return;
    }
    validateImportedText(condition.name, `Condition ${index + 1} name`, errors, { required: true });
    if (condition.turns === undefined || !isFiniteNumericImportValue(condition.turns)) {
      errors.push(`Condition ${index + 1} turns must be a finite number.`);
    } else if (Number(condition.turns) < 0) {
      errors.push(`Condition ${index + 1} turns must be 0 or greater.`);
    }
  });
}

function validateImportedWorkItemsPayload(items, label, errors) {
  if (items === undefined) return;
  if (!Array.isArray(items)) return;
  items.forEach((item, index) => {
    const itemLabel = `${label} ${index + 1}`;
    if (!isPlainImportObject(item)) {
      errors.push(`${itemLabel} must be an object.`);
      return;
    }
    validateImportedText(item.id, `${itemLabel} id`, errors);
    validateImportedText(item.actionId, `${itemLabel} action id`, errors, {
      required: true
    });
    validateImportedStringArray(item.actors, `${itemLabel} actors`, errors, {
      required: true
    });
    validateImportedEnum(item.status, `${itemLabel} status`, IMPORT_WORK_STATUSES, errors);
    ['remaining', 'createdDay', 'createdTurn'].forEach((field) => {
      if (item[field] !== undefined && !isFiniteNumericImportValue(item[field]))
        errors.push(`${itemLabel} ${fieldLabel(field)} must be a finite number.`);
      if (
        item[field] !== undefined &&
        isFiniteNumericImportValue(item[field]) &&
        Number(item[field]) < 0
      )
        errors.push(`${itemLabel} ${fieldLabel(field)} must be 0 or greater.`);
    });
  });
}

function validateImportedPendingChecksPayload(pendingChecks, errors) {
  if (pendingChecks === undefined) return;
  if (!Array.isArray(pendingChecks)) return;
  pendingChecks.forEach((prompt, index) => {
    const promptLabel = `Pending prompt ${index + 1}`;
    if (!isPlainImportObject(prompt)) {
      errors.push(`${promptLabel} must be an object.`);
      return;
    }
    validateImportedText(prompt.id, `${promptLabel} id`, errors, {
      required: true
    });
    validateImportedText(prompt.character, `${promptLabel} character`, errors);
    validateImportedText(prompt.title, `${promptLabel} title`, errors, {
      required: true
    });
    validateImportedText(prompt.detail, `${promptLabel} detail`, errors, {
      required: true
    });
    validateImportedText(prompt.ability, `${promptLabel} ability`, errors);
    validateImportedText(prompt.effect, `${promptLabel} effect`, errors);
    validateImportedText(prompt.emphasis, `${promptLabel} emphasis`, errors);
    validateImportedEnum(prompt.phase, `${promptLabel} phase`, IMPORT_PROMPT_PHASES, errors);
    validateImportedEnum(prompt.type, `${promptLabel} type`, IMPORT_PROMPT_TYPES, errors);
    validateImportedEnum(prompt.status, `${promptLabel} status`, IMPORT_PROMPT_STATUSES, errors);
    if (
      prompt.dc !== undefined &&
      (!isFiniteNumericImportValue(prompt.dc) || Number(prompt.dc) < 0)
    )
      errors.push(`${promptLabel} DC must be a finite number 0 or greater.`);
    ['reveals', 'successReveals', 'failureReveals'].forEach((field) =>
      validateImportedStringArray(prompt[field], `${promptLabel} ${fieldLabel(field)}`, errors)
    );
    if (prompt.outcomes !== undefined && prompt.outcomes !== null) {
      if (!Array.isArray(prompt.outcomes)) {
        errors.push(`${promptLabel} outcomes must be an array.`);
      } else {
        prompt.outcomes.forEach((outcome, outcomeIndex) => {
          if (!isPlainImportObject(outcome)) {
            errors.push(`${promptLabel} outcome ${outcomeIndex + 1} must be an object.`);
            return;
          }
          validateImportedText(
            outcome.id,
            `${promptLabel} outcome ${outcomeIndex + 1} id`,
            errors,
            { required: true }
          );
          validateImportedText(
            outcome.label,
            `${promptLabel} outcome ${outcomeIndex + 1} label`,
            errors,
            { required: true }
          );
          validateImportedText(
            outcome.className,
            `${promptLabel} outcome ${outcomeIndex + 1} class`,
            errors
          );
        });
      }
    }
  });
}

function validateImportedTurnLedger(turnLedger, errors) {
  if (!isPlainImportObject(turnLedger)) return;
  ['pumping', 'buckets'].forEach((field) => {
    if (turnLedger[field] !== undefined && !isFiniteNumericImportValue(turnLedger[field]))
      errors.push(`Turn ledger ${fieldLabel(field)} must be numeric.`);
    if (
      turnLedger[field] !== undefined &&
      isFiniteNumericImportValue(turnLedger[field]) &&
      Number(turnLedger[field]) < 0
    )
      errors.push(`Turn ledger ${fieldLabel(field)} must be 0 or greater.`);
  });
}

function validateImportedRestMealStatus(restMealStatus, errors) {
  if (!isPlainImportObject(restMealStatus)) return;
  validateImportedBoolean(restMealStatus.pending, 'Rest meal status pending flag', errors);
  ['dinnerAvailable', 'breakfastAvailable'].forEach((field) => {
    if (
      restMealStatus[field] !== undefined &&
      restMealStatus[field] !== null &&
      typeof restMealStatus[field] !== 'boolean'
    ) {
      errors.push(`Rest meal status ${field} must be true, false, or null.`);
    }
  });
  ['dinnerKey', 'breakfastKey'].forEach((field) =>
    validateImportedText(restMealStatus[field], `Rest meal status ${field}`, errors)
  );
}

function validateImportedStartedGroups(startedGroups, errors) {
  if (!isPlainImportObject(startedGroups)) return;
  Object.entries(startedGroups).forEach(([actionId, actors]) => {
    validateImportedText(actionId, 'Started group action id', errors);
    validateImportedStringArray(actors, `Started group ${actionId}`, errors);
  });
}

function saveStateSnapshot() {
  state.version = APP_VERSION;
  state.shipName = normalizedShipName(state.shipName);
  syncTravelDaysFromTicks();
  localStorage.setItem('openSeaTracker', JSON.stringify(state));
}

// Publish a filtered state object for player_view.html.
// Anything not included here is intentionally hidden from the player-facing screen.
function publishPlayerState() {
  initializeWaterKnowledgeForCurrentTurn();
  const snapshot = {
    version: APP_VERSION,
    updatedAt: Date.now(),
    shipName: normalizedShipName(state.shipName),
    day: state.day,
    turn: state.turn,
    travel: playerKnownValue('travel'),
    courseState: playerKnownValue('courseState'),
    waterLevel: playerKnownWaterLevel(),
    activeLeaks: state.activeLeaks,
    waterTravelPenalty: state.waterTravelPenalty || 0,
    totalIngress: playerKnownValue('totalIngress'),
    totalIngressSeverity: totalIngressSeverityClass(),
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
      .filter((effect) => !effect.dmOnly)
      .map((effect) => ({
        title: effect.title,
        detail: effect.detail,
        className: effect.className || ''
      })),
    ongoing: state.ongoing
      .filter((item) => item.status === 'active')
      .map((item) => ({
        name: actionById(item.actionId)?.name || item.actionId,
        actors: item.actors,
        remaining: item.remaining
      })),
    crew: state.crew.map((character) => ({
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

function playerCrewAction(name) {
  const plannedAction = actionById(state.plannedActions?.[name]);
  if (plannedAction) return plannedAction.name;
  return crewByName(name)?.lastAction || '';
}

function playerKnownValue(key) {
  const value = state.playerKnowledge?.[key];
  return {
    known: value !== null && value !== undefined,
    value: value ?? null
  };
}

// Below cargo hold, players only know the ship is safe unless the rod has been checked.
function playerKnownWaterLevel() {
  if (Number(state.waterLevel) >= 5) {
    return { known: true, value: Number(state.waterLevel), automatic: true };
  }
  const known = playerKnownValue('waterLevel');
  if (known.known && state.waterKnowledge?.exactKnownThisTurn) return known;
  return { known: false, value: null, safeBelowCargo: true };
}

function loadState() {
  const savedState = readSavedVoyageState();
  if (savedState) {
    pushUndo('Loaded saved state');
    clearActionCommitSnapshot();
    state = savedState;
    migrateState();
    enterTrackerMode();
    render();
  }
}

function resetState() {
  if (confirm('Reset tracker?')) {
    pushUndo('Reset tracker');
    clearActionCommitSnapshot();
    state = structuredClone(defaultState);
    enterTrackerMode();
    render();
  }
}

function runDevValidator() {
  const results = devValidationChecks();
  const box = q('devValidatorResults');
  if (!box) return;
  box.innerHTML = results
    .map(
      (result) =>
        `<div class="dev-validator-row ${result.pass ? 'pass' : 'fail'}">${result.pass ? 'PASS' : 'FAIL'}: ${h(result.label)}${result.detail ? ` - ${h(result.detail)}` : ''}</div>`
    )
    .join('');
}

function devValidationChecks() {
  const originalState = state;
  const results = [];
  const check = (label, pass, detail = '') => results.push({ label, pass: Boolean(pass), detail });
  const withState = (partial, callback) => {
    state = { ...structuredClone(defaultState), ...partial };
    migrateState();
    try {
      callback();
    } finally {
      state = originalState;
    }
  };

  check(
    'Initial defaults',
    Number(defaultState.travelTicks) === 44 &&
      Number(defaultState.travel) === 5.5 &&
      Number(defaultState.courseMeter) === 12 &&
      Number(defaultState.minIngress) === 1 &&
      Number(defaultState.activeLeaks) === 0 &&
      Number(defaultState.repairMaterials) === 4,
    'Travel 44 ticks/5.5 days, Course Meter 12, min ingress 1, leaks 0, repairs 4.'
  );
  check(
    'Action metadata loaded once',
    Array.isArray(ACTION_METADATA) &&
      ACTION_METADATA.length === actions.length &&
      ACTION_METADATA.every((action) => actionById(action.id)),
    `${ACTION_METADATA.length} metadata actions.`
  );
  check(
    'Player duplicate duration tables removed',
    typeof PLAYER_ACTION_BASE_DURATIONS === 'undefined' &&
      typeof PLAYER_FLOODED_EXTRA_TURN_ACTIONS === 'undefined',
    'Player view should use shared action metadata.'
  );
  withState({ crew: structuredClone(defaultState.crew).slice(0, MIN_CREW_SIZE) }, () => {
    check(
      'Crew migration allows minimum size',
      state.crew.length === MIN_CREW_SIZE,
      `got ${state.crew.length}`
    );
  });
  withState(
    {
      crew: [...structuredClone(defaultState.crew), defaultCrewMember(6, 'Player 7')]
    },
    () => {
      check(
        'Crew migration allows maximum size',
        state.crew.length === MAX_CREW_SIZE,
        `got ${state.crew.length}`
      );
    }
  );
  withState(
    {
      crew: Array.from({ length: MAX_CREW_SIZE + 1 }, (_, index) =>
        defaultCrewMember(index, `Crew ${index + 1}`)
      )
    },
    () => {
      check(
        'Crew migration clamps above maximum',
        state.crew.length === MAX_CREW_SIZE,
        `got ${state.crew.length}`
      );
    }
  );
  check(
    'Course Meter ranges',
    courseStateForMeter(12).name === 'True Course' &&
      courseStateForMeter(9).name === 'Drifting' &&
      courseStateForMeter(6).name === 'Off Course' &&
      courseStateForMeter(3).name === 'Lost'
  );
  check(
    'Travel tick conversion',
    daysToTravelTicks(5.5) === 44 && travelDaysFromTicks(1) === 0.125,
    `${daysToTravelTicks(5.5)} ticks for 5.5 days.`
  );
  check(
    'Player travel estimate rounds to half days',
    playerTravelDaysFromTicks(45) === 5.5 && playerTravelDaysFromTicks(46) === 6,
    `${playerTravelDaysFromTicks(45)}d and ${playerTravelDaysFromTicks(46)}d`
  );

  state = { travel: 4.75 };
  migrateState();
  check(
    'Old decimal travel migrates to ticks',
    state.travelTicks === 38 && state.travel === 4.75,
    `got ${state.travelTicks} ticks / ${state.travel} days`
  );
  state = originalState;

  withState({ courseMeter: 6, travelTicks: 45 }, () => {
    applyNavigateResult('navigateFailure');
    check('Navigate failure adds Course +2', state.courseMeter === 8, `got ${state.courseMeter}`);
    rememberPlayerKnowledge('courseState');
    rememberPlayerKnowledge('travel');
    check(
      'Navigate reveals resulting Course State',
      state.playerKnowledge.courseState === 'Drifting',
      `got ${state.playerKnowledge.courseState}`
    );
    check(
      'Navigate reveals rounded Travel Remaining',
      state.playerKnowledge.travel === 5.5,
      `got ${state.playerKnowledge.travel}`
    );
  });
  withState({ courseMeter: 10 }, () => {
    applyNavigateResult('navigateCriticalSuccess');
    check(
      'Navigate critical success caps Course Meter',
      state.courseMeter === 12,
      `got ${state.courseMeter}`
    );
  });
  withState({ courseMeter: 12 }, () => {
    decayCourseMeter();
    check(
      'Course Meter decays without navigation',
      state.courseMeter === 11,
      `got ${state.courseMeter}`
    );
  });
  withState({ courseMeter: 12 }, () => {
    applyNavigateResult('navigateCriticalFailure');
    decayCourseMeter();
    check(
      'Navigate skips end-of-turn Course decay',
      state.courseMeter === 12 &&
        state.navigateResolvedThisTurn === true &&
        (state.log || '').includes('decay was skipped'),
      `course ${state.courseMeter}`
    );
  });
  withState({ courseMeter: 12, travelTicks: 44 }, () => {
    applyHelmTravelOutcome('helmSuccess');
    check(
      'Helm success applies current Course State',
      state.travelTicks === 42,
      `got ${state.travelTicks}`
    );
  });
  withState({ courseMeter: 6, travelTicks: 44 }, () => {
    applyHelmTravelOutcome('helmCriticalSuccess');
    check(
      'Helm critical success improves Course State',
      state.travelTicks === 43 && state.courseMeter === 7,
      `ticks ${state.travelTicks}, course ${state.courseMeter}`
    );
  });
  withState({ courseMeter: 12, travelTicks: 44 }, () => {
    applyHelmTravelOutcome('helmFailure');
    check(
      'Helm failure applies one worse Course State',
      state.travelTicks === 43 && state.courseMeter === 12,
      `ticks ${state.travelTicks}, course ${state.courseMeter}`
    );
  });
  withState({ courseMeter: 5, travelTicks: 44 }, () => {
    applyHelmTravelOutcome('helmCriticalFailure');
    check(
      'Helm critical failure worsens travel and reduces Course Meter',
      state.travelTicks === 45 && state.courseMeter === 4,
      `ticks ${state.travelTicks}, course ${state.courseMeter}`
    );
  });
  withState(
    {
      mastStatus: 'Working',
      rudderStatus: 'Working',
      courseMeter: 12,
      travelTicks: 44
    },
    () => {
      applyActionStart(state.crew[0], actionById('helm'));
      const helmPrompt = state.pendingChecks.find(
        (prompt) => prompt.title === 'Helm Check' && prompt.type === 'check'
      );
      check(
        'Functional mast and rudder create normal Helm Check',
        Boolean(helmPrompt),
        `prompts ${state.pendingChecks.map((prompt) => prompt.title).join(', ')}`
      );
    }
  );
  withState(
    {
      mastStatus: 'Broken',
      rudderStatus: 'Working',
      courseMeter: 12,
      travelTicks: 44
    },
    () => {
      applyActionStart(state.crew[0], actionById('helm'));
      check(
        'Broken mast prevents Helm Check prompt',
        !state.pendingChecks.some((prompt) => prompt.title === 'Helm Check'),
        `prompts ${state.pendingChecks.map((prompt) => prompt.title).join(', ')}`
      );
      check(
        'Broken mast produces no Helm travel progress',
        state.travelTicks === 44,
        `got ${state.travelTicks}`
      );
      check(
        'Broken mast logs automatic Helm result',
        (state.log || '').includes('Mast broken:'),
        'missing mast broken log'
      );
    }
  );
  withState(
    {
      mastStatus: 'Broken',
      rudderStatus: 'Broken',
      courseMeter: 12,
      travelTicks: 44
    },
    () => {
      applyActionStart(state.crew[0], actionById('helm'));
      check(
        'Both broken uses broken mast behavior',
        state.travelTicks === 44 &&
          !state.pendingChecks.some((prompt) => prompt.title === 'Helm Check') &&
          (state.log || '').includes('Mast broken:'),
        `ticks ${state.travelTicks}`
      );
    }
  );
  withState(
    {
      mastStatus: 'Working',
      rudderStatus: 'Broken',
      courseMeter: 12,
      travelTicks: 44
    },
    () => {
      const originalRandom = Math.random;
      Math.random = () => 0.5;
      try {
        applyActionStart(state.crew[0], actionById('helm'));
      } finally {
        Math.random = originalRandom;
      }
      const delta = state.travelTicks - 44;
      check(
        'Broken rudder prevents Helm Check prompt',
        !state.pendingChecks.some((prompt) => prompt.title === 'Helm Check'),
        `prompts ${state.pendingChecks.map((prompt) => prompt.title).join(', ')}`
      );
      check(
        'Broken rudder automatically applies random Course State travel',
        [-2, -1, 0, 1].includes(delta),
        `delta ${delta}`
      );
      check(
        'Broken rudder logs random applied state',
        (state.log || '').includes('Random applied state:'),
        'missing rudder broken log'
      );
    }
  );
  withState(
    {
      mastStatus: 'Working',
      rudderStatus: 'Broken',
      courseMeter: 0,
      travelTicks: 44
    },
    () => {
      const originalRandom = Math.random;
      Math.random = () => 0;
      try {
        applyActionStart(state.crew[0], actionById('helm'));
      } finally {
        Math.random = originalRandom;
      }
      check(
        'Broken rudder random movement ignores Course Meter',
        state.travelTicks === 42,
        `got ${state.travelTicks} ticks with Lost course meter`
      );
    }
  );

  withState({ day: 1, turn: 8 }, () => {
    const scripted = scriptedEventForTurn();
    check(
      'Day 1 Turn 8 scripted event',
      scripted?.title === `Sehanine's Storm` && scripted.blocksOpenSea === true,
      scripted?.title || 'missing'
    );
    check('Day 1 Turn 8 skips Open Sea Event', openSeaEventRequiredForTurn() === false);
  });
  withState({ day: 2, turn: 7 }, () => {
    const scripted = scriptedEventForTurn();
    check(
      'Day 2 Turn 7 scripted event',
      scripted?.title === 'Nereids Encounter' && scripted.blocksOpenSea === true,
      scripted?.title || 'missing'
    );
  });
  withState({ day: 2, turn: 8 }, () => {
    const scripted = scriptedEventForTurn();
    check(
      'Day 2 Turn 8 scripted event',
      scripted?.title === 'Bev Nightmare Encounter' && scripted.blocksOpenSea === true,
      scripted?.title || 'missing'
    );
  });
  withState({ day: 1, turn: 2 }, () => {
    check('Day 1 Turn 2 rolls Open Sea Event', openSeaEventRequiredForTurn() === true);
  });
  withState({ day: 1, turn: 3 }, () => {
    check('Day 1 Turn 3 skips Open Sea Event', openSeaEventRequiredForTurn() === false);
  });
  withState({ waterLevel: 4 }, () => {
    check(
      'Inventory normal duration',
      actionDuration(actionById('inventoryFood')) === 1,
      `got ${actionDuration(actionById('inventoryFood'))}`
    );
  });
  withState({ waterLevel: 5 }, () => {
    check(
      'Inventory flooded duration',
      actionDuration(actionById('inventoryFood')) === 2,
      `got ${actionDuration(actionById('inventoryFood'))}`
    );
    check(
      'Study Map ignores flooded duration',
      actionDuration(actionById('studyMap')) === 1,
      `got ${actionDuration(actionById('studyMap'))}`
    );
    check(
      'Bilge Rod ignores flooded extra turn',
      actionDuration(actionById('examineRod')) === 1,
      `got ${actionDuration(actionById('examineRod'))}`
    );
  });
  withState({ day: 1, turn: 1, waterLevel: 5, minIngress: 2, activeLeaks: 1 }, () => {
    state.playerKnowledge.waterLevel = 1;
    state.playerKnowledge.totalIngress = 3;
    state.waterKnowledge.turnKey = currentTurnKey();
    state.waterKnowledge.knownThisTurn = true;
    state.waterKnowledge.exactKnownThisTurn = true;
    state.waterKnowledge.lastKnownTurnKey = currentTurnKey();
    state.waterKnowledge.streak = 2;
    state.waterLevel = 4;
    hideWaterLevelKnowledgeIfBelowCargoHold(5, 4);
    const known = playerKnownWaterLevel();
    check(
      'Water below cargo hold hides exact player value',
      known.known === false &&
        known.safeBelowCargo === true &&
        state.playerKnowledge.waterLevel === null &&
        state.playerKnowledge.totalIngress === null &&
        state.waterKnowledge.knownThisTurn === false &&
        state.waterKnowledge.exactKnownThisTurn === false &&
        state.waterKnowledge.streak === 0,
      JSON.stringify({ known, waterKnowledge: state.waterKnowledge })
    );
  });
  withState({ waterLevel: 3, minIngress: 2, activeLeaks: 1 }, () => {
    applyActionStart(state.crew[0], actionById('examineRod'));
    const prompt = state.pendingChecks.find((item) => item.effect === 'bilgeRod');
    check(
      'Bilge Rod success reveals Water Level and Total Ingress',
      Boolean(
        prompt?.successReveals?.includes('waterLevel') &&
        prompt?.successReveals?.includes('totalIngress')
      )
    );
    check(
      'Bilge Rod reveals Water Level on failure',
      Boolean(
        prompt?.failureReveals?.includes('waterLevel') &&
        !prompt?.failureReveals?.includes('totalIngress')
      )
    );
  });
  withState({ day: 1, turn: 1, waterLevel: 3, minIngress: 2, activeLeaks: 1 }, () => {
    rememberPlayerKnowledge('waterLevel');
    const firstTurnIngress = state.playerKnowledge.totalIngress;
    state.turn = 2;
    rememberPlayerKnowledge('waterLevel');
    check(
      'Total Ingress reveals after two known water turns',
      firstTurnIngress === null && state.playerKnowledge.totalIngress === 3,
      `first ${firstTurnIngress}, second ${state.playerKnowledge.totalIngress}`
    );
  });
  withState({}, () => {
    applyActionStart(state.crew[0], actionById('studyMap'));
    const prompt = state.pendingChecks.find((item) => item.effect === 'navigateCourse');
    check('Navigate prompt carries a visible DC', prompt?.dc === 15, `got ${prompt?.dc}`);
  });
  withState({}, () => {
    applyActionStart(state.crew[0], actionById('harpoon'));
    const prompt = state.pendingChecks.find((item) => item.effect === 'harpoon');
    check('Harpoon prompt carries a visible DC', prompt?.dc === 18, `got ${prompt?.dc}`);
  });
  check(
    'Ingress severity scales by active leaks',
    activeLeaksSeverityClass(0) === 'good' &&
      activeLeaksSeverityClass(1) === 'warn' &&
      activeLeaksSeverityClass(3) === 'danger'
  );
  check(
    'Total ingress severity compares against minimum',
    totalIngressSeverityClass(2, 2) === 'good' &&
      totalIngressSeverityClass(3, 2) === 'warn' &&
      totalIngressSeverityClass(4, 2) === 'danger'
  );
  withState({ conditions: [{ name: 'Floating Wreckage', turns: 1 }] }, () => {
    check(
      'Recover wreckage appears during event',
      isActionDropdownAvailable(defaultState.crew[0].name, actionById('recoverWreckage'))
    );
  });
  withState({ conditions: [] }, () => {
    check(
      'Recover wreckage hidden without event',
      !isActionDropdownAvailable(defaultState.crew[0].name, actionById('recoverWreckage'))
    );
  });
  withState({ noMealStreak: 1 }, () => {
    check('No-meal save starts at DC 15', noMealSaveDC() === 15, `got ${noMealSaveDC()}`);
  });
  withState({ noMealStreak: 2 }, () => {
    check('No-meal save increases by 2', noMealSaveDC() === 17, `got ${noMealSaveDC()}`);
  });
  try {
    validateImportedStatePayload([]);
    check('Import rejects array payloads', false, 'array was accepted');
  } catch {
    check('Import rejects array payloads', true);
  }
  try {
    validateImportedStatePayload(JSON.parse('{"__proto__":{"polluted":true}}'));
    check('Import rejects unsafe object keys', false, 'unsafe key was accepted');
  } catch {
    check('Import rejects unsafe object keys', true);
  }
  try {
    const normalized = normalizeImportedState({
      travel: 4.75,
      crew: structuredClone(defaultState.crew)
    });
    check(
      'Import normalizes old decimal travel',
      normalized.travelTicks === 38 && normalized.travel === 4.75,
      `ticks ${normalized.travelTicks}, days ${normalized.travel}`
    );
  } catch (error) {
    check('Import normalizes old decimal travel', false, error.message);
  }
  try {
    normalizeImportedState({
      plannedActions: { Leopold: 'notAnAction' },
      crew: structuredClone(defaultState.crew)
    });
    check('Import rejects unknown planned action ids', false, 'unknown action was accepted');
  } catch {
    check('Import rejects unknown planned action ids', true);
  }

  const passCount = results.filter((result) => result.pass).length;
  results.unshift({
    label: `Dev validator summary: ${passCount}/${results.length} checks passed`,
    pass: passCount === results.length,
    detail: ''
  });
  return results;
}

// Normalize old localStorage/export shapes into the current versioned state.
function migrateState() {
  const incomingState = state && typeof state === 'object' ? state : {};
  const hadTravelTicks = Object.prototype.hasOwnProperty.call(incomingState, 'travelTicks');
  state = { ...structuredClone(defaultState), ...incomingState };
  state.version = APP_VERSION;
  state.setupComplete = state.setupComplete !== false;
  state.shipName = normalizedShipName(state.shipName);
  const parsedTravelTicks = Number(state.travelTicks);
  state.travelTicks =
    hadTravelTicks && Number.isFinite(parsedTravelTicks)
      ? Math.max(0, Math.round(parsedTravelTicks))
      : daysToTravelTicks(incomingState.travel ?? defaultState.travel);
  syncTravelDaysFromTicks();
  state.courseMeter = clampCourseMeter(state.courseMeter);
  if (typeof state.mast === 'boolean') state.mastStatus = state.mast ? 'Repaired' : 'Broken';
  if (typeof state.rudder === 'boolean') state.rudderStatus = state.rudder ? 'Repaired' : 'Broken';
  if (typeof state.pump === 'boolean') state.pumpStatus = state.pump ? 'Working' : 'Jammed';
  if (typeof state.net === 'boolean') state.netStatus = state.net ? 'Ready' : 'Tangled';
  if (typeof state.rigging === 'boolean') state.riggingStatus = state.rigging ? 'Intact' : 'Broken';
  if (typeof state.timber === 'boolean')
    state.salvagedTimber = state.timber ? 1 : Number(state.salvagedTimber || 0);
  const incomingCrew = Array.isArray(state.crew) ? state.crew : [];
  const targetCrewSize = clampCrewSize(incomingCrew.length || crewNames.length);
  state.crew = Array.from({ length: targetCrewSize }, (_, index) => {
    const defaultName = defaultCrewName(index);
    const existing = incomingCrew[index] || incomingCrew.find((c) => c.name === defaultName) || {};
    const name = existing.name || defaultName;
    const background =
      existing.sailorPirateBackground ??
      existing.sailorBackground ??
      defaultSailorPirateCrew.has(defaultName);
    return {
      name,
      labor: Number(existing.labor || 0),
      exhaustion: Number(existing.exhaustion || 0),
      lastAction: existing.lastAction || '',
      sailorPirateBackground: Boolean(background),
      fishermanBackground: Boolean(existing.fishermanBackground),
      waterVehiclesProficiency: Boolean(existing.waterVehiclesProficiency),
      navigatorToolsProficiency: Boolean(existing.navigatorToolsProficiency),
      cartographerToolsProficiency: Boolean(existing.cartographerToolsProficiency)
    };
  });
  state.conditions = Array.isArray(state.conditions) ? state.conditions : [];
  state.playerKnowledge = {
    ...structuredClone(defaultState.playerKnowledge),
    ...(state.playerKnowledge || {})
  };
  state.waterKnowledge = {
    ...structuredClone(defaultState.waterKnowledge),
    ...(state.waterKnowledge || {})
  };
  state.waterKnowledge.streak = Math.max(0, Number(state.waterKnowledge.streak || 0));
  state.waterKnowledge.knownThisTurn = Boolean(state.waterKnowledge.knownThisTurn);
  state.waterKnowledge.exactKnownThisTurn = Boolean(state.waterKnowledge.exactKnownThisTurn);
  state.pendingChecks = Array.isArray(state.pendingChecks) ? state.pendingChecks : [];
  state.deferredCompletions = Array.isArray(state.deferredCompletions)
    ? state.deferredCompletions
    : [];
  state.consumedMeals =
    state.consumedMeals && typeof state.consumedMeals === 'object' ? state.consumedMeals : {};
  state.appliedScriptedEvents =
    state.appliedScriptedEvents && typeof state.appliedScriptedEvents === 'object'
      ? state.appliedScriptedEvents
      : {};
  state.longRestLaborRecoveryPending = Boolean(state.longRestLaborRecoveryPending);
  state.restMealStatus = {
    ...structuredClone(defaultState.restMealStatus),
    ...(state.restMealStatus && typeof state.restMealStatus === 'object'
      ? state.restMealStatus
      : {})
  };
  state.noMealStreak = Math.max(0, Number(state.noMealStreak || 0));
  state.ongoing = Array.isArray(state.ongoing) ? state.ongoing : [];
  state.plannedActions = state.plannedActions || {};
  state.confirmedActions = state.confirmedActions || {};
  state.salvageLumberBelowDeck =
    state.salvageLumberBelowDeck && typeof state.salvageLumberBelowDeck === 'object'
      ? state.salvageLumberBelowDeck
      : {};
  state.isNightOvertime = Boolean(state.isNightOvertime);
  state.overtimeTurnCount = Math.max(0, Number(state.overtimeTurnCount || 0));
  state.overtimeExhaustion =
    state.overtimeExhaustion && typeof state.overtimeExhaustion === 'object'
      ? state.overtimeExhaustion
      : {};
  state.crew.forEach((character) => {
    state.overtimeExhaustion[character.name] = Number(
      state.overtimeExhaustion[character.name] || 0
    );
  });
  state.turnLedger = state.turnLedger || { pumping: 0, buckets: 0 };
  state.startedGroups = state.startedGroups || {};
  pruneCrewScopedState();
  state.salvagedTimber = Number(state.salvagedTimber || 0);
  state.turnStep = Math.max(1, Math.min(turnSteps.length, Number(state.turnStep || 1)));
  state.eventResolvedThisTurn = Boolean(state.eventResolvedThisTurn);
  state.scriptedCheckedThisTurn = Boolean(state.scriptedCheckedThisTurn);
  state.actionsCommittedThisTurn = Boolean(state.actionsCommittedThisTurn);
  state.navigateResolvedThisTurn = Boolean(state.navigateResolvedThisTurn);
  state.scriptedSceneTurn = Boolean(state.scriptedSceneTurn);
  state.waterUpdatedThisTurn = Boolean(state.waterUpdatedThisTurn);
  state.waterTravelPenalty = Number(state.waterTravelPenalty || 0);
}

function isAutoPlanned(name) {
  return state.ongoing.some(
    (o) =>
      o.status === 'active' && o.actors.includes(name) && state.plannedActions[name] === o.actionId
  );
}

function log(message) {
  state.log = `Day ${state.day}, Turn ${state.turn}: ${message}\n` + (state.log || '');
}

function fieldLabel(field) {
  const labels = {
    day: 'Day',
    shipName: 'Ship Name',
    turn: 'Turn',
    travel: 'Travel Remaining',
    travelTicks: 'Travel Ticks',
    courseMeter: 'Course Meter',
    courseState: 'Course State',
    waterLevel: 'Water Level',
    minIngress: 'Minimum Water Ingress',
    totalIngress: 'Total Water Ingress',
    activeLeaks: 'Active Leaks',
    food: 'Food',
    freshWater: 'Fresh Water',
    repairMaterials: 'Repair Supplies',
    salvagedTimber: 'Salvaged Timber',
    mastStatus: 'Mast',
    rudderStatus: 'Rudder',
    pumpStatus: 'Bilge Pump',
    netStatus: 'Fishing Net',
    riggingStatus: 'Rigging',
    pumping: 'Pumping',
    buckets: 'Bucket Brigade',
    salvageLumberBelowDeck: 'Salvage lumber deck choices',
    labor: 'Labor',
    exhaustion: 'Exhaustion',
    fishermanBackground: 'Fisherman background',
    waterVehiclesProficiency: 'Water Vehicles proficiency',
    navigatorToolsProficiency: "Navigator's Tools proficiency",
    cartographerToolsProficiency: "Cartographer's Tools proficiency"
  };
  return labels[field] || field;
}

function humanOutcome(outcomeId) {
  const outcomes = {
    recoverLabor: 'Recover 2 Labor',
    recoverExhaustion: 'Recover 1 Exhaustion',
    pumpTwo: 'Water reduced by 2',
    pumpThree: 'Water reduced by 3',
    pumpFour: 'Water reduced by 4',
    foodQuarter: '+0.25 Food',
    foodHalf: '+0.5 Food',
    foodOne: '+1 Food',
    foodTwo: '+2 Food',
    helmCriticalSuccess: 'Helm critical success',
    helmSuccess: 'Helm success',
    helmFailure: 'Helm failure',
    helmCriticalFailure: 'Helm critical failure',
    navigateCriticalSuccess: 'Navigate critical success',
    navigateSuccess: 'Navigate success',
    navigateFailure: 'Navigate failure',
    navigateCriticalFailure: 'Navigate critical failure',
    fail: 'Failure'
  };
  return outcomes[outcomeId] || outcomeId;
}

function capitalize(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
