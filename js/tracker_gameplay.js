// DM actions, prompts, turn flow, events, meals, and overtime handlers.
function setPlannedAction(index, actionId) {
  syncFromInputs();
  const name = state.crew[index].name;
  pushUndo(actionId ? `Planned ${name}'s action` : `Cleared ${name}'s planned action`);
  clearActionCommitSnapshot();
  state.actionsCommittedThisTurn = false;
  if (actionId) state.plannedActions[name] = actionId;
  else delete state.plannedActions[name];
  if (actionId !== 'salvageLumber') delete state.salvageLumberBelowDeck[name];
  delete state.confirmedActions[name];
  const action = actionById(actionId);
  log(action ? `${name} is planning to ${action.name}.` : `${name}'s planned action was cleared.`);
  render();
}

function setUnsetActionsToIdle() {
  syncFromInputs();
  const unsetCrew = state.crew.filter((character) => !state.plannedActions[character.name]);
  if (!unsetCrew.length) return;
  pushUndo('Set unset actions to Idle');
  unsetCrew.forEach((character) => {
    state.plannedActions[character.name] = 'idle';
    delete state.confirmedActions[character.name];
  });
  log(`Set unset actions to Idle for ${unsetCrew.map((character) => character.name).join(', ')}.`);
  render();
}

function clearCharacterAction(name) {
  syncFromInputs();
  pushUndo(`Cleared ${name}'s planned action`);
  clearActionCommitSnapshot();
  state.actionsCommittedThisTurn = false;
  delete state.plannedActions[name];
  delete state.confirmedActions[name];
  delete state.salvageLumberBelowDeck[name];
  log(`${name}'s planned action was cleared.`);
  render();
}

function forceScriptedSceneTurn() {
  syncFromInputs();
  pushUndo('Handled scripted scene turn');
  clearActionCommitSnapshot();
  state.crew.forEach((character) => {
    state.plannedActions[character.name] = 'idle';
    state.confirmedActions[character.name] = 'idle';
  });
  state.pendingChecks = state.pendingChecks.filter(
    (prompt) => prompt.phase !== 'action' || prompt.status === 'resolved'
  );
  state.startedGroups = {};
  state.actionsCommittedThisTurn = true;
  state.scriptedSceneTurn = true;
  state.turnStep = 5;
  log(
    'This turn was handled as a scripted scene. Normal crew actions were forced to Idle and ongoing work will pause until the next normal turn.'
  );
  saveStateSnapshot();
  render();
}

function confirmCharacterActionByIndex(index) {
  const character = state.crew[index];
  if (character) confirmCharacterAction(character.name);
}

function clearCharacterActionByIndex(index) {
  const character = state.crew[index];
  if (character) clearCharacterAction(character.name);
}

