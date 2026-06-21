// Setup-mode behavior. Editing stays memory-only until Start Voyage succeeds.
const SETUP_OVERWRITE_CONFIRMATION =
  'Starting a new voyage will replace the saved voyage in this browser. Export your current voyage first if you want to keep it. Continue?';

function startNewVoyage() {
  setupDraft = defaultSetupDraft();
  appMode = 'setup';
  if (typeof document !== 'undefined') document.body?.classList.add('landing-active');
  render();
}

function backToLanding() {
  appMode = 'landing';
  render();
}

function resetSetupDefaults() {
  setupDraft = defaultSetupDraft();
  renderSetupScreen();
}

function startSetupVoyage() {
  const normalizedDraft = normalizedSetupDraftForStart(setupDraft);
  setupDraft = normalizedDraft;
  if (!setupDraftIsValid(normalizedDraft)) {
    renderSetupScreen();
    return false;
  }
  if (readSavedVoyageState() && !confirm(SETUP_OVERWRITE_CONFIRMATION)) {
    renderSetupScreen();
    return false;
  }
  undoStack = [];
  clearActionCommitSnapshot();
  state = createTrackerStateFromSetup(normalizedDraft);
  migrateState();
  log(`Started a new voyage aboard ${state.shipName}.`);
  saveStateSnapshot();
  publishPlayerState();
  enterTrackerMode();
  render();
  return true;
}

function normalizedSetupDraftForStart(draft = setupDraft) {
  const normalizedDraft = setupDraftForRender(draft);
  return {
    ...normalizedDraft,
    shipName: normalizedSetupShipName(normalizedDraft.shipName),
    crew: normalizedDraft.crew.map((character) => ({
      ...character,
      name: normalizedSetupCrewName(character.name)
    }))
  };
}

function createTrackerStateFromSetup(draft) {
  const normalizedDraft = normalizedSetupDraftForStart(draft);
  const errors = setupValidationErrors(normalizedDraft);
  if (errors.length) throw new Error(`Setup validation failed: ${errors.join(' ')}`);
  const nextState = structuredClone(defaultState);
  const crew = normalizedDraft.crew.map((character, index) => ({
    ...defaultCrewMember(index, character.name),
    name: character.name,
    ...Object.fromEntries(
      SETUP_CREW_TRAIT_FIELDS.map(({ field }) => [field, Boolean(character[field])])
    )
  }));
  nextState.version = APP_VERSION;
  nextState.setupComplete = true;
  nextState.shipName = normalizedDraft.shipName;
  nextState.crew = crew;
  nextState.plannedActions = {};
  nextState.confirmedActions = {};
  nextState.overtimeExhaustion = Object.fromEntries(crew.map((character) => [character.name, 0]));
  return nextState;
}

function ensureSetupDraft() {
  setupDraft = setupDraftForRender();
  return setupDraft;
}

function setSetupField(field, value) {
  const draft = ensureSetupDraft();
  if (field === 'shipName') draft.shipName = String(value ?? '');
  if (field === 'voyagePreset') draft.voyagePreset = String(value ?? 'marrowwind');
  renderSetupScreen();
}

function setSetupCrewName(index, value) {
  const draft = ensureSetupDraft();
  const character = draft.crew[Number(index)];
  if (character) character.name = normalizedSetupCrewName(value);
  renderSetupScreen();
}

function setSetupCrewSize(value) {
  const draft = ensureSetupDraft();
  const crewSize = clampSetupCrewSize(value);
  const defaults = defaultSetupDraft();
  draft.crewSize = crewSize;
  draft.crew = Array.from({ length: crewSize }, (_, index) => {
    const existing = draft.crew[index];
    return existing || defaults.crew[index] || setupCrewDraftFromMember(defaultCrewMember(index));
  });
  renderSetupScreen();
}

function setSetupCrewTrait(index, field, checked) {
  const draft = ensureSetupDraft();
  const character = draft.crew[Number(index)];
  if (character && SETUP_CREW_TRAIT_FIELDS.some((trait) => trait.field === field)) {
    character[field] = Boolean(checked);
  }
}
