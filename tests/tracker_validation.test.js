const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const trackerFiles = [
  'js/action_metadata.js',
  'js/tracker_state.js',
  'js/tracker_render_setup.js',
  'js/tracker_render.js',
  'js/tracker_gameplay.js',
  'js/tracker_persistence.js',
  'js/tracker_setup.js'
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

test('default tracker state has a ship name', () => {
  const tracker = loadTrackerContext();
  const shipName = tracker.evaluate('defaultState.shipName');
  assert.equal(shipName, 'The Marrowwind');
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

test('import validation rejects invalid ship names', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    const cases = [
      {shipName: 42},
      {shipName: 'x'.repeat(SHIP_NAME_MAX_LENGTH + 1)}
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
  assert.match(result[0], /Ship name must be text/);
  assert.match(result[1], /Ship name is too long/);
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
      shipName: imported.shipName,
      crewSize: imported.crew.length
    };
  })()`);
  assert.equal(result.version, 9);
  assert.equal(result.travelTicks, 38);
  assert.equal(result.travel, 4.75);
  assert.equal(result.mastStatus, 'Repaired');
  assert.equal(result.rudderStatus, 'Broken');
  assert.equal(result.salvagedTimber, 1);
  assert.equal(result.shipName, 'The Marrowwind');
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
  assert.doesNotMatch(result.noSave, /Open Player View/);
  assert.doesNotMatch(result.withSave, /data-action="resume-current-voyage" disabled/);
  assert.match(result.withSave, /A saved voyage is available in this browser/);
});

test('dm tracker header exposes player view link', () => {
  const html = readProjectFile('open_sea_tracker.html');
  assert.match(html, /Open Player View/);
  assert.match(html, /href="player_view\.html"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener"/);
});

test('old saves migrate as setup complete', () => {
  const tracker = loadTrackerContext();
  const setupComplete = tracker.evaluate(`
    normalizeImportedState({ crew: structuredClone(defaultState.crew) }).setupComplete
  `);
  assert.equal(setupComplete, true);
});

test('dm header renders the ship name', () => {
  const tracker = loadTrackerContext();
  const title = tracker.evaluate(`(() => {
    const title = {textContent: ''};
    document = { getElementById(id) { return id === 'trackerTitle' ? title : null; } };
    state = structuredClone(defaultState);
    state.shipName = ' The Tide Needle ';
    renderShipName();
    return title.textContent;
  })()`);
  assert.equal(title, 'The Tide Needle Tracker');
});

test('exported saves include normalized ship name', () => {
  const tracker = loadTrackerContext();
  const exportedShipName = tracker.evaluate(`(() => {
    let exportedText = '';
    syncFromInputs = () => {};
    render = () => {};
    Blob = function(parts) { exportedText = String(parts[0]); };
    URL = { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} };
    document = {
      body: { appendChild() {} },
      createElement() { return { click() {}, remove() {} }; }
    };
    state = structuredClone(defaultState);
    state.shipName = ' The Tide Needle ';
    exportState();
    return JSON.parse(exportedText).shipName;
  })()`);
  assert.equal(exportedShipName, 'The Tide Needle');
});

test('starting a new voyage opens setup without overwriting saves', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    render = () => {};
    appMode = 'landing';
    state = structuredClone(defaultState);
    state.day = 7;
    localStorage.setItem('openSeaTracker', JSON.stringify({...defaultState, day: 4, shipName: 'Saved Ship'}));
    startNewVoyage();
    const saved = JSON.parse(localStorage.getItem('openSeaTracker'));
    return {
      appMode,
      stateDay: state.day,
      draftShipName: setupDraft.shipName,
      draftCrewSize: setupDraft.crew.length,
      savedDay: saved.day,
      savedShipName: saved.shipName
    };
  })()`);
  assert.equal(result.appMode, 'setup');
  assert.equal(result.stateDay, 7);
  assert.equal(result.draftShipName, 'The Marrowwind');
  assert.equal(result.draftCrewSize, 6);
  assert.equal(result.savedDay, 4);
  assert.equal(result.savedShipName, 'Saved Ship');
});