function renameCrewMember(index, rawName) {
  syncFromInputs();
  const character = state.crew[index];
  if (!character) return;
  const oldName = character.name;
  const newName = String(rawName || '').trim();
  if (!newName || newName === oldName) {
    render();
    return;
  }
  if (
    state.crew.some((crewMember, crewIndex) => crewIndex !== index && crewMember.name === newName)
  ) {
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

function setCrewBackground(index, hasBackground) {
  const character = state.crew[index];
  if (!character) return;
  pushUndo(`Changed ${character.name}'s background`);
  character.sailorPirateBackground = Boolean(hasBackground);
  log(
    `Crew setup: ${character.name} ${character.sailorPirateBackground ? 'has' : 'does not have'} a sailor/pirate background.`
  );
  saveStateSnapshot();
  render();
}

function setCrewProficiency(index, field, hasProficiency) {
  const character = state.crew[index];
  if (
    !character ||
    ![
      'fishermanBackground',
      'waterVehiclesProficiency',
      'navigatorToolsProficiency',
      'cartographerToolsProficiency'
    ].includes(field)
  )
    return;
  pushUndo(`Changed ${character.name}'s ${fieldLabel(field)}`);
  character[field] = Boolean(hasProficiency);
  log(
    `Crew setup: ${character.name} ${character[field] ? 'has' : 'does not have'} ${fieldLabel(field)}.`
  );
  saveStateSnapshot();
  render();
}

function setSalvageLumberDeckChoice(index, belowDeck) {
  const character = state.crew[index];
  if (!character || state.confirmedActions[character.name]) return;
  pushUndo(`Changed ${character.name}'s salvage lumber location`);
  if (belowDeck) state.salvageLumberBelowDeck[character.name] = true;
  else delete state.salvageLumberBelowDeck[character.name];
  log(
    `${character.name} will salvage lumber ${belowDeck ? 'below deck' : 'above deck'} if that action is confirmed.`
  );
  render();
}

function changeCrewSize(amount) {
  syncFromInputs();
  const beforeSize = state.crew.length;
  const targetSize = clampCrewSize(beforeSize + Number(amount || 0));
  if (targetSize === beforeSize) return;
  pushUndo('Changed crew size');
  if (targetSize > beforeSize) {
    for (let index = beforeSize; index < targetSize; index += 1) {
      const name = uniqueCrewName(defaultCrewName(index));
      state.crew.push(defaultCrewMember(index, name));
      state.overtimeExhaustion[name] = 0;
    }
  } else {
    const removed = state.crew.splice(targetSize);
    removed.forEach((character) => removeCrewReferences(character.name));
  }
  log(`Crew size changed from ${beforeSize} to ${state.crew.length}.`);
  saveStateSnapshot();
  render();
}

function removeCrewReferences(name) {
  delete state.plannedActions[name];
  delete state.confirmedActions[name];
  delete state.overtimeExhaustion[name];
  delete state.salvageLumberBelowDeck[name];
  Object.keys(state.playerKnowledge || {}).forEach((key) => {
    if (
      state.playerKnowledge[key] &&
      typeof state.playerKnowledge[key] === 'object' &&
      state.playerKnowledge[key].character === name
    ) {
      delete state.playerKnowledge[key];
    }
  });
  state.ongoing.forEach((item) => {
    item.actors = (item.actors || []).filter((actor) => actor !== name);
  });
  state.deferredCompletions.forEach((item) => {
    item.actors = (item.actors || []).filter((actor) => actor !== name);
  });
  Object.keys(state.startedGroups || {}).forEach((actionId) => {
    state.startedGroups[actionId] = (state.startedGroups[actionId] || []).filter(
      (actor) => actor !== name
    );
    if (!state.startedGroups[actionId].length) delete state.startedGroups[actionId];
  });
  state.pendingChecks = state.pendingChecks.filter((prompt) => prompt.character !== name);
  state.ongoing = state.ongoing.filter((item) => (item.actors || []).length);
  state.deferredCompletions = state.deferredCompletions.filter(
    (item) => (item.actors || []).length
  );
}

function pruneCrewScopedState() {
  const activeCrewNames = new Set(state.crew.map((character) => character.name));
  Object.keys(state.plannedActions || {}).forEach((name) => {
    if (!activeCrewNames.has(name)) delete state.plannedActions[name];
  });
  Object.keys(state.confirmedActions || {}).forEach((name) => {
    if (!activeCrewNames.has(name)) delete state.confirmedActions[name];
  });
  Object.keys(state.overtimeExhaustion || {}).forEach((name) => {
    if (!activeCrewNames.has(name)) delete state.overtimeExhaustion[name];
  });
  Object.keys(state.salvageLumberBelowDeck || {}).forEach((name) => {
    if (!activeCrewNames.has(name)) delete state.salvageLumberBelowDeck[name];
  });
  state.ongoing = state.ongoing
    .map((item) => ({
      ...item,
      actors: (item.actors || []).filter((name) => activeCrewNames.has(name))
    }))
    .filter((item) => item.actors.length);
  state.deferredCompletions = state.deferredCompletions
    .map((item) => ({
      ...item,
      actors: (item.actors || []).filter((name) => activeCrewNames.has(name))
    }))
    .filter((item) => item.actors.length);
  state.pendingChecks = state.pendingChecks.filter(
    (prompt) => !prompt.character || activeCrewNames.has(prompt.character)
  );
  Object.keys(state.startedGroups || {}).forEach((actionId) => {
    state.startedGroups[actionId] = (state.startedGroups[actionId] || []).filter((name) =>
      activeCrewNames.has(name)
    );
    if (!state.startedGroups[actionId].length) delete state.startedGroups[actionId];
  });
}

function remapCrewName(oldName, newName) {
  remapObjectKey(state.plannedActions, oldName, newName);
  remapObjectKey(state.confirmedActions, oldName, newName);
  remapObjectKey(state.overtimeExhaustion, oldName, newName);
  remapObjectKey(state.salvageLumberBelowDeck, oldName, newName);
  state.ongoing.forEach((item) => {
    item.actors = remapNameList(item.actors, oldName, newName);
  });
  state.deferredCompletions.forEach((item) => {
    item.actors = remapNameList(item.actors, oldName, newName);
  });
  Object.keys(state.startedGroups || {}).forEach((actionId) => {
    state.startedGroups[actionId] = remapNameList(state.startedGroups[actionId], oldName, newName);
  });
  state.pendingChecks.forEach((prompt) => {
    if (prompt.character === oldName) prompt.character = newName;
  });
}

function remapObjectKey(object, oldName, newName) {
  if (!object || !Object.prototype.hasOwnProperty.call(object, oldName)) return;
  object[newName] = object[oldName];
  delete object[oldName];
}

function remapNameList(names, oldName, newName) {
  return (names || []).map((name) => (name === oldName ? newName : name));
}

function confirmAllActions() {
  syncFromInputs();
  pushUndo('Confirmed available actions');
  state.crew.forEach((c) => {
    if (canConfirmAction(c.name)) confirmCharacterAction(c.name, false, false);
  });
  render();
}

// Confirming marks player intent only. Labor, checks, and action starts commit when leaving Set Actions.
function confirmCharacterAction(name, shouldRender = true, shouldSync = true) {
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
  if (
    !action.allowMultipleGroups &&
    groupAlreadyStarted(action.id) &&
    !isLockedGroupMember(action.id, name)
  ) {
    addPrompt({
      type: 'manual',
      character: name,
      title: `Cannot Confirm ${action.name}`,
      detail: 'This grouped action has already started with a different selected group.',
      effect: 'manual'
    });
    log(
      `${name} could not confirm ${action.name} because another group has already started that action.`
    );
    if (shouldRender) render();
    return;
  }
  const requirementProblem = actionRequirementProblem(action);
  const planProblems = isLockedGroupMember(action.id, name) ? [] : actionPlanProblemsFor(action.id);
  if (planProblems.length) {
    addPrompt({
      type: 'manual',
      character: name,
      title: `Cannot Confirm ${action.name}`,
      detail: planProblems.join(' '),
      effect: 'manual'
    });
    log(`${name} could not confirm ${action.name}. ${planProblems.join(' ')}`);
    if (shouldRender) render();
    return;
  }
  if (requirementProblem) {
    addPrompt({
      type: 'manual',
      character: name,
      title: `Cannot Confirm ${action.name}`,
      detail: requirementProblem,
      effect: 'manual'
    });
    log(`${name} could not confirm ${action.name}. ${requirementProblem}`);
    if (shouldRender) render();
    return;
  }
  if (action.groupSize && !groupIsReady(action.id)) {
    addPrompt({
      type: 'manual',
      character: name,
      title: `Waiting on ${action.name}`,
      detail: `This action requires ${action.groupSize} players. Select the required participants, then confirm them.`,
      effect: 'manual'
    });
    log(`${name} selected ${action.name}; waiting for ${action.groupSize} total participants.`);
    if (shouldRender) render();
    return;
  }
  state.confirmedActions[name] = action.id;
  log(`${name} confirmed intent to ${action.name}.`);
  if (shouldRender) render();
}

function commitConfirmedActions() {
  const unconfirmedCount = state.crew.filter(
    (c) => state.plannedActions[c.name] && !state.confirmedActions[c.name]
  ).length;
  if (!actionsStepComplete(unconfirmedCount)) return false;
  if (state.actionsCommittedThisTurn) return true;
  storeActionCommitSnapshot(state);
  state.crew.forEach((character) => {
    const action = actionById(state.confirmedActions[character.name]);
    if (action) commitConfirmedAction(character, action);
  });
  state.actionsCommittedThisTurn = true;
  log('Committed the confirmed action plan and created required checks.');
  return true;
}

function commitConfirmedAction(character, action) {
  const continuing = state.ongoing.find(
    (o) => o.status === 'active' && o.actionId === action.id && o.actors.includes(character.name)
  );
  const isLaterTurn =
    continuing && (continuing.createdDay !== state.day || continuing.createdTurn !== state.turn);
  if (continuing && isLaterTurn) {
    character.lastAction = action.name;
    if (continuing.remaining <= 0) completeOngoing(continuing.id, false);
    else log(`${character.name} continued ${action.name}.`);
    return;
  }
  applyActionStart(character, action);
}

function rollbackActionCommit() {
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

function groupIsReady(actionId) {
  const action = actionById(actionId);
  if (!action.groupSize) return true;
  const count = selectedCount(actionId);
  if (action.allowMultipleGroups) {
    return count >= action.groupSize && count % action.groupSize === 0;
  }
  return count === action.groupSize;
}

// Starts a single action after validation. Multi-turn and deferred work branch here.
function applyActionStart(character, action) {
  const before = Number(character.labor);
  const laborChange = actionLaborCost(action, character.name);
  character.labor = Math.max(0, before + laborChange);
  character.lastAction = action.name;
  const isSharedRun = action.sharedStart || action.groupSize || boostActive(action);
  const alreadyStarted = groupAlreadyStarted(action.id);
  const actors = actionActors(character.name, action);
  const completionActors = action.allowMultipleGroups
    ? confirmedActionActors(action.id, character.name)
    : actors;
  const allActorsConfirmed = actors.every(
    (name) => name === character.name || state.confirmedActions[name] === action.id
  );
  if (isSharedRun && !alreadyStarted && !action.allowMultipleGroups) lockStartedGroup(action);
  if (action.start && (!isSharedRun || (!hasActiveOngoingForAction(action.id) && !alreadyStarted)))
    action.start(state, character);
  const duration = actionDuration(action, character.name);
  log(
    `${character.name} confirmed ${action.name}. Labor changed from ${before} to ${character.labor}.`
  );
  maybeAddLaborSave(character, before);
  maybeAddActionPrompt(character, action);
  const canCompleteNow = action.completeAfterAllConfirmed
    ? allActorsConfirmed
    : !isSharedRun || !alreadyStarted;
  if (duration > 1) createOngoing(character.name, action, duration);
  else if (
    action.deferComplete &&
    (!isSharedRun || !alreadyStarted || action.allowMultipleGroups)
  ) {
    deferActionCompletion(action, completionActors);
  } else if (
    (action.completeOnConfirm || (!action.check && !action.completeChoice)) &&
    canCompleteNow
  ) {
    completeAction(action, actors);
  }
}

function confirmedActionActors(actionId, currentName) {
  return state.crew
    .filter((character) => state.plannedActions[character.name] === actionId)
    .filter(
      (character) =>
        character.name === currentName || state.confirmedActions[character.name] === actionId
    )
    .map((character) => character.name);
}

// Deferred completions resolve during the water/end-turn phase, not immediately on confirmation.
function deferActionCompletion(action, actors) {
  if (!state.deferredCompletions) state.deferredCompletions = [];
  const alreadyQueued = state.deferredCompletions.find(
    (item) =>
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

function createOngoing(name, action, remaining) {
  if (
    state.ongoing.some(
      (o) => o.status === 'active' && o.actionId === action.id && o.actors.includes(name)
    )
  )
    return;
  const actors = actionActors(name, action);
  state.ongoing.push({
    id: safeId(),
    actionId: action.id,
    actors,
    remaining,
    status: 'active',
    createdDay: state.day,
    createdTurn: state.turn
  });
  log(
    `${actors.join(', ')} started ${action.name}; ${remaining} turn${remaining === 1 ? '' : 's'} remaining.`
  );
}

function completeOngoing(id, shouldRender = true) {
  if (shouldRender) syncFromInputs();
  const ongoing = state.ongoing.find((o) => o.id === id);
  if (!ongoing || ongoing.status !== 'active') return;
  const action = actionById(ongoing.actionId);
  completeAction(action, ongoing.actors);
  ongoing.status = 'resolved';
  ongoing.remaining = 0;
  ongoing.actors.forEach((name) => delete state.plannedActions[name]);
  log(`${ongoing.actors.join(', ')} completed ${action.name}.`);
  if (shouldRender) render();
}

function interruptSelectedWork() {
  syncFromInputs();
  state.ongoing
    .filter((o) => o.status === 'active')
    .forEach((o) => {
      const shouldCancel = o.actors.some(
        (name) => state.plannedActions[name] && state.plannedActions[name] !== o.actionId
      );
      if (shouldCancel) {
        o.status = 'cancelled';
        log(`Interrupted ${actionById(o.actionId).name} for ${o.actors.join(', ')}.`);
      }
    });
  render();
}

// Completion applies action effects, resource costs, and player knowledge reveals.
function completeAction(action, actors) {
  if (action.completeChoice === 'rest') {
    actors.forEach((name) =>
      addPrompt({
        phase: 'preAction',
        type: 'manual',
        character: name,
        title: 'Complete Rest',
        detail:
          'Choose the rest benefit for this character before they select an action this turn.',
        effect: 'restChoice',
        outcomes: [
          { id: 'recoverLabor', label: 'Recover 2 Labor', className: 'good' },
          { id: 'recoverExhaustion', label: 'Recover 1 Exhaustion', className: 'good' }
        ]
      })
    );
    return;
  }
  if (action.manual) {
    if (action.reveals?.length) {
      action.reveals.forEach((key) => rememberPlayerKnowledge(key));
      log(
        `${actors.join(', ')} completed ${action.name}. Players learned the current ${action.reveals.map(fieldLabel).join(', ')}.`
      );
    } else {
      log(`${actors.join(', ')} completed ${action.name}. ${action.manual}`);
    }
  }
  if (action.complete) action.complete(state, actors);
  spendRepairMaterialsFor(action, actors);
}

function spendRepairMaterialsFor(action, actors) {
  const cost = Number(valueOfRepairCost(action.repairCost, actors));
  if (!cost) return;
  const before = Number(state.repairMaterials || 0);
  state.repairMaterials = Math.max(0, before - cost);
  log(
    `${action.name} used ${cost} repair material${cost === 1 ? '' : 's'}. Repair supplies changed from ${before} to ${state.repairMaterials}.`
  );
  if (before < cost) {
    addPrompt({
      type: 'manual',
      title: 'Repair Materials Shortfall',
      detail: `${action.name} needed ${cost} Repair Material(s), but only ${before} were available. Apply manual override if needed.`,
      effect: 'manual'
    });
  }
}

function valueOfRepairCost(cost, actors) {
  if (typeof cost === 'function') return cost(state, actors);
  return cost || 0;
}

function availableRepairMaterials() {
  return Math.max(0, Number(state.repairMaterials || 0));
}

function minimumRepairMaterialCost(action) {
  if (!action?.repairCost) return 0;
  if (action.id === 'repairLeak') return 1;
  return Number(valueOfRepairCost(action.repairCost, [state.crew[0]?.name || 'Crew'])) || 0;
}

function repairMaterialRequirementProblem(action) {
  const cost = minimumRepairMaterialCost(action);
  if (!cost) return '';
  const available = availableRepairMaterials();
  if (available >= cost) return '';
  return `${action.name} requires ${cost} Repair Material${cost === 1 ? '' : 's'}, but only ${available} available.`;
}

// Adds only checks that actually need adjudication; automatic/manual "done" work is logged.
function maybeAddActionPrompt(character, action) {
  const name = character.name;
  if (action.check === 'helm') {
    if (!canUseNormalHelm()) {
      applyAutomaticHelmSystemOutcome(name);
      return;
    }
    const courseState = courseStateForMeter();
    const worsenedState = worseCourseStateName(courseState.name);
    const improvedState = betterCourseStateName(courseState.name);
    const criticalSuccessText =
      improvedState === courseState.name
        ? `Critical success applies ${improvedState} (${signedTicks(courseStateTravelDeltaTicks(improvedState))} travel ticks); Course is already at the best state.`
        : `Critical success applies ${improvedState} (${signedTicks(courseStateTravelDeltaTicks(improvedState))} travel ticks) for this turn and improves Course by one state.`;
    const criticalSuccessLabel =
      improvedState === courseState.name
        ? `Critical Success: ${improvedState}`
        : `Critical Success: ${improvedState} + Course State`;
    addPrompt({
      type: 'check',
      character: name,
      title: 'Helm Check',
      detail: `Survival DC 12. ${criticalSuccessText} Success applies ${courseState.name} (${signedTicks(courseState.deltaTicks)} travel ticks). Failure applies ${worsenedState} (${signedTicks(courseStateTravelDeltaTicks(worsenedState))} travel ticks) for this turn only. Critical failure also reduces Course Meter by 1.${advantageSourceText(name, 'helm')}${fogHelmText(name)}`,
      dc: 12,
      effect: 'helmCourse',
      outcomes: [
        { id: 'helmCriticalSuccess', label: criticalSuccessLabel, className: 'good' },
        { id: 'helmSuccess', label: `Success: ${courseState.name}`, className: 'good' },
        { id: 'helmFailure', label: `Fail: ${worsenedState}`, className: 'danger' },
        {
          id: 'helmCriticalFailure',
          label: `Critical Fail: ${worsenedState} + Course -1`,
          className: 'danger'
        }
      ]
    });
  }
  if (action.check === 'navigate') {
    addPrompt({
      type: 'check',
      character: name,
      title: 'Navigate / Study Map',
      detail: `Resolve the navigation check. Critical failure: Course Meter +0. Failure: +2. Success: +4. Critical success: +5. Course Meter caps at 12. Players learn the resulting Course State and rounded Travel Remaining whether the check succeeds or fails.${advantageSourceText(name, 'navigate')}`,
      dc: 15,
      effect: 'navigateCourse',
      reveals: ['courseState', 'travel'],
      outcomes: [
        { id: 'navigateCriticalSuccess', label: 'Critical Success: Course +5', className: 'good' },
        { id: 'navigateSuccess', label: 'Success: Course +4', className: 'good' },
        { id: 'navigateFailure', label: 'Fail: Course +2', className: 'danger' },
        { id: 'navigateCriticalFailure', label: 'Critical Fail: Course +0', className: 'danger' }
      ]
    });
  }
  if (action.check === 'bilgeRod') {
    addPrompt({
      type: 'check',
      character: name,
      title: 'Bilge Sounding Rod',
      detail:
        'Investigation DC 15. Any reading gives the current Water Level. Success also reveals Total Water Ingress. Total Water Ingress can also become known if players know Water Level two turns in a row.',
      dc: 15,
      ability: 'Investigation',
      effect: 'bilgeRod',
      failureReveals: ['waterLevel'],
      successReveals: ['waterLevel', 'totalIngress']
    });
  }
  if (action.check === 'pumpSolo') {
    addPrompt({
      type: 'check',
      character: name,
      title: 'Operate Bilge Pump',
      detail: 'Strength DC 15. Success reduces Water Level by 3; failure reduces Water Level by 2.',
      dc: 15,
      effect: 'pumpSolo',
      outcomes: [
        { id: 'pumpTwo', label: 'Fail: Water -2', className: 'danger' },
        { id: 'pumpThree', label: 'Success: Water -3', className: 'good' }
      ]
    });
  }
  if (action.check === 'pumpCoop' && firstConfirmedForGroup(name, action.id)) {
    addPrompt({
      type: 'check',
      title: 'Operate Bilge Pump (Cooperative)',
      detail:
        'Both players roll Strength DC 15. Only one success is required. Success reduces Water Level by 4; failure reduces Water Level by 3.',
      dc: 15,
      effect: 'pumpCoop',
      outcomes: [
        { id: 'pumpThree', label: 'No Successes: Water -3', className: 'danger' },
        { id: 'pumpFour', label: 'At Least 1 Success: Water -4', className: 'good' }
      ]
    });
  }
  if (action.check === 'recoverWreckage') {
    addPrompt({
      type: 'check',
      character: name,
      title: 'Recover Floating Wreckage',
      detail: `Dexterity or Athletics DC 12. Success gains 1 Salvaged Timber.${fogFloatingWreckageText()}`,
      dc: 12,
      effect: 'wreckageSuccess'
    });
  }
  if (action.id === 'repairRigging') {
    addPrompt({
      type: 'save',
      character: name,
      title: 'Repairing Snapped Rigging',
      detail: `${name} is repairing the snapped rigging. Dexterity save DC 13 or take 2d6 bludgeoning damage.`,
      dc: 13,
      ability: 'DEX',
      effect: 'damageNote'
    });
  }
  if (action.check === 'castNet' && firstConfirmedForGroup(name, action.id)) {
    const hasFishAdvantage = hasCondition('School of Fish');
    const actors = selectedForAction(action.id);
    const advantage = fishingAdvantageText(
      actors,
      hasFishAdvantage ? 'School of Fish grants advantage to this Cast Net action.' : ''
    );
    addPrompt({
      type: 'check',
      title: 'Cast Fishing Net',
      detail: `Both players roll Survival DC 15. Each success grants +0.25 days rations.${advantage}${fishingFogText(actors, hasFishAdvantage)}`,
      dc: 15,
      effect: 'castNetSuccess',
      outcomes: [
        { id: 'fail', label: '0 Successes', className: 'danger' },
        { id: 'foodQuarter', label: '1 Success: +0.25 Food', className: 'good' },
        { id: 'foodHalf', label: '2 Successes: +0.5 Food', className: 'good' }
      ]
    });
  }
  if (action.check === 'harpoon') {
    const hasShadowAdvantage = hasCondition('Large Shadow');
    const actors = [name];
    const advantage = fishingAdvantageText(
      actors,
      hasShadowAdvantage ? 'Large Shadow grants advantage to this Harpoon Fishing check.' : ''
    );
    addPrompt({
      type: 'check',
      character: name,
      title: 'Harpoon Fishing',
      detail: `Survival check. DC 18: +0.5 Food. DC 20: +1 Food.${advantage}${fishingFogText(actors, hasShadowAdvantage)}`,
      dc: 18,
      effect: 'harpoon',
      outcomes: [
        { id: 'fail', label: 'Fail', className: 'danger' },
        { id: 'foodHalf', label: '+0.5 Food', className: 'good' },
        { id: 'foodOne', label: '+1 Food', className: 'good' }
      ]
    });
  }
  if (action.check === 'assistHarpoon' && firstConfirmedForGroup(name, action.id)) {
    const hasShadowAdvantage = hasCondition('Large Shadow');
    const actors = selectedForAction(action.id);
    const advantage = fishingAdvantageText(
      actors,
      hasShadowAdvantage ? 'Large Shadow grants advantage to this Harpoon Fishing check.' : ''
    );
    addPrompt({
      type: 'check',
      title: 'Harpoon Fishing (Cooperative)',
      detail: `Both players roll Survival; only the higher roll counts. DC 15: +0.5 Food. DC 18: +1 Food. DC 20: +2 Food.${advantage}${fishingFogText(actors, hasShadowAdvantage)}`,
      dc: 15,
      effect: 'assistHarpoon',
      outcomes: [
        { id: 'fail', label: 'Fail', className: 'danger' },
        { id: 'foodHalf', label: '+0.5 Food', className: 'good' },
        { id: 'foodOne', label: '+1 Food', className: 'good' },
        { id: 'foodTwo', label: '+2 Food', className: 'good' }
      ]
    });
  }
}

function firstConfirmedForGroup(name, actionId) {
  const names = state.crew
    .filter((c) => state.plannedActions[c.name] === actionId)
    .map((c) => c.name);
  return names[0] === name;
}

function maybeAddLaborSave(character, before) {
  const after = Number(character.labor);
  if (after < 4 || after <= before) return;
  const dc = laborSaveDC(after);
  addPrompt({
    type: 'save',
    character: character.name,
    title: 'Labor Overexertion',
    detail: `Labor reached ${after}. On failure, add 1 Exhaustion. The task still completes.`,
    dc,
    effect: 'laborExhaustion'
  });
}

function laborSaveDC(laborAfter) {
  if (laborAfter < 4) return null;
  return Math.min(20, 10 + (laborAfter - 3) * 2);
}

// Hard requirements are checked before group-size warnings so the DM sees root-cause failures first.
function actionRequirementProblem(action) {
  if (action.id === 'rest' && state.isNightOvertime)
    return 'Recover is not normally available during Night Overtime.';
  if (action.groupSize && groupAlreadyStarted(action.id)) return '';
  const repairMaterialProblem = repairMaterialRequirementProblem(action);
  if (repairMaterialProblem) return repairMaterialProblem;
  if (action.requirement === 'pumpWorking' && state.pumpStatus !== 'Working')
    return 'Bilge Pump is jammed.';
  if (action.requirement === 'pumpJammed' && state.pumpStatus !== 'Jammed')
    return 'Bilge Pump is not jammed.';
  if (action.requirement === 'netReady' && state.netStatus !== 'Ready') return 'Net is tangled.';
  if (action.requirement === 'netTangled' && state.netStatus !== 'Tangled')
    return 'Fishing net does not need to be reset.';
  if (action.requirement === 'activeLeaks' && Number(state.activeLeaks || 0) <= 0)
    return 'There are no active leaks to repair.';
  if (action.requirement === 'rainwaterAvailable' && !hasCondition('Rainwater Collection'))
    return 'Rainwater collection is only available after the natural 20 open sea event.';
  if (action.requirement === 'gullsPresent' && !hasCondition('Pack of Gulls'))
    return 'There is no active Pack of Gulls encounter.';
  if (action.requirement === 'wreckageAvailable' && !hasCondition('Floating Wreckage'))
    return 'There is no floating wreckage to recover.';
  if (action.requirement === 'timberAvailable' && Number(state.salvagedTimber) <= 0)
    return 'No salvaged timber is available.';
  if (action.requirement === 'riggingBroken' && state.riggingStatus !== 'Broken')
    return 'Rigging is not snapped.';
  if (action.requirement === 'mastBroken' && state.mastStatus !== 'Broken')
    return 'Mast is not broken.';
  if (action.requirement === 'rudderBroken' && state.rudderStatus !== 'Broken')
    return 'Rudder is not broken.';
  return '';
}

// Started groups are locked so the second member of a two-person action can still confirm after the first.
function groupAlreadyStarted(actionId) {
  return Boolean(state.startedGroups?.[actionId]);
}

function lockStartedGroup(action) {
  if (!state.startedGroups) state.startedGroups = {};
  state.startedGroups[action.id] = actionActors('', action);
}

function isLockedGroupMember(actionId, name) {
  return Boolean(state.startedGroups?.[actionId]?.includes(name));
}

// Manual reminders that only say "Done" are converted to log entries so they do not slow phase advancement.
function addPrompt(prompt) {
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

function isDoneOnlyManualPrompt(prompt) {
  return (
    (prompt.type || 'manual') === 'manual' && !prompt.blocking && !(prompt.outcomes || []).length
  );
}

// Generic prompt resolution handles pass/fail/manual buttons.
function resolvePrompt(id, result) {
  syncFromInputs();
  const prompt = state.pendingChecks.find((p) => p.id === id);
  if (!prompt || prompt.status === 'resolved') return;
  pushUndo(`Resolved ${prompt.title}`);
  applyPromptEffect(prompt, result);
  applyPromptReveals(prompt, result);
  prompt.status = 'resolved';
  log(
    `${prompt.character ? `${prompt.character}'s ` : ''}${prompt.title} was resolved as ${result}.`
  );
  saveStateSnapshot();
  render();
}

// Outcome prompts directly apply common resource results without requiring extra manual steps.
function resolvePromptOutcome(id, outcomeId) {
  syncFromInputs();
  const result = promptOutcomeResult(outcomeId);
  const prompt = state.pendingChecks.find((p) => p.id === id);
  if (!prompt) return;
  pushUndo(`Resolved ${prompt.title}`);
  if (outcomeId.startsWith('helm')) applyHelmTravelOutcome(outcomeId);
  if (outcomeId.startsWith('navigate')) applyNavigateResult(outcomeId);
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
  log(
    `${prompt.character ? `${prompt.character}'s ` : ''}${prompt.title} outcome was ${humanOutcome(outcomeId)}.`
  );
  saveStateSnapshot();
  render();
}

function promptOutcomeResult(outcomeId) {
  const text = String(outcomeId || '').toLowerCase();
  return text.includes('fail') ? 'failure' : 'success';
}

function applyPromptReveals(prompt, result) {
  const reveals = [
    ...(prompt.reveals || []),
    ...(result === 'success' ? prompt.successReveals || [] : []),
    ...(result === 'failure' ? prompt.failureReveals || [] : [])
  ];
  [...new Set(reveals)].forEach((key) => rememberPlayerKnowledge(key));
}

// Player knowledge is snapshot-based: players keep seeing the last value they successfully learned.
function rememberPlayerKnowledge(key) {
  if (!state.playerKnowledge) state.playerKnowledge = structuredClone(defaultState.playerKnowledge);
  const value =
    key === 'totalIngress'
      ? totalIngress()
      : key === 'travel'
        ? playerTravelDaysFromTicks()
        : key === 'courseState'
          ? courseStateForMeter().name
          : Number(state[key]);
  state.playerKnowledge[key] = value;
  if (key === 'waterLevel') {
    ensureWaterKnowledgeTurn();
    state.waterKnowledge.exactKnownThisTurn = true;
    markWaterKnownForCurrentTurn('water level was revealed');
  }
  log(`Players learned the current ${fieldLabel(key)}: ${knowledgeValueText(value)}.`);
}

function knowledgeValueText(value) {
  if (typeof value === 'number') return formatNumber(value);
  return String(value ?? '?');
}

function currentTurnKey() {
  return `${Number(state.day || 0)}-${Number(state.turn || 0)}`;
}

function parseTurnKey(key) {
  const [day, turn] = String(key || '')
    .split('-')
    .map(Number);
  return { day, turn };
}

function isConsecutiveTurn(previousKey, currentKey) {
  if (!previousKey || !currentKey) return false;
  const previous = parseTurnKey(previousKey);
  const current = parseTurnKey(currentKey);
  if (
    !Number.isFinite(previous.day) ||
    !Number.isFinite(previous.turn) ||
    !Number.isFinite(current.day) ||
    !Number.isFinite(current.turn)
  )
    return false;
  if (current.day === previous.day) return current.turn === previous.turn + 1;
  return (
    current.day === previous.day + 1 &&
    current.turn === 1 &&
    previous.turn >= nighttimeTurnForDay(previous.day)
  );
}

function ensureWaterKnowledgeTurn() {
  if (!state.waterKnowledge) state.waterKnowledge = structuredClone(defaultState.waterKnowledge);
  const key = currentTurnKey();
  if (state.waterKnowledge.turnKey === key) return;
  state.waterKnowledge.turnKey = key;
  state.waterKnowledge.knownThisTurn = false;
  state.waterKnowledge.exactKnownThisTurn = false;
  hideTotalIngressKnowledge();
}

function initializeWaterKnowledgeForCurrentTurn() {
  ensureWaterKnowledgeTurn();
  if (Number(state.waterLevel) >= 5)
    markWaterKnownForCurrentTurn('water is visibly in the cargo hold');
}

function finalizeWaterKnowledgeForCurrentTurn() {
  initializeWaterKnowledgeForCurrentTurn();
  if (state.waterKnowledge.knownThisTurn) return;
  state.waterKnowledge.streak = 0;
  state.waterKnowledge.lastKnownTurnKey = '';
  hideTotalIngressKnowledge();
}

function markWaterKnownForCurrentTurn(reason) {
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
    if (before !== value)
      log(
        `Players inferred Total Water Ingress (${formatNumber(value)}) because ${reason} for two turns in a row.`
      );
  } else {
    hideTotalIngressKnowledge();
  }
}

function hideWaterLevelKnowledgeIfBelowCargoHold(beforeWaterLevel, afterWaterLevel) {
  if (Number(beforeWaterLevel) >= 5 && Number(afterWaterLevel) < 5) {
    forgetExactWaterKnowledge();
  }
}

function forgetExactWaterKnowledge() {
  if (!state.playerKnowledge) state.playerKnowledge = structuredClone(defaultState.playerKnowledge);
  state.playerKnowledge.waterLevel = null;
  ensureWaterKnowledgeTurn();
  state.waterKnowledge.knownThisTurn = false;
  state.waterKnowledge.exactKnownThisTurn = false;
  state.waterKnowledge.streak = 0;
  state.waterKnowledge.lastKnownTurnKey = '';
  hideTotalIngressKnowledge();
}

function hideTotalIngressKnowledge() {
  if (!state.playerKnowledge) state.playerKnowledge = structuredClone(defaultState.playerKnowledge);
  state.playerKnowledge.totalIngress = null;
}

// Prompt effects are intentionally narrow; larger action effects belong in completeAction().
function applyPromptEffect(prompt, result) {
  if (result === 'manual') return;
  if (prompt.effect === 'laborExhaustion' && result === 'failure') {
    const character = crewByName(prompt.character);
    if (character) character.exhaustion += 1;
  }
  if (prompt.effect === 'helmSuccess' && result === 'success')
    applyHelmTravelOutcome('helmSuccess');
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
      state.overtimeExhaustion[character.name] =
        Number(state.overtimeExhaustion[character.name] || 0) + 1;
      log(`${character.name} gained 1 overtime Exhaustion.`);
    }
  }
}

function applyRestChoice(name, choice) {
  const character = crewByName(name);
  if (!character) return;
  if (choice === 'labor') character.labor = Math.max(0, Number(character.labor) - 2);
  if (choice === 'exhaustion') character.exhaustion = Math.max(0, Number(character.exhaustion) - 1);
}

function addManualPrompt() {
  syncFromInputs();
  const title = prompt('Prompt title?', 'Manual Check');
  if (!title) return;
  const detail = prompt('Prompt detail?', 'Resolve manually.');
  pushUndo('Added manual prompt');
  addPrompt({
    type: 'manual',
    title,
    detail: detail || 'Resolve manually.',
    effect: 'manual',
    blocking: true
  });
  render();
}

function clearResolvedPrompts() {
  pushUndo('Cleared resolved prompts');
  state.pendingChecks = state.pendingChecks.filter((p) => p.status !== 'resolved');
  render();
}

function change(id, amount) {
  syncFromInputs();
  pushUndo(`Changed ${fieldLabel(id)}`);
  const before = Number(state[id] || 0);
  state[id] = Math.max(0, Number(state[id]) + amount);
  if (id === 'waterLevel') updateWaterTravelPenalty();
  if (id === 'waterLevel') hideWaterLevelKnowledgeIfBelowCargoHold(before, state[id]);
  log(
    `Manual override: ${fieldLabel(id)} changed from ${formatNumber(before)} to ${formatNumber(state[id])}.`
  );
  render();
}

function crewChange(index, field, amount) {
  const character = state.crew[index];
  pushUndo(`Changed ${character.name}'s ${fieldLabel(field)}`);
  const before = Number(character[field] || 0);
  state.crew[index][field] = Math.max(0, Number(state.crew[index][field]) + amount);
  log(
    `Manual override: ${character.name}'s ${fieldLabel(field)} changed from ${formatNumber(before)} to ${formatNumber(character[field])}.`
  );
  render();
}

// End-of-turn water update resolves deferred action effects before advancing to the next turn.
function endTurn() {
  syncFromInputs();
  if (state.waterUpdatedThisTurn) {
    goToTurnStep(5);
    return;
  }
  pushUndo('Applied water update');
  if (state.scriptedSceneTurn) log('Ongoing work was paused for the scripted scene turn.');
  else tickOngoing();
  const before = Number(state.waterLevel);
  const ingress = totalIngress();
  const pumping = Number(state.turnLedger.pumping || 0);
  const buckets = Number(state.turnLedger.buckets || 0);
  const after = Math.max(0, before + ingress - pumping - buckets);
  state.waterLevel = after;
  updateWaterTravelPenalty();
  hideWaterLevelKnowledgeIfBelowCargoHold(before, after);
  log(
    `Water was updated: ${before} + ${ingress} ingress - ${pumping} pumping - ${buckets} buckets = ${after}.`
  );
  completeDeferredActions();
  addWaterThresholdPrompts(before, after);
  addNightOvertimePrompts();
  state.turnLedger = { pumping: 0, buckets: 0 };
  state.waterUpdatedThisTurn = true;
  state.turnStep = 5;
  saveStateSnapshot();
  render();
}

// Threshold prompts explain newly-entered danger bands without requiring extra success/failure clicks.
function addWaterThresholdPrompts(before, after) {
  [5, 10, 15, 20].forEach((level) => {
    if (before < level && after >= level) {
      const text =
        level === 5
          ? 'Below-deck actions take +1 Turn.'
          : level === 10
            ? 'Below-deck actions cost +1 additional Labor. Food and water begin to spoil.'
            : level === 15
              ? 'Each additional level above 15 adds 1 day to Travel Time.'
              : 'The Marrowwind sinks.';
      addPrompt({
        phase: 'water',
        type: 'manual',
        title: `Water Level ${level}+`,
        detail: text,
        effect: 'manual'
      });
    }
  });
}

// Neck-deep water adds temporary travel delay and removes it as the water drops.
function updateWaterTravelPenalty() {
  const previousPenalty = Number(state.waterTravelPenalty || 0);
  const nextPenalty = Math.max(0, Number(state.waterLevel || 0) - 15);
  const delta = nextPenalty - previousPenalty;
  if (!delta) return;
  applyTravelTicks(delta * TRAVEL_TICKS_PER_DAY);
  state.waterTravelPenalty = nextPenalty;
  if (delta > 0) {
    addPrompt({
      phase: 'water',
      type: 'manual',
      title: 'Neck-Deep Flooding',
      detail: `Added ${delta} day(s) to Travel Remaining from water above neck-deep level. This penalty is removed as water drops.`,
      effect: 'manual'
    });
    log(
      `Neck-deep flooding added ${delta} day(s) to travel. Current water travel penalty is ${nextPenalty} day(s).`
    );
  } else {
    log(
      `Water dropped below prior neck-deep levels, removing ${Math.abs(delta)} day(s) from travel. Current water travel penalty is ${nextPenalty} day(s).`
    );
  }
}

// Advances the calendar and resets per-turn flags after the water step is finished.
function advanceTurn(doRender = true, shouldSync = true, shouldTickOngoing = true) {
  if (shouldSync) syncFromInputs();
  if (isNightDecisionPoint()) {
    log('Nightfall reached. Choose Rest or Night Overtime before advancing.');
    if (doRender) render();
    return;
  }
  pushUndo('Advanced turn');
  finalizeWaterKnowledgeForCurrentTurn();
  decayCourseMeter();
  const completedDay = Number(state.day);
  const completedTurn = Number(state.turn);
  tickConditions();
  if (shouldTickOngoing && !state.scriptedSceneTurn) tickOngoing();
  else if (shouldTickOngoing && state.scriptedSceneTurn)
    log('Ongoing work did not tick down because this was a scripted scene turn.');
  if (!state.isNightOvertime && completedTurn >= nighttimeTurnForDay(completedDay)) {
    const nightTurn = nighttimeTurnForDay(completedDay);
    addMealPrompts('dinner', 'preAction', {
      key: `day-${completedDay}-after-turn-${nightTurn}-dinner`,
      timing: `after Turn ${nightTurn}`
    });
    addLongRestPrompt('preAction');
    state.day = completedDay + 1;
    state.turn = 1;
  } else {
    state.turn = completedTurn + 1;
  }
  state.confirmedActions = {};
  state.startedGroups = {};
  state.actionsCommittedThisTurn = false;
  state.navigateResolvedThisTurn = false;
  state.scriptedSceneTurn = false;
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

function nighttimeTurnForDay(day) {
  return 8;
}

function isNightDecisionPoint() {
  return (
    !state.isNightOvertime &&
    state.waterUpdatedThisTurn &&
    Number(state.turn) >= nighttimeTurnForDay(state.day)
  );
}

function currentOvertimeSaveDC() {
  return Math.min(18, 10 + Number(state.overtimeTurnCount || 0) * 2);
}

// Night overtime saves are created only for characters who actually worked that overtime turn.
function addNightOvertimePrompts() {
  if (!state.isNightOvertime) return;
  const dc = currentOvertimeSaveDC();
  const workers = state.crew.filter((character) => {
    const actionId = state.confirmedActions[character.name];
    return actionId && actionId !== 'idle';
  });
  workers.forEach((character) =>
    addPrompt({
      phase: 'water',
      type: 'save',
      character: character.name,
      title: 'Night Overtime',
      detail: `${character.name} worked through the night. Constitution save DC ${dc}. On failure, gain 1 overtime Exhaustion.`,
      dc,
      ability: 'CON',
      effect: 'overtimeExhaustion'
    })
  );
  state.overtimeTurnCount = Number(state.overtimeTurnCount || 0) + 1;
  log(
    `Night Overtime turn ${state.overtimeTurnCount} completed. ${workers.length} overtime Constitution save prompt${workers.length === 1 ? '' : 's'} created at DC ${dc}.`
  );
}

function tickConditions() {
  state.conditions = state.conditions
    .map((c) => ({ ...c, turns: Number(c.turns) - 1 }))
    .filter((c) => c.turns > 0);
}

// Ongoing work ticks down after water/update timing once the action is confirmed for that turn.
function tickOngoing() {
  state.ongoing
    .filter((o) => o.status === 'active')
    .forEach((o) => {
      const allConfirmed = o.actors.every((name) => state.confirmedActions[name] === o.actionId);
      if (!allConfirmed) return;
      o.remaining = Math.max(0, Number(o.remaining) - 1);
      if (o.remaining === 0) {
        const action = actionById(o.actionId);
        completeAction(action, o.actors);
        o.status = 'resolved';
        o.actors.forEach((name) => delete state.plannedActions[name]);
        log(`${o.actors.join(', ')} completed ${action.name} at the end of the turn.`);
      }
    });
}

// Deferred completions are for effects that should not change the game state mid-action selection.
function completeDeferredActions() {
  (state.deferredCompletions || [])
    .filter((item) => item.status === 'pending')
    .forEach((item) => {
      const action = actionById(item.actionId);
      if (!action) {
        item.status = 'cancelled';
        return;
      }
      completeAction(action, item.actors);
      item.status = 'resolved';
      item.actors.forEach((name) => delete state.plannedActions[name]);
      log(`${item.actors.join(', ')} completed ${action.name} at the end of the turn.`);
    });
}

// Characters locked into multi-turn work are automatically assigned their continuation action.
function autoPlanOngoing() {
  state.ongoing
    .filter((o) => o.status === 'active')
    .forEach((o) => {
      o.actors.forEach((name) => {
        state.plannedActions[name] = o.actionId;
      });
      if (o.remaining <= 0)
        addPrompt({
          type: 'manual',
          title: `${actionById(o.actionId).name} Ready`,
          detail: `Confirm completion for ${o.actors.join(', ')}.`,
          effect: 'manual'
        });
    });
}

function startTurnPrompts(shouldSync = true, shouldRender = true) {
  if (shouldSync) syncFromInputs();
  addStartTurnTriggers();
  if (shouldRender) render();
}

// Start-turn triggers run before the open sea event according to the core turn structure.
function addStartTurnTriggers() {
  const key = `${state.day}-${state.turn}`;
  if (state.startPromptKey === key) return;
  state.startPromptKey = key;
  if (state.riggingStatus === 'Broken') {
    addPrompt({
      phase: 'preAction',
      type: 'save',
      title: 'Broken Rigging',
      detail:
        'At start of turn, choose a random top-deck creature. DC 13 Dexterity save or take 2d6 bludgeoning damage.',
      dc: 13,
      effect: 'damageNote'
    });
  }
  const scripted = scriptedEventForTurn();
  if (scripted) addScriptedPrompt(scripted);
}

function addScriptedPrompt(scripted) {
  if (scripted.type === 'breakfast') {
    addMealPrompts('breakfast', 'preAction', {
      key: `day-${state.day}-before-turn-1-breakfast`,
      timing: 'before Turn 1'
    });
    return;
  }
  if (scripted.apply && !state.appliedScriptedEvents?.[scripted.id]) {
    if (!state.appliedScriptedEvents) state.appliedScriptedEvents = {};
    scripted.apply(state);
    state.appliedScriptedEvents[scripted.id] = true;
    log(`${scripted.title} scripted effect applied.`);
  }
  addPrompt({
    phase: 'preAction',
    type: 'manual',
    title: scripted.title || 'Scripted Event',
    detail: scripted.detail,
    effect: 'manual',
    blocking: Boolean(scripted.blocking),
    emphasis: scripted.alert ? 'scripted' : ''
  });
}

function scriptedEventForTurn() {
  const definition = scriptedEvents.find((event) => event.matches(state));
  if (definition) return materializeScriptedEvent(definition);
  return null;
}

function materializeScriptedEvent(definition) {
  return {
    ...definition,
    id: typeof definition.id === 'function' ? definition.id(state) : definition.id
  };
}

function openSeaEventRequiredForTurn() {
  const scripted = scriptedEventForTurn();
  if (scripted?.blocksOpenSea) return false;
  if (Number(state.day) === 1) {
    const turn = Number(state.turn);
    return turn >= 2 && turn <= 6 && turn % 2 === 0;
  }
  return true;
}

function rollOpenSeaEvent() {
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
function previewOpenSeaEvent(roll) {
  const event = events[Number(roll)];
  if (!event) {
    q('eventTitle').textContent = 'Invalid roll';
    q('eventText').textContent = 'Enter or roll 1-20.';
    return;
  }
  q('eventTitle').textContent = `Rolled ${roll}. ${event.title}`;
  q('eventText').textContent = `${event.text} Confirm Event to apply this result.`;
}

function bindEventListeners() {
  q('eventRoll')?.addEventListener('input', (event) => previewOpenSeaEvent(event.target.value));
  q('eventRoll')?.addEventListener('change', (event) => previewOpenSeaEvent(event.target.value));
  q('importFile')?.addEventListener('change', (event) => importStateFile(event.target.files?.[0]));
  document.addEventListener('click', handleDelegatedClick);
  document.addEventListener('change', handleDelegatedChange);
}

function handleDelegatedClick(event) {
  const control = event.target?.closest?.('[data-action]');
  if (!control || control.disabled) return;
  event.preventDefault();
  control.closest?.('.header-menu')?.removeAttribute('open');
  const action = control.dataset.action;
  const amount = () => Number(control.dataset.amount || 0);
  const index = () => Number(control.dataset.index || 0);
  switch (action) {
    case 'start-new-voyage':
      return startNewVoyage();
    case 'load-demo-voyage':
      return loadDemoVoyage();
    case 'return-to-landing':
      return returnToLanding();
    case 'back-to-landing':
      return backToLanding();
    case 'reset-setup-defaults':
      return resetSetupDefaults();
    case 'start-setup-voyage':
      return startSetupVoyage();
    case 'resume-current-voyage':
      return resumeCurrentVoyage();
    case 'import-saved-voyage':
      return importSavedVoyage();
    case 'undo-last-change':
      return undoLastChange();
    case 'save-state':
      return saveState();
    case 'load-state':
      return loadState();
    case 'export-state':
      return exportState();
    case 'choose-import-file':
      return chooseImportFile();
    case 'reset-state':
      return resetState();
    case 'change-field':
      return change(control.dataset.field, amount());
    case 'interrupt-selected-work':
      return interruptSelectedWork();
    case 'end-turn':
      return endTurn();
    case 'advance-turn':
      return advanceTurn();
    case 'advance-turn-no-ongoing-tick':
      return advanceTurn(true, true, false);
    case 'meal':
      return meal(control.dataset.meal);
    case 'long-rest':
      return longRest();
    case 'start-turn-prompts':
      return startTurnPrompts();
    case 'add-manual-prompt':
      return addManualPrompt();
    case 'clear-resolved-prompts':
      return clearResolvedPrompts();
    case 'roll-open-sea-event':
      return rollOpenSeaEvent();
    case 'resolve-event':
      return resolveEvent();
    case 'add-fog':
      return addFog();
    case 'clear-conditions':
      return clearConditions();
    case 'change-crew-size':
      return changeCrewSize(amount());
    case 'run-dev-validator':
      return runDevValidator();
    case 'scoreboard-change':
      return scoreboardChange(control.dataset.field, amount());
    case 'scoreboard-set':
      return scoreboardSet(control.dataset.field, control.dataset.value);
    case 'reveal-player-knowledge':
      return revealPlayerKnowledge(control.dataset.field);
    case 'forget-player-knowledge':
      return forgetPlayerKnowledge(control.dataset.field);
    case 'run-scripted-step':
      return runScriptedStep();
    case 'force-scripted-scene-turn':
      return forceScriptedSceneTurn();
    case 'go-to-turn-step':
      return goToTurnStep(Number(control.dataset.step));
    case 'set-unset-actions-to-idle':
      return setUnsetActionsToIdle();
    case 'confirm-all-actions':
      return confirmAllActions();
    case 'continue-night-overtime':
      return continueNightOvertime();
    case 'start-night-overtime':
      return startNightOvertime();
    case 'end-night-overtime-and-rest':
      return endNightOvertimeAndRest();
    case 'change-overtime-turn-count':
      return changeOvertimeTurnCount(amount());
    case 'clear-overtime-exhaustion':
      return clearOvertimeExhaustion();
    case 'crew-change':
      return crewChange(index(), control.dataset.field, amount());
    case 'confirm-character-action':
      return confirmCharacterActionByIndex(index());
    case 'clear-character-action':
      return clearCharacterActionByIndex(index());
    case 'resolve-prompt-outcome':
      return resolvePromptOutcome(control.dataset.promptId, control.dataset.outcomeId);
    case 'resolve-prompt':
      return resolvePrompt(control.dataset.promptId, control.dataset.result);
    default:
      console.warn(`No delegated click handler for action: ${action}`);
  }
}

function handleDelegatedChange(event) {
  const control = event.target?.closest?.('[data-change-action]');
  if (!control) return;
  const action = control.dataset.changeAction;
  const index = Number(control.dataset.index || 0);
  switch (action) {
    case 'set-setup-field':
      return setSetupField(control.dataset.field, control.value);
    case 'set-setup-crew-name':
      return setSetupCrewName(index, control.value);
    case 'set-setup-crew-size':
      return setSetupCrewSize(control.value);
    case 'set-setup-crew-trait':
      return setSetupCrewTrait(index, control.dataset.field, control.checked);
    case 'rename-crew-member':
      return renameCrewMember(index, control.value);
    case 'set-crew-background':
      return setCrewBackground(index, control.checked);
    case 'set-crew-proficiency':
      return setCrewProficiency(index, control.dataset.field, control.checked);
    case 'set-planned-action':
      return setPlannedAction(index, control.value);
    case 'set-salvage-lumber-deck':
      return setSalvageLumberDeckChoice(index, control.checked);
    default:
      console.warn(`No delegated change handler for action: ${action}`);
  }
}

function resolveEvent() {
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

function addCondition(name, turns) {
  const existing = state.conditions.find((c) => c.name === name);
  if (existing) existing.turns = Math.max(existing.turns, turns);
  else state.conditions.push({ name, turns });
}

function addFog() {
  syncFromInputs();
  pushUndo('Added fog');
  addCondition('Dense Fog', 2);
  render();
}

function clearConditions() {
  pushUndo('Cleared conditions');
  state.conditions = [];
  render();
}

function meal(type) {
  syncFromInputs();
  pushUndo(`${capitalize(type)} meal`);
  addMealPrompts(type);
  render();
}

function longRest() {
  syncFromInputs();
  pushUndo('Added long rest prompt');
  addLongRestPrompt();
  render();
}

function startNightOvertime() {
  syncFromInputs();
  pushUndo('Started Night Overtime');
  resolveNightDinner(
    'preAction',
    `day-${state.day}-turn-${state.turn}-dinner-before-overtime`,
    'before Night Overtime'
  );
  beginNightOvertime();
  saveStateSnapshot();
  render();
}

function continueNightOvertime() {
  advanceTurn(true, true, false);
}

function overtimeTurnsFromCurrentTurn() {
  return Math.max(0, Number(state.turn) - nighttimeTurnForDay(state.day));
}

function reconcileManualNightOvertime() {
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
    log(
      `Manual turn change entered Night Overtime. Current overtime save DC is ${currentOvertimeSaveDC()}.`
    );
  } else if (beforeCount !== overtimeTurns) {
    log(
      `Manual turn change updated Night Overtime to turn ${overtimeTurns}. Current overtime save DC is ${currentOvertimeSaveDC()}.`
    );
  }
}

function updatePendingNightOvertimePromptDC() {
  const dc = currentOvertimeSaveDC();
  state.pendingChecks.forEach((prompt) => {
    if (prompt.status === 'resolved' || prompt.effect !== 'overtimeExhaustion') return;
    prompt.dc = dc;
    const characterName = prompt.character || 'This character';
    prompt.detail = `${characterName} worked through the night. Constitution save DC ${dc}. On failure, gain 1 overtime Exhaustion.`;
  });
}

function clearPendingNightOvertimePrompts() {
  state.pendingChecks.forEach((prompt) => {
    if (prompt.status !== 'resolved' && prompt.effect === 'overtimeExhaustion')
      prompt.status = 'resolved';
  });
}

function beginNightOvertime(reason = 'Night Overtime begins.') {
  if (state.isNightOvertime) return;
  state.isNightOvertime = true;
  log(`${reason} Current overtime save DC is ${currentOvertimeSaveDC()}.`);
}

function endNightOvertimeAndRest() {
  syncFromInputs();
  pushUndo('Ended Night Overtime and rested');
  const wasActive = state.isNightOvertime;
  finalizeWaterKnowledgeForCurrentTurn();
  decayCourseMeter();
  if (!hasDinnerStatusForRest()) {
    resolveNightDinner(
      'preAction',
      `night-overtime-end-day-${state.day}-turn-${state.turn}-dinner`,
      'before rest'
    );
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
  state.navigateResolvedThisTurn = false;
  state.scriptedSceneTurn = false;
  clearActionCommitSnapshot();
  state.scriptedCheckedThisTurn = false;
  state.eventResolvedThisTurn = false;
  state.waterUpdatedThisTurn = false;
  state.turnStep = 1;
  autoPlanOngoing();
  initializeWaterKnowledgeForCurrentTurn();
  log(
    `${wasActive ? 'Night Overtime ends' : 'Night rest begins'}. Dinner was checked, rest is pending breakfast, and the tracker advanced to Day ${state.day}, Turn ${state.turn}.`
  );
  saveStateSnapshot();
  render();
}

function changeOvertimeTurnCount(amount) {
  syncFromInputs();
  pushUndo('Changed Night Overtime turn count');
  const before = Number(state.overtimeTurnCount || 0);
  state.overtimeTurnCount = Math.max(0, before + Number(amount));
  updatePendingNightOvertimePromptDC();
  log(
    `Manual override: Night Overtime turn count changed from ${before} to ${state.overtimeTurnCount}.`
  );
  saveStateSnapshot();
  render();
}

function clearOvertimeExhaustion(shouldRender = true) {
  if (shouldRender) pushUndo('Cleared overtime Exhaustion');
  state.crew.forEach((character) => {
    const overtime = Number(state.overtimeExhaustion?.[character.name] || 0);
    if (!overtime) return;
    const before = Number(character.exhaustion || 0);
    character.exhaustion = Math.max(0, before - overtime);
    state.overtimeExhaustion[character.name] = 0;
    log(
      `${character.name}'s overtime Exhaustion was cleared. Visible Exhaustion changed from ${before} to ${character.exhaustion}.`
    );
  });
  state.crew.forEach((character) => {
    state.overtimeExhaustion[character.name] = Number(
      state.overtimeExhaustion[character.name] || 0
    );
  });
  if (shouldRender) {
    saveStateSnapshot();
    render();
  }
}

function clearOvertimeExhaustionAmount(amount) {
  const clearAmount = Math.max(0, Number(amount || 0));
  if (!clearAmount) return;
  state.crew.forEach((character) => {
    const overtime = Number(state.overtimeExhaustion?.[character.name] || 0);
    const removed = Math.min(clearAmount, overtime);
    if (!removed) return;
    const before = Number(character.exhaustion || 0);
    character.exhaustion = Math.max(0, before - removed);
    state.overtimeExhaustion[character.name] = Math.max(0, overtime - removed);
    log(
      `${character.name} cleared ${removed} overtime Exhaustion. Visible Exhaustion changed from ${before} to ${character.exhaustion}.`
    );
  });
  state.crew.forEach((character) => {
    state.overtimeExhaustion[character.name] = Number(
      state.overtimeExhaustion[character.name] || 0
    );
  });
}

// Shown only at the night decision point or while Night Overtime is active.
function renderNightOvertimeControls() {
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
  const rows = state.crew
    .map((character) => {
      const count = Number(state.overtimeExhaustion?.[character.name] || 0);
      return `<span class="pill ${count ? 'warn' : 'good'}">${character.name}: ${count}</span>`;
    })
    .join('');
  const mainButton = state.isNightOvertime
    ? `<button class="good" data-action="end-night-overtime-and-rest">End Night Overtime and Rest</button>`
    : `<button class="warn" data-action="start-night-overtime">Start Night Overtime</button>`;
  box.innerHTML = `<div class="night-overtime-panel ${state.isNightOvertime ? 'active' : ''}">
    <div class="prompt-title">${state.isNightOvertime ? `Night Overtime Active. Current overtime save DC: ${dc}.` : 'Nightfall reached. Eat dinner, then rest or start Night Overtime.'}</div>
    <div class="prompt-detail">Turns beyond nightfall: ${state.overtimeTurnCount}. Dinner: ${mealStatusText(state.restMealStatus?.dinnerAvailable)}. Overtime Exhaustion: ${rows}</div>
    <div class="actions">
      ${mainButton}
      ${state.isNightOvertime ? '' : '<button class="good" data-action="end-night-overtime-and-rest">Rest and Advance to Next Day</button>'}
    </div>
    <details class="night-overtime-advanced">
      <summary>Advanced overrides</summary>
      <div class="actions">
        <button data-action="change-overtime-turn-count" data-amount="-1">Overtime Turn -1</button>
        <button data-action="change-overtime-turn-count" data-amount="1">Overtime Turn +1</button>
        <button data-action="clear-overtime-exhaustion">Clear Overtime Exhaustion</button>
      </div>
    </details>
  </div>`;
}

// Dinner and breakfast are resolved separately, then breakfast applies the overnight rest outcome.
function addMealPrompts(type, phase = 'action', options = {}) {
  const result = consumeMealSupplies(type, options);
  if (!result.consumed) return false;
  recordMealAvailability(type, result, options);
  log(
    `${capitalize(type)} ${result.available ? 'was available and' : 'was short but still'} consumed up to 0.5 Food and 0.5 Water. Food changed from ${formatNumber(result.beforeFood)} to ${formatNumber(state.food)}. Fresh Water changed from ${formatNumber(result.beforeWater)} to ${formatNumber(state.freshWater)}.`
  );
  if (type === 'breakfast') applyOvernightRestOutcome(phase);
  return true;
}

// Meal keys prevent breakfast/dinner from being accidentally charged twice.
function consumeMealSupplies(type, options = {}) {
  if (!state.consumedMeals) state.consumedMeals = {};
  if (options.key && state.consumedMeals[options.key]) return { consumed: false };
  const beforeFood = Number(state.food || 0);
  const beforeWater = Number(state.freshWater || 0);
  state.food = Math.max(0, beforeFood - 0.5);
  state.freshWater = Math.max(0, beforeWater - 0.5);
  if (options.key) state.consumedMeals[options.key] = true;
  return {
    consumed: true,
    beforeFood,
    beforeWater,
    shortFood: beforeFood < 0.5,
    shortWater: beforeWater < 0.5,
    available: beforeFood >= 0.5 && beforeWater >= 0.5
  };
}

function addLongRestPrompt(phase = 'action') {
  state.longRestLaborRecoveryPending = true;
  state.restMealStatus = {
    ...structuredClone(defaultState.restMealStatus),
    ...(state.restMealStatus || {}),
    pending: true,
    breakfastAvailable: null,
    breakfastKey: ''
  };
  addPrompt({
    phase,
    type: 'manual',
    title: 'Long Rest',
    detail:
      'Resolve breakfast to determine overnight recovery from dinner and breakfast availability.',
    effect: 'manual'
  });
  log(
    'Added a Long Rest prompt. Breakfast will resolve overnight Labor and overtime Exhaustion recovery.'
  );
}

function recordMealAvailability(type, result, options = {}) {
  if (!state.restMealStatus) state.restMealStatus = structuredClone(defaultState.restMealStatus);
  if (type === 'dinner') {
    state.restMealStatus.dinnerAvailable = Boolean(result.available);
    state.restMealStatus.dinnerKey = options.key || state.restMealStatus.dinnerKey || '';
    log(
      `Dinner availability for the next rest was recorded as ${result.available ? 'available' : 'not available'}.`
    );
  }
  if (type === 'breakfast') {
    state.restMealStatus.breakfastAvailable = Boolean(result.available);
    state.restMealStatus.breakfastKey = options.key || state.restMealStatus.breakfastKey || '';
    log(
      `Breakfast availability for overnight recovery was recorded as ${result.available ? 'available' : 'not available'}.`
    );
  }
}

function hasDinnerStatusForRest() {
  return (
    state.restMealStatus &&
    state.restMealStatus.dinnerAvailable !== null &&
    state.restMealStatus.dinnerAvailable !== undefined
  );
}

function resolveNightDinner(phase, key, timing) {
  return addMealPrompts('dinner', phase, { key, timing });
}

function mealStatusText(value) {
  if (value === true) return 'available';
  if (value === false) return 'not available';
  return 'not checked';
}

function applyOvernightRestOutcome(phase = 'preAction') {
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
    state.crew.forEach((character) =>
      addPrompt({
        phase,
        type: 'save',
        character: character.name,
        title: 'No Overnight Meals',
        detail: `No dinner or breakfast was available. Constitution save DC ${noMealDc} or gain 1 Exhaustion. This DC increases by 2 for each consecutive day without meals.`,
        dc: noMealDc,
        ability: 'CON',
        effect: 'mealExhaustion'
      })
    );
  }

  if (dinnerAvailable || breakfastAvailable) state.noMealStreak = 0;
  recoverCrewLabor(laborRecovery, title);
  if (clearMode === 'all') clearOvertimeExhaustion(false);
  if (clearMode === 'one') clearOvertimeExhaustionAmount(1);
  log(
    `${title}: ${longRestBenefits ? 'long rest benefits apply' : 'long rest benefits do not apply'}, ${laborRecovery} Labor recovered, overtime Exhaustion clear mode: ${clearMode}.`
  );
  state.longRestLaborRecoveryPending = false;
  state.restMealStatus = structuredClone(defaultState.restMealStatus);
}

function noMealSaveDC() {
  return 15 + Math.max(0, Number(state.noMealStreak || 1) - 1) * 2;
}

function recoverCrewLabor(amount, reason) {
  state.crew.forEach((character) => {
    const before = Number(character.labor || 0);
    character.labor = Math.max(0, before - Number(amount));
    if (before !== character.labor) {
      log(
        `${character.name} recovered ${amount} Labor from ${reason}. Labor changed from ${formatNumber(before)} to ${formatNumber(character.labor)}.`
      );
    }
  });
}
