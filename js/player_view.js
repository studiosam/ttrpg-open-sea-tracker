const PLAYER_STATE_KEY = 'openSeaPlayerState';
const FULL_STATE_KEYS = ['openSeaTrackerDraft', 'openSeaTracker'];
const DEFAULT_PLAYER_SHIP_NAME = 'The Marrowwind';
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

function q(id) {
  return document.getElementById(id);
}
function actionMetadata(actionId) {
  return ACTION_METADATA_BY_ID[actionId] || null;
}
function actionMetadataByName(actionName) {
  return ACTION_METADATA_BY_NAME[actionName] || null;
}
function actionGetsFloodedExtraTurn(action) {
  return Boolean(action?.belowDeck && !action?.noFloodedExtraTurn);
}
function actionIsBelowDeckForCrew(state, action, name) {
  if (action?.belowDeck) return true;
  return Boolean(action?.deckChoice && name && state.salvageLumberBelowDeck?.[name]);
}

// Prefer the filtered player snapshot. Fall back to the full save only when the DM page has not published yet.
function readPlayerState() {
  const playerRaw = localStorage.getItem(PLAYER_STATE_KEY);
  if (playerRaw) return JSON.parse(playerRaw);
  for (const key of FULL_STATE_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw) return publicStateFromFullState(JSON.parse(raw));
  }
  return null;
}