test('setup screen renders defaults safely', () => {
  const tracker = loadTrackerContext();
  const markup = tracker.evaluate('setupScreenMarkup(defaultSetupDraft(), true)');

  assert.match(markup, /Set Up New Voyage/);
  assert.match(markup, /Voyage Preset/);
  assert.match(markup, /value="The Marrowwind"/);
  assert.match(markup, /Crew Size/);
  [4, 5, 6, 7].forEach((size) =>
    assert.match(
      markup,
      new RegExp(`<option value="${size}"${size === 6 ? ' selected' : ''}>${size} players`)
    )
  );
  ['Leopold', 'Delilah', 'Toady', 'Xander', 'Grumbo', 'Tommy'].forEach((name) =>
    assert.match(markup, new RegExp(`value="${name}"`))
  );
  assert.equal([...markup.matchAll(/data-change-action="set-setup-crew-name"/g)].length, 6);
  assert.equal([...markup.matchAll(new RegExp(`maxlength="${30}" required`, 'g'))].length, 6);
  [
    'Sailor/Pirate',
    'Fisherman',
    'Water Vehicles',
    'Navigator&#039;s Tools',
    'Cartographer&#039;s Tools'
  ].forEach((label) => assert.equal(markup.split(label).length - 1, 6));
  assert.equal([...markup.matchAll(/data-change-action="set-setup-crew-trait"/g)].length, 30);
  assert.equal(
    [...markup.matchAll(/data-change-action="set-setup-crew-trait"[^>]* checked/g)].length,
    2
  );
  assert.match(markup, /data-action="back-to-landing"/);
  assert.match(markup, /data-action="reset-setup-defaults"/);
  assert.match(markup, /data-action="start-setup-voyage"/);
  assert.doesNotMatch(markup, /data-action="start-setup-voyage" disabled/);
  assert.match(markup, /ask before replacing it/);
});

test('setup validation rejects invalid ship names', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    const emptyDraft = defaultSetupDraft();
    emptyDraft.shipName = '   ';
    const longDraft = defaultSetupDraft();
    longDraft.shipName = 'x'.repeat(SHIP_NAME_MAX_LENGTH + 1);
    return {
      empty: setupValidationErrors(emptyDraft),
      longName: setupValidationErrors(longDraft),
      emptyMarkup: setupScreenMarkup(emptyDraft, false),
      longMarkup: setupScreenMarkup(longDraft, false)
    };
  })()`);

  assert.match(result.empty.join(' '), /Ship name is required/);
  assert.match(result.longName.join(' '), /Ship name must be 60 characters or fewer/);
  assert.match(result.emptyMarkup, /Ship name is required/);
  assert.match(result.emptyMarkup, /data-action="start-setup-voyage" disabled/);
  assert.match(result.longMarkup, /Ship name must be 60 characters or fewer/);
  assert.match(result.longMarkup, /data-action="start-setup-voyage" disabled/);
});

test('setup crew name validation trims and rejects invalid names', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    const requiredDraft = defaultSetupDraft();
    requiredDraft.crew[1].name = '   ';
    const longDraft = defaultSetupDraft();
    longDraft.crew[2].name = 'x'.repeat(CREW_NAME_MAX_LENGTH + 1);
    const duplicateDraft = defaultSetupDraft();
    duplicateDraft.crew[0].name = ' Mira ';
    duplicateDraft.crew[1].name = 'mira';
    const inactiveDuplicateDraft = defaultSetupDraft();
    inactiveDuplicateDraft.crewSize = 4;
    inactiveDuplicateDraft.crew[0].name = 'Mira';
    inactiveDuplicateDraft.crew[4].name = 'mira';
    return {
      required: setupCrewNameValidationErrors(requiredDraft),
      longName: setupCrewNameValidationErrors(longDraft),
      duplicate: setupCrewNameValidationErrors(duplicateDraft),
      inactiveDuplicate: setupCrewNameValidationErrors(inactiveDuplicateDraft),
      normalized: normalizedSetupCrewName('  Keel  ')
    };
  })()`);

  assert.match(result.required.join(' '), /Crew 2 name is required/);
  assert.match(result.longName.join(' '), /Crew 3 name must be 30 characters or fewer/);
  assert.match(result.duplicate.join(' '), /Crew 2 name duplicates Crew 1/);
  assert.equal(result.inactiveDuplicate.length, 0);
  assert.equal(result.normalized, 'Keel');
});

