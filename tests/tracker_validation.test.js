const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const trackerFiles = [
  'js/action_metadata.js',
  'js/tracker_state.js',
  'js/tracker_render.js',
  'js/tracker_gameplay.js',
  'js/tracker_persistence.js'
];

function readProjectFile(filePath) {
  return fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
}

function createStorage() {
  const values = new Map();
  return {
    setItem(key, value) {
      values.set(key, String(value));
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    }
  };
}

function loadTrackerContext() {
  const context = {
    console,
    structuredClone,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    alert(message) {
      throw new Error(`Unexpected alert: ${message}`);
    },
    confirm() {
      return true;
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  trackerFiles.forEach((file) => {
    vm.runInContext(readProjectFile(file), context, { filename: file });
  });
  return {
    context,
    evaluate(expression) {
      return vm.runInContext(expression, context);
    }
  };
}

function loadPlayerContext() {
  const context = {
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    localStorage: createStorage(),
    document: {
      getElementById() {
        return null;
      }
    },
    window: { addEventListener() {} },
    setInterval() {}
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(readProjectFile('js/action_metadata.js'), context, {
    filename: 'js/action_metadata.js'
  });
  const playerSource = readProjectFile('js/player_view.js').replace(
    /\/\/ Storage events update this page[\s\S]*$/,
    ''
  );
  vm.runInContext(playerSource, context, { filename: 'js/player_view.js' });
  return {
    context,
    evaluate(expression) {
      return vm.runInContext(expression, context);
    }
  };
}

test('browser validation suite passes under Node', () => {
  const tracker = loadTrackerContext();
  const results = tracker.evaluate('devValidationChecks()');
  const failed = results.filter((result) => !result.pass);
  assert.equal(failed.length, 0, JSON.stringify(failed));
});

test('browser validation suite restores the active tracker state', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    state.day = 6;
    state.turn = 3;
    const originalState = state;
    devValidationChecks();
    return {sameObject: state === originalState, day: state.day, turn: state.turn};
  })()`);
  assert.equal(result.sameObject, true);
  assert.equal(result.day, 6);
  assert.equal(result.turn, 3);
});

test('import validation rejects malformed and unsafe payloads', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    const cases = [];
    for (const payload of [null, [], JSON.parse('{"__proto__":{"polluted":true}}'), {day:"not a number"}]) {
      try {
        validateImportedStatePayload(payload);
        cases.push('accepted');
      } catch (error) {
        cases.push(error.message);
      }
    }
    return cases;
  })()`);
  assert.match(result[0], /tracker state object/);
  assert.match(result[1], /tracker state object/);
  assert.match(result[2], /Unsafe key/);
  assert.match(result[3], /finite number/);
});

test('pending prompt rendering escapes imported prompt text', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    const appended = [];
    const box = {
      innerHTML: '',
      appendChild(node){
        appended.push({className: node.className, innerHTML: node.innerHTML});
      }
    };
    document = {
      getElementById(id){ return id === 'pendingChecks' ? box : null; },
      createElement(){ return {className: '', innerHTML: ''}; }
    };
    state = structuredClone(defaultState);
    state.turnStep = 4;
    state.pendingChecks = [{
      id: 'prompt"><img src=x>',
      phase: 'action',
      type: 'check <bad>',
      character: '<b>Leopold</b>',
      title: '<img src=x onerror=alert(1)>',
      detail: 'Use <script>alert(1)</script> safely.',
      outcomes: [{id: 'success"><img src=x>', label: '<strong>Pass</strong>', className: 'good bad" onclick="evil'}],
      status: 'pending'
    }];
    renderPendingChecks();
    return appended[0];
  })()`);
  assert.equal(result.className.includes('<'), false);
  assert.match(result.innerHTML, /&lt;b&gt;Leopold&lt;\/b&gt;/);
  assert.match(result.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(result.innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(result.innerHTML, /&lt;strong&gt;Pass&lt;\/strong&gt;/);
  assert.doesNotMatch(result.innerHTML, /<img/);
  assert.doesNotMatch(result.innerHTML, /<script/);
});

test('import validation rejects out-of-range values', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    const oversizedCrew = [...structuredClone(defaultState.crew), defaultCrewMember(6, 'Player 7'), defaultCrewMember(7, 'Player 8')];
    const cases = [
      {courseMeter: 13},
      {turnStep: 99},
      {day: 0},
      {food: -0.25},
      {crew: structuredClone(defaultState.crew).slice(0, 3)},
      {crew: oversizedCrew}
    ];
    return cases.map(payload => {
      try {
        validateImportedStatePayload(payload);
        return 'accepted';
      } catch (error) {
        return error.message;
      }
    });
  })()`);
  assert.match(result[0], /Course Meter.*between 0 and 12/);
  assert.match(result[1], /turnStep.*between 1 and 5/);
  assert.match(result[2], /Day.*1 or greater/);
  assert.match(result[3], /Food.*0 or greater/);
  assert.match(result[4], /Crew size.*between 4 and 7/);
  assert.match(result[5], /Crew size.*between 4 and 7/);
});

