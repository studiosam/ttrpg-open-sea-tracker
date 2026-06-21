const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const trackerFiles = [
  'action_metadata.js',
  'tracker_state.js',
  'tracker_render.js',
  'tracker_gameplay.js',
  'tracker_persistence.js'
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
  vm.runInContext(readProjectFile('action_metadata.js'), context, {
    filename: 'action_metadata.js'
  });
  const playerSource = readProjectFile('player_view.js').replace(
    /\/\/ Storage events update this page[\s\S]*$/,
    ''
  );
  vm.runInContext(playerSource, context, { filename: 'player_view.js' });
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

test('DM controls use delegated handlers with full dispatcher coverage', () => {
  const files = ['open_sea_tracker.html', 'tracker_render.js', 'tracker_gameplay.js'];
  const combined = files.map(readProjectFile).join('\n');
  assert.equal(/on(?:click|change|input)=/.test(combined), false);

  const clickActions = [...combined.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]);
  const changeActions = [...combined.matchAll(/data-change-action="([^"]+)"/g)].map(
    (match) => match[1]
  );
  const gameplay = readProjectFile('tracker_gameplay.js');

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