test('setup crew name errors render on setup screen', () => {
  const tracker = loadTrackerContext();
  const markup = tracker.evaluate(`(() => {
    const draft = defaultSetupDraft();
    draft.crew[0].name = 'Leopold';
    draft.crew[1].name = ' leopold ';
    draft.crew[2].name = '';
    return setupScreenMarkup(draft, false);
  })()`);

  assert.match(markup, /Crew 2 name duplicates Crew 1/);
  assert.match(markup, /Crew 3 name is required/);
  assert.match(markup, /role="alert"/);
});

test('start voyage blocks invalid setup without saving or publishing', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    appMode = 'setup';
    setupDraft = defaultSetupDraft();
    setupDraft.shipName = '   ';
    setupDraft.crew[0].name = 'Mira';
    setupDraft.crew[1].name = 'mira';
    let renderCount = 0;
    let renderedMarkup = '';
    renderSetupScreen = () => {
      renderCount += 1;
      renderedMarkup = setupScreenMarkup(setupDraftForRender(), false);
    };
    render = () => { throw new Error('render should not run for invalid setup'); };
    confirm = () => { throw new Error('confirm should not run for invalid setup'); };
    const started = startSetupVoyage();
    const duplicateMarkup = renderedMarkup;
    setupDraft = defaultSetupDraft();
    setupDraft.shipName = 'x'.repeat(SHIP_NAME_MAX_LENGTH + 1);
    const longNameStarted = startSetupVoyage();
    const longNameMarkup = renderedMarkup;
    return {
      started,
      longNameStarted,
      appMode,
      renderCount,
      duplicateMarkup,
      longNameMarkup,
      saved: localStorage.getItem('openSeaTracker'),
      published: localStorage.getItem(PLAYER_STATE_KEY)
    };
  })()`);

  assert.equal(result.started, false);
  assert.equal(result.longNameStarted, false);
  assert.equal(result.appMode, 'setup');
  assert.equal(result.renderCount, 2);
  assert.match(result.duplicateMarkup, /Ship name is required/);
  assert.match(result.duplicateMarkup, /Crew 2 name duplicates Crew 1/);
  assert.match(result.longNameMarkup, /Ship name must be 60 characters or fewer/);
  assert.equal(result.saved, null);
  assert.equal(result.published, null);
});

test('valid setup creates, saves, publishes, and enters tracker mode', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    appMode = 'setup';
    setupDraft = defaultSetupDraft();
    setupDraft.shipName = ' The Tide Needle ';
    setupDraft.crewSize = 4;
    setupDraft.crew = setupDraft.crew.slice(0, 4);
    setupDraft.crew[0].name = ' Mira ';
    setupDraft.crew[1].name = 'Jon';
    setupDraft.crew[2].name = 'Pax';
    setupDraft.crew[3].name = 'Rue';
    setupDraft.crew.forEach((character) => {
      SETUP_CREW_TRAIT_FIELDS.forEach(({field}) => {
        character[field] = false;
      });
    });
    setupDraft.crew[0].sailorPirateBackground = true;
    setupDraft.crew[0].waterVehiclesProficiency = true;
    setupDraft.crew[1].fishermanBackground = true;
    setupDraft.crew[2].navigatorToolsProficiency = true;
    setupDraft.crew[3].cartographerToolsProficiency = true;
    render = () => {};
    renderSetupScreen = () => { throw new Error('renderSetupScreen should not run for valid setup'); };
    confirm = () => { throw new Error('confirm should not run without an existing save'); };
    const created = createTrackerStateFromSetup(setupDraft);
    const started = startSetupVoyage();
    const saved = JSON.parse(localStorage.getItem('openSeaTracker'));
    const published = JSON.parse(localStorage.getItem(PLAYER_STATE_KEY));
    return {
      started,
      appMode,
      setupComplete: state.setupComplete,
      createdShipName: created.shipName,
      stateShipName: state.shipName,
      savedShipName: saved.shipName,
      publishedShipName: published.shipName,
      stateCrewNames: state.crew.map((character) => character.name),
      savedCrewNames: saved.crew.map((character) => character.name),
      publishedCrewNames: published.crew.map((character) => character.name),
      traits: state.crew.map((character) => ({
        sailorPirateBackground: character.sailorPirateBackground,
        fishermanBackground: character.fishermanBackground,
        waterVehiclesProficiency: character.waterVehiclesProficiency,
        navigatorToolsProficiency: character.navigatorToolsProficiency,
        cartographerToolsProficiency: character.cartographerToolsProficiency
      })),
      plannedActions: state.plannedActions,
      confirmedActions: state.confirmedActions,
      overtimeKeys: Object.keys(state.overtimeExhaustion),
      log: state.log
    };
  })()`);

  assert.equal(result.started, true);
  assert.equal(result.appMode, 'tracker');
  assert.equal(result.setupComplete, true);
  assert.equal(result.createdShipName, 'The Tide Needle');
  assert.equal(result.stateShipName, 'The Tide Needle');
  assert.equal(result.savedShipName, 'The Tide Needle');
  assert.equal(result.publishedShipName, 'The Tide Needle');
  assert.deepEqual(result.stateCrewNames, ['Mira', 'Jon', 'Pax', 'Rue']);
  assert.deepEqual(result.savedCrewNames, ['Mira', 'Jon', 'Pax', 'Rue']);
  assert.deepEqual(result.publishedCrewNames, ['Mira', 'Jon', 'Pax', 'Rue']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.traits)), [
    {
      sailorPirateBackground: true,
      fishermanBackground: false,
      waterVehiclesProficiency: true,
      navigatorToolsProficiency: false,
      cartographerToolsProficiency: false
    },
    {
      sailorPirateBackground: false,
      fishermanBackground: true,
      waterVehiclesProficiency: false,
      navigatorToolsProficiency: false,
      cartographerToolsProficiency: false
    },
    {
      sailorPirateBackground: false,
      fishermanBackground: false,
      waterVehiclesProficiency: false,
      navigatorToolsProficiency: true,
      cartographerToolsProficiency: false
    },
    {
      sailorPirateBackground: false,
      fishermanBackground: false,
      waterVehiclesProficiency: false,
      navigatorToolsProficiency: false,
      cartographerToolsProficiency: true
    }
  ]);
  assert.equal(JSON.stringify(result.plannedActions), '{}');
  assert.equal(JSON.stringify(result.confirmedActions), '{}');
  assert.deepEqual(result.overtimeKeys, ['Mira', 'Jon', 'Pax', 'Rue']);
  assert.match(result.log, /Started a new voyage aboard The Tide Needle/);
});