test('import validation rejects malformed nested shapes', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    const crewWithNegativeLabor = structuredClone(defaultState.crew);
    crewWithNegativeLabor[0].labor = -1;
    const cases = [
      {pendingChecks: [{id: 'p1', title: {bad: true}, detail: 'Resolve this.'}]},
      {pendingChecks: [{id: 'p1', title: 'Prompt', detail: 'Resolve this.', outcomes: [{id: 'ok', label: {bad: true}}]}]},
      {ongoing: [{actionId: 'helm', actors: 'Leopold'}]},
      {deferredCompletions: [{actionId: 'repairLeak', actors: [42]}]},
      {conditions: [{name: 'Dense Fog', turns: 'later'}]},
      {turnLedger: {pumping: 'fast'}},
      {waterKnowledge: {knownThisTurn: 'yes'}},
      {crew: crewWithNegativeLabor}
    ];
    return cases.map(payload => {
      try {
        validateImportedStatePayload(payload);
        return 'accepted';
      } catch (error) {
        return error.message;
      }
    });
  })()`);
  assert.match(result[0], /Pending prompt 1 title must be text/);
  assert.match(result[1], /Pending prompt 1 outcome 1 label must be text/);
  assert.match(result[2], /Ongoing work 1 actors must be an array/);
  assert.match(result[3], /Deferred completion 1 actors entry 1 must be text/);
  assert.match(result[4], /Condition 1 turns must be a finite number/);
  assert.match(result[5], /Turn ledger Pumping must be numeric/);
  assert.match(result[6], /Water knowledge known-this-turn flag must be true or false/);
  assert.match(result[7], /Crew entry 1 Labor must be 0 or greater/);
});

test('import normalization migrates compatible old saves', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    const imported = normalizeImportedState({
      travel: 4.75,
      crew: structuredClone(defaultState.crew),
      mast: true,
      rudder: false,
      timber: true
    });
    return {
      version: imported.version,
      travelTicks: imported.travelTicks,
      travel: imported.travel,
      mastStatus: imported.mastStatus,
      rudderStatus: imported.rudderStatus,
      salvagedTimber: imported.salvagedTimber,
      crewSize: imported.crew.length
    };
  })()`);
  assert.equal(result.version, 8);
  assert.equal(result.travelTicks, 38);
  assert.equal(result.travel, 4.75);
  assert.equal(result.mastStatus, 'Repaired');
  assert.equal(result.rudderStatus, 'Broken');
  assert.equal(result.salvagedTimber, 1);
  assert.equal(result.crewSize, 6);
});