// Converts a full GM save into a player-safe shape for direct refresh/fallback loading.
function publicStateFromFullState(state) {
  return {
    shipName: playerShipName(state),
    day: state.day,
    turn: state.turn,
    travel: knownValueFromFullState(state, 'travel'),
    courseState: knownValueFromFullState(state, 'courseState'),
    waterLevel: knownWaterLevelFromFullState(state),
    activeLeaks: state.activeLeaks,
    totalIngress: knownValueFromFullState(state, 'totalIngress'),
    totalIngressSeverity: totalIngressSeverityFromFullState(state),
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
      .filter((item) => item.status === 'active')
      .map((item) => ({
        name: item.actionName || item.actionId,
        actors: item.actors || [],
        remaining: item.remaining
      })),
    crew: (state.crew || []).map((character) => ({
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

function publicCrewTurnsRemainingFromFullState(state, name) {
  const ongoing = (state.ongoing || []).find(
    (item) => item.status === 'active' && (item.actors || []).includes(name)
  );
  if (ongoing) return String(Number(ongoing.remaining || 1));
  const actionId = state.confirmedActions?.[name];
  if (!actionId || actionId === 'idle') return '';
  return String(publicActionDurationFromFullState(state, actionId, name));
}

function publicActionDurationFromFullState(state, actionId, name = '') {
  const action = actionMetadata(actionId);
  const base = Number(action?.duration || 1);
  const floodedPenalty =
    actionIsBelowDeckForCrew(state, action, name) &&
    actionGetsFloodedExtraTurn({ ...action, belowDeck: true }) &&
    Number(state.waterLevel || 0) >= 5
      ? 1
      : 0;
  return base + floodedPenalty;
}

function publicCrewDoneInStatusFromFullState(state, name) {
  const ongoing = (state.ongoing || []).some(
    (item) => item.status === 'active' && (item.actors || []).includes(name)
  );
  if (ongoing) return 'normal';
  const actionId = state.confirmedActions?.[name];
  if (!actionId || actionId === 'idle') return '';
  const action = actionMetadata(actionId);
  return actionIsBelowDeckForCrew(state, action, name) &&
    actionGetsFloodedExtraTurn({ ...action, belowDeck: true }) &&
    Number(state.waterLevel || 0) >= 5
    ? 'flooded'
    : 'normal';
}

function publicCrewActionFromFullState(state, name) {
  const actionId = state.plannedActions?.[name];
  if (state.scriptedSceneTurn && actionId === 'idle') {
    const preservedActionName = publicPreservedOngoingActionName(state, name);
    if (preservedActionName)
      return `Forced Idle — Scene/Hazard (preserving ${preservedActionName})`;
  }
  if (!actionId)
    return (state.crew || []).find((character) => character.name === name)?.lastAction || '';
  return publicActionName(actionId);
}

function publicActionName(actionId) {
  return actionMetadata(actionId)?.name || actionId;
}

function publicPreservedOngoingActionName(state, name) {
  const ongoing = (state.ongoing || []).find(
    (item) => item.status === 'active' && (item.actors || []).includes(name)
  );
  if (!ongoing) return '';
  return publicActionName(ongoing.actionId);
}

// Unknown values stay hidden until the DM reveals them or an action updates player knowledge.
function knownValueFromFullState(state, key) {
  const value = state.playerKnowledge?.[key];
  return {
    known: value !== null && value !== undefined,
    value: value ?? null
  };
}

// Flooding in the cargo hold is automatically visible; lower bilge levels require a sounding rod check.
function knownWaterLevelFromFullState(state) {
  if (Number(state.waterLevel) >= 5) {
    return { known: true, value: Number(state.waterLevel), automatic: true };
  }
  const known = knownValueFromFullState(state, 'waterLevel');
  if (known.known && state.waterKnowledge?.exactKnownThisTurn) return known;
  return { known: false, value: null, safeBelowCargo: true };
}

function totalIngressSeverityFromFullState(state) {
  const overMinimum = Number(state.activeLeaks || 0);
  if (overMinimum <= 0) return 'good';
  if (overMinimum === 1) return 'warn';
  return 'danger';
}

// Rebuild player-facing active effects from the full state fallback.
function publicEffectsFromFullState(state) {
  const effects = [];
  const waterEffect = publicWaterEffectFromFullState(state);
  if (waterEffect) effects.push(waterEffect);
  (state.conditions || [])
    .filter((condition) => Number(condition.turns) > 0)
    .forEach((condition) => effects.push(publicConditionEffect(condition)));
  if (state.isNightOvertime)
    effects.push({
      title: 'Night Overtime',
      detail: 'The crew is working through the night. Exhaustion risk is increasing.',
      className: 'danger'
    });
  if (state.pumpStatus === 'Jammed')
    effects.push({
      title: 'Bilge Pump Jammed',
      detail: 'Bilge pump actions are unavailable until Repair Bilge Pump is completed.',
      className: 'warn'
    });
  if (state.netStatus === 'Tangled')
    effects.push({
      title: 'Fishing Net Tangled',
      detail: 'Cast Fishing Net is unavailable until Reset Fishing Net is completed.',
      className: 'warn'
    });
  if (state.mastStatus === 'Broken')
    effects.push({
      title: 'Mast Broken',
      detail:
        'Man Helm is automatic: no Helm check is made and the ship cannot make sail progress.',
      className: 'danger'
    });
  else if (state.rudderStatus === 'Broken')
    effects.push({
      title: 'Rudder Broken',
      detail:
        'Man Helm is automatic: no Helm check is made and the ship randomly applies True Course, Drifting, Off Course, or Lost.',
      className: 'danger'
    });
  if (state.riggingStatus === 'Broken')
    effects.push({
      title: 'Broken Rigging',
      detail:
        'At the start of each turn, a random top-deck creature may need a DC 13 Dexterity save.',
      className: 'danger'
    });
  return effects;
}

function publicWaterEffectFromFullState(state) {
  const level = Number(state.waterLevel);
  if (level >= 20)
    return { title: 'Sunk', detail: 'The Marrowwind is sinking.', className: 'danger' };
  if (level >= 15)
    return {
      title: 'Neck-Deep Flooding',
      detail: `Below-deck actions take +1 Turn and +1 Labor. Travel penalty is currently ${state.waterTravelPenalty || 0} day(s), and decreases as water drops.`,
      className: 'danger'
    };
  if (level >= 10)
    return {
      title: 'Waist-Deep Flooding',
      detail: 'Below-deck actions take +1 Turn and cost +1 Labor.',
      className: 'warn'
    };
  if (level >= 5)
    return {
      title: 'Cargo Hold Flooding',
      detail: 'Below-deck actions take +1 Turn.',
      className: 'warn'
    };
  return null;
}

function publicConditionEffect(condition) {
  const turns = Number(condition.turns);
  const suffix = `${turns} turn${turns === 1 ? '' : 's'} remaining.`;
  const effects = {
    'Dense Fog': {
      title: 'Dense Fog',
      detail: `Visibility is reduced to 30 feet. Helm checks, fishing checks, attempts to recover floating objects, and ranged attacks against targets not actively engaged in melee are made at disadvantage. Targets or objects farther than 30 feet away cannot be targeted normally unless revealed by sound, light, magic, or another clear cue. ${suffix}`,
      className: 'warn'
    },
    'School of Fish': {
      title: 'School of Fish',
      detail: `The next Cast Fishing Net action this turn has advantage. Harpoons gain no benefit. ${suffix}`,
      className: 'good'
    },
    'Pack of Gulls': {
      title: 'Pack of Gulls',
      detail: `Gulls are swarming the ship. Characters may spend their action joining the fight to scare them off for 0 Labor. If not dispatched in 3 rounds, reduce Food by 0.5 days. ${suffix}`,
      className: 'warn'
    },
    'Calm Seas': {
      title: 'Calm Seas',
      detail: `The helmsman recovers 1 Labor instead of gaining 1 while steering this turn. ${suffix}`,
      className: 'good'
    },
    'Floating Wreckage': {
      title: 'Floating Wreckage',
      detail: `Wreckage can be recovered this turn with a 1-Labor action and DC 12 Dexterity or Athletics check. ${suffix}`,
      className: 'warn'
    },
    'Large Shadow': {
      title: 'Large Shadow',
      detail: `A massive shape is beneath the ship and can be targeted with the harpoon. ${suffix}`,
      className: 'warn'
    },
    'Rainwater Collection': {
      title: 'Rain and Flying Fish',
      detail: `Characters may spend their action collecting rainwater for 0 Labor. ${suffix}`,
      className: 'good'
    }
  };
  return effects[condition.name] || { title: condition.name, detail: suffix, className: '' };
}

// Main player render. Everything here uses already-filtered state, not DM-only raw values.
function render() {
  const state = readPlayerState();
  if (!state) {
    renderEmpty();
    return;
  }
  renderPlayerTitle(state);
  q('playerTurn').innerHTML = turnChips(state.day, state.turn);
  q('playerTravel').innerHTML = travelCardContent(state.travel);
  q('playerCourseState').className =
    `player-card player-course-card ${courseStateClass(state.courseState)}`;
  q('playerCourseState').innerHTML = courseStateCardContent(state.courseState);
  q('playerUpdated').textContent = `Updated ${formatTime(state.updatedAt)}`;
  q('playerShipStats').innerHTML = [
    waterMeterCard(state.waterLevel),
    `<div class="player-ship-substats">
      ${statCard('Active Leaks', state.activeLeaks, activeLeaksClass(state.activeLeaks))}
      ${statCard(
        'Total Ingress',
        stateValue(state.totalIngress),
        knownClass(state.totalIngress, (value) => state.totalIngressSeverity || ingressClass(value))
      )}
    </div>`
  ].join('');
  q('playerSupplies').innerHTML = [
    statCard(
      'Food',
      stateValue(state.food),
      knownClass(state.food, (value) => (Number(value) <= 1 ? 'danger' : 'good'))
    ),
    statCard(
      'Water',
      stateValue(state.freshWater),
      knownClass(state.freshWater, (value) => (Number(value) <= 1 ? 'danger' : 'good'))
    ),
    statCard(
      'Repairs',
      stateValue(state.repairMaterials),
      knownClass(state.repairMaterials, (value) => (Number(value) <= 1 ? 'danger' : 'good'))
    )
  ].join('');
  q('playerSystems').innerHTML = [
    systemCard('Mast', state.systems.mast),
    systemCard('Rudder', state.systems.rudder),
    systemCard('Pump', state.systems.pump),
    systemCard('Net', state.systems.net),
    systemCard('Rigging', state.systems.rigging)
  ].join('');
  renderEffects(state.effects || []);
  renderCrew(state.crew || []);
}

function renderEmpty() {
  renderPlayerTitle(null);
  q('playerTurn').innerHTML = turnChips('--', '--');
  q('playerTravel').innerHTML = travelCardContent(null);
  q('playerCourseState').className = 'player-card player-course-card unknown';
  q('playerCourseState').innerHTML = courseStateCardContent(null);
  q('playerUpdated').textContent = 'No tracker data found';
  ['playerShipStats', 'playerSupplies', 'playerSystems', 'playerEffects', 'playerCrew'].forEach(
    (id) => {
      q(id).innerHTML = '<span class="pill">Waiting for DM tracker...</span>';
    }
  );
}

function renderPlayerTitle(state) {
  const title = q('playerTitle');
  if (title) title.textContent = `${playerShipName(state)} Status`;
}

function playerShipName(state) {
  const name = typeof state?.shipName === 'string' ? state.shipName.trim() : '';
  return name || DEFAULT_PLAYER_SHIP_NAME;
}

function statCard(label, value, className = '') {
  return `<div class="player-card ${className}">
    <div class="score-label">${escapeHtml(label)}</div>
    <div class="score-value">${escapeHtml(String(value ?? '--'))}</div>
  </div>`;
}

function systemCard(label, status) {
  const displayStatus = systemDisplayStatus(status, label);
  const fullStatus = status || displayStatus;
  return `<div class="player-card player-system-card ${systemClass(status)}" title="${escapeHtml(label)}: ${escapeHtml(fullStatus)}" aria-label="${escapeHtml(label)}: ${escapeHtml(fullStatus)}">
    <div class="score-label">${escapeHtml(label)}</div>
    <div class="score-value">${escapeHtml(displayStatus)}</div>
  </div>`;
}

function systemDisplayStatus(status, label = '') {
  return (
    {
      Working: '✓',
      Repaired: '✓',
      Ready: '✓',
      Intact: '✓',
      Broken: '✕',
      Jammed: '✕',
      Tangled: '✕'
    }[status] ||
    (status ? '✕' : '') ||
    '--'
  );
}

function turnChips(day, turn) {
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
function waterMeterCard(field) {
  const known = !(field && typeof field === 'object' && 'known' in field) || field.known;
  const safeBelowCargo = Boolean(field?.safeBelowCargo);
  const value = known ? Number(field?.value ?? field) : 0;
  const percentage = known ? Math.max(0, Math.min(100, (value / 20) * 100)) : 0;
  const dangerColor = known ? waterTextColor(value) : '';
  const displayValue = known ? formatNumber(value) : safeBelowCargo ? 'Bilge Only' : '?';
  const detail = known
    ? `${formatNumber(percentage)}% full`
    : safeBelowCargo
      ? 'Safe, exact level unknown'
      : 'Exact level unknown';
  return `<div class="player-card water-meter-card ${waterClass(field)}">
    <div class="water-meter-layout">
      <div class="water-meter" aria-label="Water level ${escapeHtml(displayValue)} out of 20">
        ${
          known
            ? ''
            : `<div class="water-empty-readout water-readout-safe">
          <div class="water-fill-value">${escapeHtml(displayValue)}</div>
          <div class="water-fill-detail">${escapeHtml(detail)}</div>
        </div>`
        }
        <div class="water-fill" style="height:${percentage}%"></div>
        ${waterMarker(5, 'Cargo Hold')}
        ${waterMarker(10, 'Waist Deep')}
        ${waterMarker(15, 'Neck Deep')}
        ${waterMarker(20, 'Sunk')}
        <div class="water-fill-readout${known ? '' : ' hidden'}" style="${dangerColor ? `--water-text-color:${dangerColor}` : ''}">
          <div class="water-fill-value">${escapeHtml(displayValue)}</div>
          <div class="water-fill-detail">${escapeHtml(detail)}</div>
        </div>
      </div>
    </div>
  </div>`;
}

function waterTextColor(value) {
  const ratio = Math.max(0, Math.min(1, Number(value) / 20));
  const red = Math.round(255);
  const green = Math.round(244 - ratio * 120);
  const blue = Math.round(214 - ratio * 155);
  return `rgb(${red}, ${green}, ${blue})`;
}

function waterMarker(level, label) {
  const bottom = Math.max(0, Math.min(100, (level / 20) * 100));
  return `<div class="water-marker" style="bottom:${bottom}%">
    <span>${escapeHtml(label)}</span>
  </div>`;
}

// Handles known/unknown value objects published by js/tracker.js.
function stateValue(field, formatter = formatNumber) {
  if (field && typeof field === 'object' && 'known' in field) {
    return field.known ? formatter(field.value) : '?';
  }
  return formatter(field);
}

function knownClass(field, classForValue) {
  if (field && typeof field === 'object' && 'known' in field) {
    return field.known ? classForValue(field.value) : 'unknown';
  }
  return classForValue(field);
}

function renderEffects(effects) {
  if (!effects.length) {
    q('playerEffects').innerHTML = '<span class="pill good">No active effects</span>';
    return;
  }
  q('playerEffects').innerHTML = effects
    .map(
      (effect) =>
        `<div class="player-effect-card ${escapeHtml(effect.className || '')}">
          <div class="player-effect-title">${escapeHtml(effectLabel(effect.title))}</div>
          <div class="player-effect-detail">${escapeHtml(effect.detail || '')}</div>
        </div>`
    )
    .join('');
}

function renderCrew(crew) {
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
    ${crew
      .map(
        (character) => `<div class="player-crew-row">
      <div class="player-crew-name">${escapeHtml(character.name)}</div>
      <div class="player-crew-number">${escapeHtml(formatNumber(character.labor))}</div>
      <div class="player-crew-number">${escapeHtml(formatNumber(character.exhaustion))}</div>
      <div class="player-crew-action">${escapeHtml(crewActionText(character))}</div>
      <div class="player-crew-number player-done-in ${escapeHtml(character.doneInStatus || '')}">${escapeHtml(character.turnsRemaining || '-')}</div>
    </div>`
      )
      .join('')}
  </div>`;
}

function crewActionText(character) {
  if (character.currentAction) return actionLabel(character.currentAction);
  return character.lastAction ? `Last: ${actionLabel(character.lastAction)}` : 'No action selected';
}

function actionLabel(actionName) {
  const action = actionMetadata(actionName) || actionMetadataByName(actionName);
  return action?.playerLabel || action?.name || actionName || 'No action selected';
}

function travelCardContent(travel) {
  const travelText =
    travel && typeof travel === 'object' && 'known' in travel
      ? stateValue(travel, formatPlayerTravelDays)
      : '--';
  return `<div class="score-label">Days</div>
    <div class="score-value">${escapeHtml(travelText)}</div>`;
}

function formatPlayerTravelDays(value) {
  return formatNumber(Math.round(Number(value || 0) * 2) / 2);
}

function courseStateCardContent(courseState) {
  const courseText =
    courseState && typeof courseState === 'object' && 'known' in courseState
      ? stateValue(courseState, playerCourseLabel)
      : '?';
  return `<div class="score-label">Course</div>
    <div class="score-value">${escapeHtml(courseText)}</div>`;
}

function playerCourseLabel(value) {
  return (
    {
      'True Course': 'True',
      Drifting: 'Drifting',
      'Off Course': 'Off',
      Lost: 'Lost'
    }[value] ||
    value ||
    '?'
  );
}

function courseStateClass(courseState) {
  if (!courseState || typeof courseState !== 'object' || !('known' in courseState))
    return 'unknown';
  if (!courseState.known) return 'unknown';
  if (courseState.value === 'True Course') return 'good';
  if (courseState.value === 'Off Course' || courseState.value === 'Lost') return 'danger';
  return '';
}

function ingressClass(value) {
  const total = Number(value || 0);
  if (total <= 1) return 'good';
  if (total === 2) return 'warn';
  return 'danger';
}

function activeLeaksClass(value) {
  const leaks = Number(value || 0);
  if (leaks <= 0) return 'good';
  if (leaks <= 2) return 'warn';
  return 'danger';
}

function effectLabel(effectName) {
  return PLAYER_EFFECT_LABELS[effectName] || effectName || 'Active Effect';
}
function waterClass(level) {
  if (level && typeof level === 'object' && 'known' in level) {
    if (!level.known) return level.safeBelowCargo ? 'good' : 'unknown';
    return waterClass(level.value);
  }
  const value = Number(level);
  if (value >= 5) return 'danger';
  return 'good';
}

function systemClass(status) {
  return ['Working', 'Repaired', 'Ready', 'Intact'].includes(status) ? 'good' : 'danger';
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function turnCountLabel(value) {
  const turns = Number(value);
  if (!Number.isFinite(turns)) return '--';
  return `${formatNumber(turns)} Turn${turns === 1 ? '' : 's'}`;
}

function formatTime(value) {
  if (!value) return 'never';
  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Storage events update this page when it is open in another tab/window.
window.addEventListener('storage', (event) => {
  if ([PLAYER_STATE_KEY, ...FULL_STATE_KEYS].includes(event.key)) render();
});
setInterval(render, 1000);
render();