test('existing save confirmation controls setup overwrite', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    function prepareDraft(shipName) {
      appMode = 'setup';
      setupDraft = defaultSetupDraft();
      setupDraft.shipName = shipName;
      setupDraft.crew[0].name = 'Mira';
      setupDraft.crew[1].name = 'Jon';
    }
    const oldSave = {...defaultState, day: 5, shipName: 'Saved Ship'};
    const oldPlayer = {shipName: 'Published Ship', crew: [{name: 'Old Crew'}]};
    localStorage.setItem('openSeaTracker', JSON.stringify(oldSave));
    localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify(oldPlayer));
    render = () => {};
    let renderSetupCount = 0;
    renderSetupScreen = () => { renderSetupCount += 1; };
    let cancelConfirmMessage = '';
    confirm = (message) => {
      cancelConfirmMessage = message;
      return false;
    };
    prepareDraft('Cancelled Ship');
    const cancelled = startSetupVoyage();
    const cancelledSave = JSON.parse(localStorage.getItem('openSeaTracker'));
    const cancelledPlayer = JSON.parse(localStorage.getItem(PLAYER_STATE_KEY));
    const cancelledDraft = structuredClone(setupDraft);
    const appModeAfterCancel = appMode;
    let confirmMessage = '';
    confirm = (message) => {
      confirmMessage = message;
      return true;
    };
    prepareDraft('Confirmed Ship');
    const confirmed = startSetupVoyage();
    const confirmedSave = JSON.parse(localStorage.getItem('openSeaTracker'));
    const confirmedPlayer = JSON.parse(localStorage.getItem(PLAYER_STATE_KEY));
    return {
      cancelled,
      appModeAfterCancel,
      renderSetupCount,
      cancelConfirmMessage,
      cancelledSaveShipName: cancelledSave.shipName,
      cancelledSaveDay: cancelledSave.day,
      cancelledPlayerShipName: cancelledPlayer.shipName,
      cancelledDraftShipName: cancelledDraft.shipName,
      confirmed,
      appMode,
      confirmMessage,
      confirmedSaveShipName: confirmedSave.shipName,
      confirmedPlayerShipName: confirmedPlayer.shipName
    };
  })()`);

  assert.equal(result.cancelled, false);
  assert.equal(result.appModeAfterCancel, 'setup');
  assert.equal(result.renderSetupCount, 1);
  assert.match(result.cancelConfirmMessage, /replace the saved voyage/);
  assert.equal(result.cancelledSaveShipName, 'Saved Ship');
  assert.equal(result.cancelledSaveDay, 5);
  assert.equal(result.cancelledPlayerShipName, 'Published Ship');
  assert.equal(result.cancelledDraftShipName, 'Cancelled Ship');
  assert.equal(result.confirmed, true);
  assert.equal(result.appMode, 'tracker');
  assert.match(result.confirmMessage, /replace the saved voyage/);
  assert.equal(result.confirmedSaveShipName, 'Confirmed Ship');
  assert.equal(result.confirmedPlayerShipName, 'Confirmed Ship');
});

test('setup crew size supports four through seven players', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    setupDraft = defaultSetupDraft();
    let renderCount = 0;
    renderSetupScreen = () => { renderCount += 1; };
    setSetupCrewName(3, 'Quartermaster');
    setSetupCrewTrait(3, 'fishermanBackground', true);
    setSetupCrewSize(4);
    const fourMarkup = setupScreenMarkup(setupDraftForRender(), false);
    const afterFour = structuredClone(setupDraft);
    setSetupCrewSize(7);
    const sevenMarkup = setupScreenMarkup(setupDraftForRender(), false);
    const afterSeven = structuredClone(setupDraft);
    setSetupCrewSize(99);
    return {
      fourCrewRows: (fourMarkup.match(/data-change-action="set-setup-crew-name"/g) || []).length,
      fourTraitRows: (fourMarkup.match(/data-change-action="set-setup-crew-trait"/g) || []).length,
      fourSelected: fourMarkup.includes('<option value="4" selected>4 players'),
      preservedName: afterFour.crew[3].name,
      preservedTrait: afterFour.crew[3].fishermanBackground,
      sevenCrewRows: (sevenMarkup.match(/data-change-action="set-setup-crew-name"/g) || []).length,
      sevenTraitRows: (sevenMarkup.match(/data-change-action="set-setup-crew-trait"/g) || []).length,
      sevenSelected: sevenMarkup.includes('<option value="7" selected>7 players'),
      playerSeven: afterSeven.crew[6].name,
      clampedSize: setupDraft.crewSize,
      renderCount
    };
  })()`);

  assert.equal(result.fourCrewRows, 4);
  assert.equal(result.fourTraitRows, 20);
  assert.equal(result.fourSelected, true);
  assert.equal(result.preservedName, 'Quartermaster');
  assert.equal(result.preservedTrait, true);
  assert.equal(result.sevenCrewRows, 7);
  assert.equal(result.sevenTraitRows, 35);
  assert.equal(result.sevenSelected, true);
  assert.equal(result.playerSeven, 'Player 7');
  assert.equal(result.clampedSize, 7);
  assert.equal(result.renderCount, 4);
});