test('import normalization rejects unknown action references', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    try {
      normalizeImportedState({
        crew: structuredClone(defaultState.crew),
        plannedActions: {Leopold: 'notAnAction'}
      });
      return 'accepted';
    } catch (error) {
      return error.message;
    }
  })()`);
  assert.match(result, /Unknown planned action/);
});

test('landing screen exposes startup actions safely', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`({
    noSave: landingScreenMarkup(false),
    withSave: landingScreenMarkup(true)
  })`);
  assert.match(result.noSave, /Start a New Voyage/);
  assert.match(result.noSave, /data-action="start-new-voyage"/);
  assert.match(result.noSave, /data-action="resume-current-voyage" disabled/);
  assert.match(result.noSave, /No saved voyage found in this browser/);
  assert.match(result.noSave, /data-action="import-saved-voyage"/);
  assert.doesNotMatch(result.withSave, /data-action="resume-current-voyage" disabled/);
  assert.match(result.withSave, /A saved voyage is available in this browser/);
});

test('old saves migrate as setup complete', () => {
  const tracker = loadTrackerContext();
  const setupComplete = tracker.evaluate(`
    normalizeImportedState({ crew: structuredClone(defaultState.crew) }).setupComplete
  `);
  assert.equal(setupComplete, true);
});

test('starting a new voyage creates and saves default tracker state', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    render = () => {};
    appMode = 'landing';
    state = structuredClone(defaultState);
    state.day = 7;
    startNewVoyage();
    const saved = JSON.parse(localStorage.getItem('openSeaTracker'));
    return {
      appMode,
      stateDay: state.day,
      stateTurn: state.turn,
      savedDay: saved.day,
      savedTurn: saved.turn,
      setupComplete: state.setupComplete,
      log: state.log
    };
  })()`);
  assert.equal(result.appMode, 'tracker');
  assert.equal(result.stateDay, 1);
  assert.equal(result.stateTurn, 1);
  assert.equal(result.savedDay, 1);
  assert.equal(result.savedTurn, 1);
  assert.equal(result.setupComplete, true);
  assert.match(result.log, /Started a new voyage/);
});

test('DM controls use delegated handlers with full dispatcher coverage', () => {
  const files = ['open_sea_tracker.html', 'js/tracker_render.js', 'js/tracker_gameplay.js'];
  const combined = files.map(readProjectFile).join('\n');
  assert.equal(/on(?:click|change|input)=/.test(combined), false);

  const clickActions = [...combined.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]);
  const changeActions = [...combined.matchAll(/data-change-action="([^"]+)"/g)].map(
    (match) => match[1]
  );
  const gameplay = readProjectFile('js/tracker_gameplay.js');

  [...new Set(clickActions)].forEach((action) => {
    assert.match(
      gameplay,
      new RegExp(`case '${action}'`),
      `Missing click dispatcher for ${action}`
    );
  });
  [...new Set(changeActions)].forEach((action) => {
    assert.match(
      gameplay,
      new RegExp(`case '${action}'`),
      `Missing change dispatcher for ${action}`
    );
  });
});

test('player travel display rounds to half-day increments', () => {
  const player = loadPlayerContext();
  const result = player.evaluate(`[
    formatPlayerTravelDays(5.625),
    formatPlayerTravelDays(5.75),
    formatPlayerTravelDays(4.25)
  ]`);
  assert.deepEqual([...result], ['5.5', '6', '4.5']);
});