test('setup back and reset stay in memory only', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    render = () => {};
    renderSetupScreen = () => {};
    appMode = 'setup';
    localStorage.setItem('openSeaTracker', JSON.stringify({...defaultState, day: 5, shipName: 'Saved Ship'}));
    setSetupField('shipName', 'Draft Ship');
    setSetupCrewName(0, ' Mira ');
    setSetupCrewTrait(0, 'navigatorToolsProficiency', true);
    setSetupCrewTrait(1, 'fishermanBackground', true);
    setSetupCrewTrait(2, 'waterVehiclesProficiency', true);
    setSetupCrewTrait(3, 'cartographerToolsProficiency', true);
    const edited = structuredClone(setupDraft);
    resetSetupDefaults();
    const reset = structuredClone(setupDraft);
    backToLanding();
    const saved = JSON.parse(localStorage.getItem('openSeaTracker'));
    return {
      editedShipName: edited.shipName,
      editedCrewName: edited.crew[0].name,
      editedNavigator: edited.crew[0].navigatorToolsProficiency,
      editedFisherman: edited.crew[1].fishermanBackground,
      editedWaterVehicles: edited.crew[2].waterVehiclesProficiency,
      editedCartographer: edited.crew[3].cartographerToolsProficiency,
      resetShipName: reset.shipName,
      resetCrewName: reset.crew[0].name,
      resetNavigator: reset.crew[0].navigatorToolsProficiency,
      appMode,
      savedDay: saved.day,
      savedShipName: saved.shipName,
      published: localStorage.getItem(PLAYER_STATE_KEY)
    };
  })()`);
  assert.equal(result.editedShipName, 'Draft Ship');
  assert.equal(result.editedCrewName, 'Mira');
  assert.equal(result.editedNavigator, true);
  assert.equal(result.editedFisherman, true);
  assert.equal(result.editedWaterVehicles, true);
  assert.equal(result.editedCartographer, true);
  assert.equal(result.resetShipName, 'The Marrowwind');
  assert.equal(result.resetCrewName, 'Leopold');
  assert.equal(result.resetNavigator, false);
  assert.equal(result.appMode, 'landing');
  assert.equal(result.savedDay, 5);
  assert.equal(result.savedShipName, 'Saved Ship');
  assert.equal(result.published, null);
});

test('repair actions are unavailable without repair materials', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    state = structuredClone(defaultState);
    state.repairMaterials = 0;
    state.activeLeaks = 1;
    state.pumpStatus = 'Jammed';
    state.riggingStatus = 'Broken';
    state.mastStatus = 'Broken';
    state.rudderStatus = 'Broken';
    const options = availableActionOptions('Leopold');
    return {
      options,
      pumpProblem: actionRequirementProblem(actionById('repairPump')),
      leakProblem: actionRequirementProblem(actionById('repairLeak')),
      mastProblem: actionRequirementProblem(actionById('repairMast'))
    };
  })()`);

  ['repairPump', 'repairRigging', 'repairLeak', 'repairMast', 'repairRudder'].forEach((actionId) =>
    assert.equal(result.options.includes(actionId), false)
  );
  assert.match(result.pumpProblem, /requires 1 Repair Material, but only 0 available/);
  assert.match(result.leakProblem, /requires 1 Repair Material, but only 0 available/);
  assert.match(result.mastProblem, /requires 1 Repair Material, but only 0 available/);
});

test('repair confirmation is blocked without repair materials', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    state = structuredClone(defaultState);
    state.repairMaterials = 0;
    state.riggingStatus = 'Broken';
    state.plannedActions.Leopold = 'repairRigging';
    const confirmableBefore = canConfirmAction('Leopold');
    confirmCharacterAction('Leopold', false, false);
    return {
      confirmableBefore,
      confirmedAction: state.confirmedActions.Leopold || '',
      pendingPromptCount: state.pendingChecks.length,
      log: state.log
    };
  })()`);

  assert.equal(result.confirmableBefore, false);
  assert.equal(result.confirmedAction, '');
  assert.equal(result.pendingPromptCount, 0);
  assert.match(result.log, /could not confirm Repair Rigging/);
  assert.match(result.log, /require 1 Repair Material, but only 0 available/);
});

test('repair plans cannot spend more materials than available', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    state = structuredClone(defaultState);
    state.repairMaterials = 1;
    state.activeLeaks = 2;
    state.plannedActions.Leopold = 'repairLeak';
    state.plannedActions.Delilah = 'repairLeak';
    const oneTeamProblems = actionPlanProblemsFor('repairLeak');
    const oneTeamConfirmable = canConfirmAction('Leopold');
    const toadyOptions = availableActionOptions('Toady');
    state.plannedActions.Toady = 'repairLeak';
    state.plannedActions.Xander = 'repairLeak';
    const twoTeamProblems = actionPlanProblemsFor('repairLeak');
    const twoTeamConfirmable = canConfirmAction('Leopold');
    return {
      oneTeamProblems,
      oneTeamConfirmable,
      toadyCanAddRepairLeak: toadyOptions.includes('repairLeak'),
      twoTeamProblems,
      twoTeamConfirmable
    };
  })()`);

  assert.equal(JSON.stringify(result.oneTeamProblems), '[]');
  assert.equal(result.oneTeamConfirmable, true);
  assert.equal(result.toadyCanAddRepairLeak, false);
  assert.match(
    result.twoTeamProblems.join(' '),
    /require 2 Repair Materials, but only 1 available/
  );
  assert.equal(result.twoTeamConfirmable, false);
});