test('navigate reveals rounded travel remaining', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    syncFromInputs = () => {};
    saveStateSnapshot = () => {};
    render = () => {};
    renderUndoStatus = () => {};
    state = structuredClone(defaultState);
    state.courseMeter = 6;
    state.travelTicks = 45;
    syncTravelDaysFromTicks();
    applyActionStart(state.crew[0], actionById('studyMap'));
    const prompt = state.pendingChecks.find((item) => item.effect === 'navigateCourse');
    resolvePromptOutcome(prompt.id, 'navigateFailure');
    publishPlayerState();
    const playerState = JSON.parse(localStorage.getItem(PLAYER_STATE_KEY));
    return {
      reveals: prompt.reveals,
      courseState: state.playerKnowledge.courseState,
      travel: state.playerKnowledge.travel,
      playerTravelKnown: playerState.travel.known,
      playerTravelValue: playerState.travel.value
    };
  })()`);
  assert.deepEqual([...result.reveals], ['courseState', 'travel']);
  assert.equal(result.courseState, 'Drifting');
  assert.equal(result.travel, 5.5);
  assert.equal(result.playerTravelKnown, true);
  assert.equal(result.playerTravelValue, 5.5);
});

test('water dropping below cargo hold hides exact player value', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    syncFromInputs = () => {};
    render = () => {};
    renderUndoStatus = () => {};
    state = structuredClone(defaultState);
    state.day = 1;
    state.turn = 1;
    state.waterLevel = 5;
    state.minIngress = 2;
    state.activeLeaks = 1;
    state.playerKnowledge.waterLevel = 1;
    state.playerKnowledge.totalIngress = 3;
    state.waterKnowledge.turnKey = currentTurnKey();
    state.waterKnowledge.knownThisTurn = true;
    state.waterKnowledge.exactKnownThisTurn = true;
    state.waterKnowledge.lastKnownTurnKey = currentTurnKey();
    state.waterKnowledge.streak = 2;
    scoreboardChange('waterLevel', -1);
    publishPlayerState();
    const playerState = JSON.parse(localStorage.getItem(PLAYER_STATE_KEY));
    return {
      waterLevel: state.waterLevel,
      playerKnowledgeWater: state.playerKnowledge.waterLevel,
      playerKnowledgeIngress: state.playerKnowledge.totalIngress,
      knownThisTurn: state.waterKnowledge.knownThisTurn,
      exactKnownThisTurn: state.waterKnowledge.exactKnownThisTurn,
      streak: state.waterKnowledge.streak,
      playerWater: playerState.waterLevel
    };
  })()`);
  assert.equal(result.waterLevel, 4);
  assert.equal(result.playerKnowledgeWater, null);
  assert.equal(result.playerKnowledgeIngress, null);
  assert.equal(result.knownThisTurn, false);
  assert.equal(result.exactKnownThisTurn, false);
  assert.equal(result.streak, 0);
  assert.deepEqual(result.playerWater, { known: false, value: null, safeBelowCargo: true });
});