test('salvage lumber adds repair materials as a one-person action', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    state = structuredClone(defaultState);
    state.waterLevel = 10;
    state.repairMaterials = 1;
    const character = crewByName('Leopold');
    const action = actionById('salvageLumber');
    applyActionStart(character, action);
    return {
      name: action.name,
      labor: character.labor,
      duration: actionDuration(action, character.name),
      repairMaterials: state.repairMaterials,
      ongoingCount: state.ongoing.length,
      log: state.log
    };
  })()`);

  assert.equal(result.name, 'Salvage Lumber');
  assert.equal(result.labor, 1);
  assert.equal(result.duration, 1);
  assert.equal(result.repairMaterials, 3);
  assert.equal(result.ongoingCount, 0);
  assert.match(result.log, /salvaged lumber/);
});

test('salvage lumber below deck uses flooding penalties', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    state = structuredClone(defaultState);
    state.waterLevel = 10;
    state.repairMaterials = 1;
    state.plannedActions.Leopold = 'salvageLumber';
    state.salvageLumberBelowDeck.Leopold = true;
    const character = crewByName('Leopold');
    const action = actionById('salvageLumber');
    applyActionStart(character, action);
    return {
      labor: character.labor,
      duration: actionDuration(action, character.name),
      durationPenalty: belowDeckDurationPenalty(action, character.name),
      laborPenalty: belowDeckLaborPenalty(action, character.name),
      turnsRemaining: characterTurnsRemaining('Leopold'),
      doneInStatus: characterDoneInStatus('Leopold'),
      repairMaterials: state.repairMaterials,
      ongoing: state.ongoing[0]
    };
  })()`);

  assert.equal(result.labor, 2);
  assert.equal(result.duration, 2);
  assert.equal(result.durationPenalty, 1);
  assert.equal(result.laborPenalty, 1);
  assert.equal(result.turnsRemaining, '1');
  assert.equal(result.doneInStatus, 'normal');
  assert.equal(result.repairMaterials, 1);
  assert.equal(result.ongoing.actionId, 'salvageLumber');
  assert.deepEqual([...result.ongoing.actors], ['Leopold']);
});

test('salvage lumber deck checkbox renders and updates state', () => {
  const tracker = loadTrackerContext();
  const result = tracker.evaluate(`(() => {
    state = structuredClone(defaultState);
    state.plannedActions.Leopold = 'salvageLumber';
    let renderCount = 0;
    pushUndo = () => {};
    render = () => { renderCount += 1; };
    const before = salvageLumberDeckChoiceControl('Leopold', 0, 'salvageLumber', false);
    setSalvageLumberDeckChoice(0, true);
    const after = salvageLumberDeckChoiceControl('Leopold', 0, 'salvageLumber', false);
    setSalvageLumberDeckChoice(0, false);
    return {
      before,
      after,
      belowDeck: state.salvageLumberBelowDeck.Leopold || false,
      renderCount
    };
  })()`);

  assert.match(result.before, /data-change-action="set-salvage-lumber-deck"/);
  assert.doesNotMatch(result.before, /<input[^>]* checked/);
  assert.match(result.after, /<input[^>]* checked/);
  assert.equal(result.belowDeck, false);
  assert.equal(result.renderCount, 2);
});

test('DM controls use delegated handlers with full dispatcher coverage', () => {
  const files = [
    'open_sea_tracker.html',
    'js/tracker_render_setup.js',
    'js/tracker_render.js',
    'js/tracker_gameplay.js'
  ];
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

test('published player state includes ship name', () => {
  const tracker = loadTrackerContext();
  const shipName = tracker.evaluate(`(() => {
    state = structuredClone(defaultState);
    state.shipName = 'The Tide Needle';
    publishPlayerState();
    return JSON.parse(localStorage.getItem(PLAYER_STATE_KEY)).shipName;
  })()`);
  assert.equal(shipName, 'The Tide Needle');
});

test('player header renders ship name with old snapshot fallback', () => {
  const player = loadPlayerContext();
  const result = player.evaluate(`(() => {
    const title = {textContent: ''};
    document.getElementById = (id) => id === 'playerTitle' ? title : null;
    renderPlayerTitle({shipName: 'The Tide Needle'});
    const custom = title.textContent;
    renderPlayerTitle({});
    return {custom, fallback: title.textContent};
  })()`);
  assert.equal(result.custom, 'The Tide Needle Status');
  assert.equal(result.fallback, 'The Marrowwind Status');
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