test('bilge rod reading reveals exact water below cargo hold', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    renderUndoStatus = () => {};
    state = structuredClone(defaultState);
    state.day = 1;
    state.turn = 1;
    state.waterLevel = 3;
    rememberPlayerKnowledge('waterLevel');
    publishPlayerState();
    return JSON.parse(localStorage.getItem(PLAYER_STATE_KEY)).waterLevel;
  })()`);
  assert.deepEqual(result, { known: true, value: 3 });
});

test('player safe water text says bilge only', () => {
  const player = loadPlayerContext();
  const result = player.evaluate(`
    waterMeterCard({ known: false, value: null, safeBelowCargo: true })
  `);
  assert.match(result, /Bilge Only/);
  assert.match(result, /Safe, exact level unknown/);
});

test('player active effects include mechanical details', () => {
  const tracker = loadTrackerContext();
  const published = tracker.evaluate(`(() => {
    state = structuredClone(defaultState);
    state.waterLevel = 10;
    publishPlayerState();
    return JSON.parse(localStorage.getItem(PLAYER_STATE_KEY)).effects;
  })()`);
  const waterEffect = [...published].find((effect) => effect.title === 'Waist-Deep Flooding');
  assert.equal(waterEffect.detail, 'Below-deck actions take +1 Turn and cost +1 Labor.');

  const player = loadPlayerContext();
  const fallback = player.evaluate(`(() => {
    const effect = publicEffectsFromFullState({ waterLevel: 10, conditions: [] })[0];
    const element = { innerHTML: '' };
    document.getElementById = () => element;
    renderEffects([effect]);
    return { effect, html: element.innerHTML };
  })()`);
  assert.equal(fallback.effect.detail, 'Below-deck actions take +1 Turn and cost +1 Labor.');
  assert.match(fallback.html, /Waist Deep/);
  assert.match(fallback.html, /Below-deck actions take \+1 Turn and cost \+1 Labor\./);
});

test('player active effects layout supports six wrapped cards', () => {
  const styles = readProjectFile('css/styles.css');
  assert.match(styles, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(
    styles,
    /grid-template-rows:\s*minmax\(118px,\s*16vh\)\s*minmax\(0,\s*1fr\)\s*minmax\(220px,\s*28vh\)/
  );
  assert.match(styles, /\.player-effect-card\s*\{[\s\S]*overflow-wrap:\s*anywhere;/);
  assert.match(styles, /\.player-effect-detail\s*\{[\s\S]*overflow-wrap:\s*anywhere;/);
});

test('player ship systems use check and x symbols', () => {
  const player = loadPlayerContext();
  const result = player.evaluate(`({
    mast: systemCard('Mast', 'Working'),
    pump: systemCard('Pump', 'Jammed'),
    rigging: systemCard('Rigging', 'Broken')
  })`);
  assert.match(result.mast, />✓<\/div>/);
  assert.match(result.mast, /aria-label="Mast: Working"/);
  assert.match(result.pump, />✕<\/div>/);
  assert.match(result.pump, /aria-label="Pump: Jammed"/);
  assert.match(result.rigging, />✕<\/div>/);
  assert.match(result.rigging, /aria-label="Rigging: Broken"/);
});

test('player ship system cards stretch to top-row card height', () => {
  const styles = readProjectFile('css/styles.css');
  assert.match(
    styles,
    /\.player-panel-systems \.player-card-grid\s*\{[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\);[\s\S]*height:\s*calc\(100% - 36px\);/
  );
  assert.match(
    styles,
    /\.player-panel-systems \.player-system-card\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[\s\S]*height:\s*100%;/
  );
  assert.match(
    styles,
    /\.player-panel-systems \.player-system-card \.score-value\s*\{[\s\S]*align-self:\s*center;[\s\S]*justify-self:\s*center;/
  );
});

test('player voyage cards use the shared top-row card format', () => {
  const playerView = readProjectFile('player_view.html');
  const styles = readProjectFile('css/styles.css');

  assert.doesNotMatch(playerView, /player-travel-pair/);
  assert.match(
    playerView,
    /<section class="panel player-hero player-panel-hero">[\s\S]*<h2>Voyage<\/h2>[\s\S]*<div class="player-voyage-card-grid">[\s\S]*id="playerTurn"[\s\S]*id="playerTravel"[\s\S]*id="playerCourseState"/
  );
  assert.match(
    styles,
    /\.player-voyage-card-grid\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);[\s\S]*grid-template-rows:\s*minmax\(0,\s*1fr\);[\s\S]*height:\s*calc\(100% - 44px\);/
  );
  assert.match(
    styles,
    /\.player-voyage-card-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);[\s\S]*height:\s*calc\(100% - 36px\);/
  );
});

test('player top-row values are centered like systems', () => {
  const styles = readProjectFile('css/styles.css');

  assert.match(
    styles,
    /\.player-voyage-card-grid \.player-card,\s*\.player-panel-supplies \.player-card\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[\s\S]*height:\s*100%;/
  );
  assert.match(
    styles,
    /\.player-voyage-card-grid \.score-value,\s*\.player-panel-supplies \.score-value\s*\{[\s\S]*align-self:\s*center;[\s\S]*justify-self:\s*center;[\s\S]*text-align:\s*center;/
  );
});

test('idle shows dash for turns remaining', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    renderUndoStatus = () => {};
    state = structuredClone(defaultState);
    const name = state.crew[0].name;
    state.plannedActions[name] = 'idle';
    publishPlayerState();
    const playerState = JSON.parse(localStorage.getItem(PLAYER_STATE_KEY));
    const playerCrew = playerState.crew.find((character) => character.name === name);
    return {
      dmTurnsRemaining: characterTurnsRemaining(name),
      playerTurnsRemaining: playerCrew.turnsRemaining
    };
  })()`);
  assert.equal(result.dmTurnsRemaining, '-');
  assert.equal(result.playerTurnsRemaining, '-');

  const player = loadPlayerContext();
  const fallback = player.evaluate(`
    publicCrewTurnsRemainingFromFullState({ plannedActions: { Leopold: 'idle' }, ongoing: [], waterLevel: 1 }, 'Leopold')
  `);
  assert.equal(fallback, '');
});

test('unconfirmed remembered action shows dash for turns remaining', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    renderUndoStatus = () => {};
    state = structuredClone(defaultState);
    const name = state.crew[0].name;
    state.plannedActions[name] = 'inventoryFood';
    state.confirmedActions[name] = 'inventoryFood';
    const beforeAdvance = {
      dmTurnsRemaining: characterTurnsRemaining(name),
      doneInStatus: characterDoneInStatus(name)
    };
    advanceTurn(false, false, false);
    publishPlayerState();
    const playerState = JSON.parse(localStorage.getItem(PLAYER_STATE_KEY));
    const playerCrew = playerState.crew.find((character) => character.name === name);
    return {
      beforeAdvance,
      plannedAction: state.plannedActions[name],
      confirmedAction: state.confirmedActions[name] || '',
      dmTurnsRemaining: characterTurnsRemaining(name),
      doneInStatus: characterDoneInStatus(name),
      playerTurnsRemaining: playerCrew.turnsRemaining,
      playerDoneInStatus: playerCrew.doneInStatus
    };
  })()`);
  assert.equal(result.beforeAdvance.dmTurnsRemaining, '1');
  assert.equal(result.beforeAdvance.doneInStatus, 'normal');
  assert.equal(result.plannedAction, 'inventoryFood');
  assert.equal(result.confirmedAction, '');
  assert.equal(result.dmTurnsRemaining, '-');
  assert.equal(result.doneInStatus, '');
  assert.equal(result.playerTurnsRemaining, '-');
  assert.equal(result.playerDoneInStatus, '');

  const player = loadPlayerContext();
  const fallback = player.evaluate(`
    publicCrewTurnsRemainingFromFullState(
      { plannedActions: { Leopold: 'inventoryFood' }, confirmedActions: {}, ongoing: [], waterLevel: 1 },
      'Leopold'
    )
  `);
  assert.equal(fallback, '');
});

test('scripted scene turn forces idle and preserves ongoing work', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    syncFromInputs = () => {};
    saveStateSnapshot = () => {};
    render = () => {};
    renderUndoStatus = () => {};
    state = structuredClone(defaultState);
    state.plannedActions = {
      Leopold: 'helm',
      Delilah: 'studyMap'
    };
    state.confirmedActions = {
      Leopold: 'helm'
    };
    state.pendingChecks = [
      {id:'action-check', phase:'action', status:'pending', title:'Action Check'},
      {id:'pre-check', phase:'preAction', status:'pending', title:'Pre Check'}
    ];
    state.ongoing = [{
      id:'ongoing-rest',
      actionId:'rest',
      actors:['Toady'],
      remaining:1,
      status:'active',
      createdDay:1,
      createdTurn:1
    }];
    forceScriptedSceneTurn();
    return {
      scriptedSceneTurn: state.scriptedSceneTurn,
      turnStep: state.turnStep,
      actions: state.plannedActions,
      confirmations: state.confirmedActions,
      pendingTitles: state.pendingChecks.map(prompt => prompt.title),
      ongoingRemaining: state.ongoing[0].remaining,
      log: state.log
    };
  })()`);
  assert.equal(result.scriptedSceneTurn, true);
  assert.equal(result.turnStep, 5);
  assert.equal(result.actions.Leopold, 'idle');
  assert.equal(result.actions.Delilah, 'idle');
  assert.equal(result.confirmations.Leopold, 'idle');
  assert.equal(result.pendingTitles.includes('Action Check'), false);
  assert.equal(result.pendingTitles.includes('Pre Check'), true);
  assert.equal(result.ongoingRemaining, 1);
  assert.match(result.log, /scripted scene/i);
});
