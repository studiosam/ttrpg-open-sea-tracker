// GM screen rendering and UI-derived view helpers.
function syncFromInputs() {
  const previousWaterLevel = Number(state.waterLevel || 0);
  [
    'day',
    'turn',
    'waterLevel',
    'minIngress',
    'activeLeaks',
    'food',
    'freshWater',
    'repairMaterials',
    'salvagedTimber',
    'courseMeter'
  ].forEach((id) => {
    const element = q(id);
    if (element) state[id] = Number(element.value);
  });
  hideWaterLevelKnowledgeIfBelowCargoHold(previousWaterLevel, state.waterLevel);
  const travelInput = q('travel');
  if (travelInput) state.travelTicks = daysToTravelTicks(travelInput.value);
  state.courseMeter = clampCourseMeter(state.courseMeter);
  syncTravelDaysFromTicks();
  ['mastStatus', 'rudderStatus', 'pumpStatus', 'netStatus', 'riggingStatus'].forEach(
    (id) => (state[id] = q(id).value)
  );
}

// Single render pass for the GM app. Any state change should eventually flow through here.
function render() {
  if (appMode === 'landing') {
    renderLandingScreen();
    return;
  }
  if (appMode === 'setup') {
    renderSetupScreen();
    return;
  }
  if (typeof document !== 'undefined') document.body?.classList.remove('landing-active');
  migrateState();
  renderShipName();
  pruneUnavailablePlannedActions();
  syncTravelDaysFromTicks();
  [
    'day',
    'turn',
    'waterLevel',
    'minIngress',
    'activeLeaks',
    'food',
    'freshWater',
    'repairMaterials',
    'salvagedTimber',
    'courseMeter'
  ].forEach((id) => {
    const element = q(id);
    if (element) element.value = state[id];
  });
  if (q('travel')) q('travel').value = formatNumber(travelDaysFromTicks());
  ['mastStatus', 'rudderStatus', 'pumpStatus', 'netStatus', 'riggingStatus'].forEach(
    (id) => (q(id).value = state[id])
  );
  q('totalIngress').textContent = totalIngress();
  renderScoreboard();
  renderWaterEffect();
  renderWaterLedger();
  renderTurnFlow();
  renderStepVisibility();
  renderCrewSizeControls();
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

function renderShipName() {
  const title = q('trackerTitle');
  if (title) title.textContent = `${normalizedShipName(state.shipName)} Tracker`;
}

function waterScoreClass() {
  const level = Number(state.waterLevel);
  if (level >= 15) return 'danger';
  if (level >= 5) return 'warn';
  return 'good';
}

function waterEffectTitle() {
  const level = Number(state.waterLevel);
  if (level >= 20) return 'Sunk';
  if (level >= 15) return 'Neck Deep';
  if (level >= 10) return 'Waist Deep';
  if (level >= 5) return 'Cargo Hold';
  return 'Bilge Only';
}

function cumulativeWaterEffects() {
  const level = Number(state.waterLevel);
  const effects = [];
  if (level < 5) effects.push('No below-deck water penalties.');
  if (level >= 5) effects.push('Cargo Hold: below-deck actions take +1 Turn.');
  if (level >= 10) effects.push('Waist Deep: below-deck actions cost +1 Labor.');
  if (level >= 15)
    effects.push(`Neck Deep: travel penalty is ${state.waterTravelPenalty || 0} day(s).`);
  if (level >= 20) effects.push('Sunk: the Marrowwind is sinking.');
  return effects;
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function turnCountLabel(value) {
  const turns = Number(value);
  return `${formatNumber(turns)} Turn${turns === 1 ? '' : 's'}`;
}

// Always-visible GM scoreboard. This is the safest place for manual overrides mid-turn.
function renderScoreboard() {
  const board = q('scoreboard');
  const turn = q('scoreTurn');
  if (!board || !turn) return;
  const context = scoreboardContext();
  turn.textContent = `Day ${state.day} Turn ${state.turn} - Step ${state.turnStep}: ${context.turnStepTitle}`;
  board.innerHTML = scoreboardCardConfigs(context).map(renderScoreCard).join('');
}

function scoreboardContext() {
  const pendingPreAction = pendingPromptCount('preAction');
  const pendingAction = pendingPromptCount('action');
  const pendingWater = pendingPromptCount('water');
  const unresolvedChecks = pendingPreAction + pendingAction + pendingWater;
  const ongoingCount = state.ongoing.filter((o) => o.status === 'active').length;
  return {
    pendingPreAction,
    pendingAction,
    pendingWater,
    unresolvedChecks,
    ongoingCount,
    turnStepTitle: turnSteps.find((step) => step.id === state.turnStep)?.title || 'Unknown'
  };
}

function scoreboardCardConfigs(context) {
  return [
    voyageScoreCard(),
    waterIngressScoreCard(),
    systemsScoreCard(),
    suppliesScoreCard(),
    turnStatusScoreCard(context)
  ];
}

function renderScoreCard(card) {
  const value =
    card.value !== undefined && card.value !== null
      ? `<div class="score-value">${card.value}</div>`
      : '';
  const metrics = card.metrics ? scoreMetricGrid(card.metrics, card.metricClassName) : '';
  const sections = card.sections ? renderScoreSections(card.sections, card.sectionsClassName) : '';
  const detail = card.detail ? `<div class="score-detail">${card.detail}</div>` : '';
  const footer = card.footer ? scoreCardFooter(card.footer) : '';
  return `<div class="score-item ${card.className || ''}">
    <div class="score-label">${card.label}</div>
    ${value}
    ${metrics}
    ${sections}
    ${card.body || ''}
    ${card.controls || ''}
    ${detail}
    ${footer}
  </div>`;
}

function renderScoreSections(sections, className = '') {
  const renderedSections = sections.map(renderScoreSection).join('');
  return className ? `<div class="${className}">${renderedSections}</div>` : renderedSections;
}

function renderScoreSection(section) {
  const metrics = section.metrics ? scoreMetricGrid(section.metrics, section.metricClassName) : '';
  return `<div class="${section.className || 'score-card-section'}">
    ${section.title ? `<div class="score-subhead">${section.title}</div>` : ''}
    ${metrics}
    ${section.body || ''}
    ${section.controls || ''}
  </div>`;
}

function scoreCardFooter(footer) {
  return `<div class="score-card-footer ${footer.className || ''}">
    <span class="score-footer-title">${footer.title}</span>
    <span class="score-footer-summary">${footer.summary}</span>
  </div>`;
}

function scoreMetricGrid(metrics, className = 'score-metric-grid') {
  return `<div class="${className}">${metrics.map(renderScoreMetric).join('')}</div>`;
}

function renderScoreMetric(metric) {
  return scoreMetric(
    metric.label,
    metric.value,
    metric.controls || '',
    metric.detail || '',
    Boolean(metric.featured),
    metric.className || ''
  );
}

function scoreCheckDetail(preActionCount, actionCount, waterCount) {
  if (preActionCount) return `${preActionCount} before actions`;
  if (actionCount) return `${actionCount} action`;
  if (waterCount) return `${waterCount} water`;
  return 'No pending checks';
}

function scoreOngoingDetail() {
  const active = state.ongoing.filter((item) => item.status === 'active');
  if (!active.length) return 'No active work';
  const summaries = active.slice(0, 2).map((item) => {
    const action = actionById(item.actionId);
    const actors = (item.actors || []).join(', ');
    return `${action?.short || action?.name || item.actionId}: ${item.remaining} Turn${Number(item.remaining) === 1 ? '' : 's'}${actors ? ` (${actors})` : ''}`;
  });
  if (active.length > summaries.length) summaries.push(`+${active.length - summaries.length} more`);
  return summaries.join(' · ');
}

// Scoreboard cards can include compact controls so the DM does not need to leave the current phase.
function voyageScoreCard() {
  const courseState = courseStateForMeter();
  const travelBlocked = !canTravel();
  const detail = [
    `Helm success ${signedTicks(courseState.deltaTicks)} tick${Math.abs(courseState.deltaTicks) === 1 ? '' : 's'}`,
    travelBlocked ? 'Mast/rudder blocked' : '',
    knowledgeStatus('travel')
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    label: 'Voyage',
    className: `voyage-score-item ${travelBlocked ? 'danger' : courseState.className}`,
    metrics: [
      { label: 'Day', value: state.day, controls: scoreMiniControls('day', 1) },
      { label: 'Turn', value: state.turn, controls: scoreMiniControls('turn', 1) },
      {
        label: 'Travel Ticks',
        value: state.travelTicks,
        controls:
          scoreMiniControls('travelTicks', 1) +
          metricKnowledgeControls('travel', 'Reveal Travel Remaining'),
        detail: formatTravelDays(),
        featured: true
      },
      {
        label: 'Course',
        value: state.courseMeter,
        controls:
          scoreMiniControls('courseMeter', 1) +
          metricKnowledgeControls('courseState', 'Reveal Course'),
        detail: courseState.name,
        className: 'course-state-score-metric'
      }
    ],
    footer: { title: courseState.name, summary: detail }
  };
}

function waterIngressScoreCard() {
  const className = combinedWaterScoreClass();
  return {
    label: 'Water & Ingress',
    className: `water-score-item ${className}`,
    sectionsClassName: 'water-score-layout',
    sections: [
      {
        className: 'water-score-current',
        metricClassName: 'score-metric-stack water-current-stack',
        metrics: [
          {
            label: 'Current Water Level',
            value: state.waterLevel,
            controls: scoreMiniControls('waterLevel', 1),
            detail: knowledgeStatus('waterLevel'),
            featured: true
          }
        ],
        controls: knowledgeControls('waterLevel')
      },
      {
        className: 'water-score-ingress',
        metricClassName: 'score-metric-stack water-ingress-stack',
        metrics: [
          {
            label: 'Base Ingress',
            value: state.minIngress,
            controls: scoreMiniControls('minIngress', 1),
            className: 'good'
          },
          {
            label: 'Active Leaks',
            value: state.activeLeaks,
            controls: scoreMiniControls('activeLeaks', 1),
            className: activeLeaksSeverityClass()
          },
          {
            label: 'Total Ingress',
            value: totalIngress(),
            detail: knowledgeStatus('totalIngress'),
            className: totalIngressSeverityClass()
          }
        ],
        controls: `<div class="score-knowledge-controls score-knowledge-inline">
          <button type="button" data-action="reveal-player-knowledge" data-field="totalIngress" title="Tell players the current ${fieldLabel('totalIngress')}">Reveal Total Ingress</button>
          <button type="button" data-action="forget-player-knowledge" data-field="totalIngress" title="Hide ${fieldLabel('totalIngress')} from the player view">?</button>
        </div>`
      }
    ],
    footer: {
      className: 'water-score-effects',
      title: waterEffectTitle(),
      summary: cumulativeWaterEffects().join(' ')
    }
  };
}

function combinedWaterScoreClass() {
  const waterClass = waterScoreClass();
  if (waterClass === 'danger') return 'danger';
  if (waterClass === 'warn' || Number(state.activeLeaks) > 0) return 'warn';
  return 'good';
}

function turnStatusScoreCard(context) {
  const className = context.unresolvedChecks || context.ongoingCount ? 'warn' : 'good';
  return {
    label: 'Checks & Work',
    className: `turn-status-score-item ${className}`,
    metricClassName: 'turn-status-grid',
    metrics: [
      {
        label: 'Checks',
        value: context.unresolvedChecks,
        detail: scoreCheckDetail(
          context.pendingPreAction,
          context.pendingAction,
          context.pendingWater
        )
      },
      { label: 'Ongoing', value: context.ongoingCount, detail: scoreOngoingDetail() }
    ]
  };
}

function suppliesScoreCard() {
  const className =
    Number(state.food) <= 1 || Number(state.freshWater) <= 1
      ? 'danger'
      : Number(state.repairMaterials) <= 1
        ? 'warn'
        : '';
  return {
    label: 'Supplies',
    className: `supplies-score-item ${className}`,
    metricClassName: 'score-metric-grid supplies-metric-grid',
    metrics: [
      {
        label: 'Food',
        value: formatNumber(state.food),
        controls: scoreMiniControls('food', 0.25) + metricKnowledgeControls('food', 'Reveal Food'),
        detail: knowledgeStatus('food')
      },
      {
        label: 'Water',
        value: formatNumber(state.freshWater),
        controls:
          scoreMiniControls('freshWater', 0.25) +
          metricKnowledgeControls('freshWater', 'Reveal Fresh Water'),
        detail: knowledgeStatus('freshWater')
      },
      {
        label: 'Repairs',
        value: state.repairMaterials,
        controls:
          scoreMiniControls('repairMaterials', 1) +
          metricKnowledgeControls('repairMaterials', 'Reveal Repair Supplies'),
        detail: knowledgeStatus('repairMaterials')
      }
    ]
  };
}

function scoreMetric(label, value, controls = '', detail = '', featured = false, className = '') {
  return `<div class="score-metric ${featured ? 'featured' : ''} ${className}">
    <div class="score-metric-label">${label}</div>
    <div class="score-metric-value">${value}</div>
    ${detail ? `<div class="score-metric-detail">${detail}</div>` : ''}
    ${controls}
  </div>`;
}

function scoreMiniControls(field, step) {
  return `<div class="score-mini-controls">
    <button type="button" data-action="scoreboard-change" data-field="${field}" data-amount="${-step}" title="Decrease ${fieldLabel(field)}">-</button>
    <button type="button" data-action="scoreboard-change" data-field="${field}" data-amount="${step}" title="Increase ${fieldLabel(field)}">+</button>
  </div>`;
}

function systemsScoreCard() {
  const systemEffects = failedSystemEffects();
  const failed = systemEffects.length > 0;
  return {
    label: 'Systems',
    className: `systems-score-item ${failed ? 'warn' : 'good'}`,
    body: scoreSystemControls(),
    footer: {
      title: failed ? 'Effects' : 'All Systems OK',
      summary: failed
        ? systemEffects.join(' · ')
        : 'Normal helm, pumping, net fishing, and deck movement.'
    }
  };
}

function failedSystemEffects() {
  return [
    state.mastStatus === 'Broken' ? 'Mast: helm makes no sail progress' : '',
    state.rudderStatus === 'Broken' && state.mastStatus !== 'Broken'
      ? 'Rudder: helm applies random course drift'
      : '',
    state.rudderStatus === 'Broken' && state.mastStatus === 'Broken'
      ? 'Rudder: random drift suppressed while mast is broken'
      : '',
    state.pumpStatus === 'Jammed' ? 'Pump: bilge pump actions unavailable' : '',
    state.netStatus === 'Tangled' ? 'Net: cast net unavailable until reset' : '',
    state.riggingStatus === 'Broken' ? 'Rigging: top-deck DEX save risk' : ''
  ].filter(Boolean);
}

function knowledgeControls(field, revealLabel = `Reveal ${fieldLabel(field)}`) {
  return `<div class="score-knowledge-controls">
    <button type="button" data-action="reveal-player-knowledge" data-field="${field}" title="Tell players the current ${fieldLabel(field)}">${revealLabel}</button>
    <button type="button" data-action="forget-player-knowledge" data-field="${field}" title="Hide ${fieldLabel(field)} from the player view">?</button>
  </div>`;
}

function metricKnowledgeControls(field, revealLabel = `Reveal ${fieldLabel(field)}`) {
  return `<div class="score-knowledge-controls score-metric-knowledge-controls">
    <button type="button" data-action="reveal-player-knowledge" data-field="${field}" title="Tell players the current ${fieldLabel(field)}">${revealLabel}</button>
    <button type="button" data-action="forget-player-knowledge" data-field="${field}" title="Hide ${fieldLabel(field)} from the player view">?</button>
  </div>`;
}

function knowledgeStatus(field) {
  const known = playerKnownValue(field);
  if (field === 'waterLevel' && Number(state.waterLevel) >= 5) return 'Visible: cargo hold';
  return known.known ? `Known: ${formatNumber(known.value)}` : 'Player view: ?';
}

function scoreSystemControls() {
  return `<div class="score-system-controls">
    ${systemControl('mastStatus', 'Mast', 'Working', 'Broken')}
    ${systemControl('rudderStatus', 'Rudder', 'Working', 'Broken')}
    ${systemControl('pumpStatus', 'Pump', 'Working', 'Jammed')}
    ${systemControl('netStatus', 'Net', 'Ready', 'Tangled')}
    ${systemControl('riggingStatus', 'Rigging', 'Intact', 'Broken')}
  </div>`;
}

function systemControl(field, label, repairedStatus, failedStatus) {
  const failed = state[field] === failedStatus;
  return `<div class="score-system-control ${failed ? 'failed' : 'ok'}">
    <span>${label}</span>
    <button type="button" data-action="scoreboard-set" data-field="${field}" data-value="${repairedStatus}" title="Reset ${label}">OK</button>
    <button type="button" data-action="scoreboard-set" data-field="${field}" data-value="${failedStatus}" title="Fail ${label}">!</button>
  </div>`;
}

function scoreboardChange(field, amount) {
  syncFromInputs();
  pushUndo(`Changed ${fieldLabel(field)}`);
  const before = Number(state[field] || 0);
  state[field] = Math.max(0, before + Number(amount));
  if (field === 'courseMeter') state.courseMeter = clampCourseMeter(state.courseMeter);
  if (field === 'travelTicks') {
    state.travelTicks = Math.max(0, Math.round(Number(state.travelTicks || 0)));
    syncTravelDaysFromTicks();
  }
  if (field === 'waterLevel') updateWaterTravelPenalty();
  if (field === 'waterLevel') hideWaterLevelKnowledgeIfBelowCargoHold(before, state.waterLevel);
  if (['day', 'turn'].includes(field)) reconcileManualNightOvertime();
  log(
    `Manual override: ${fieldLabel(field)} changed from ${formatNumber(before)} to ${formatNumber(state[field])}.`
  );
  render();
}

function scoreboardSet(field, value) {
  syncFromInputs();
  pushUndo(`Set ${fieldLabel(field)}`);
  const before = state[field];
  state[field] = value;
  if (field === 'waterLevel') hideWaterLevelKnowledgeIfBelowCargoHold(before, state.waterLevel);
  log(`Manual override: ${fieldLabel(field)} changed from ${before} to ${value}.`);
  render();
}

function revealPlayerKnowledge(field) {
  syncFromInputs();
  pushUndo(`Revealed ${fieldLabel(field)}`);
  rememberPlayerKnowledge(field);
  render();
}

function forgetPlayerKnowledge(field) {
  syncFromInputs();
  pushUndo(`Hid ${fieldLabel(field)}`);
  if (!state.playerKnowledge) state.playerKnowledge = structuredClone(defaultState.playerKnowledge);
  state.playerKnowledge[field] = null;
  if (field === 'waterLevel') {
    forgetExactWaterKnowledge();
  }
  log(`Players no longer have an exact known value for ${fieldLabel(field)}.`);
  render();
}

function renderTurnFlow() {
  const steps = q('turnSteps');
  const body = q('turnStepBody');
  steps.innerHTML = turnSteps
    .map((step) => {
      const stateClass =
        step.id === state.turnStep ? ' active' : step.id < state.turnStep ? ' done' : '';
      return `<div class="turn-step${stateClass}">${step.id}. ${step.title}</div>`;
    })
    .join('');
  body.innerHTML = turnStepMarkup();
}

// Hide inactive workflow panels so each phase shows only what is needed to continue.
function renderStepVisibility() {
  const active = turnSteps.find((step) => step.id === state.turnStep);
  ['voyagePanel', 'crewPanel', 'checksPanel'].forEach((id) => q(id).classList.add('hidden'));
  [
    'voyageTopBlock',
    'waterBlock',
    'suppliesBlock',
    'systemsBlock',
    'activeEffectsBlock',
    'crewStatsBlock',
    'turnControlsBlock',
    'pendingBlock',
    'eventBlock',
    'conditionsBlock'
  ].forEach((id) => q(id).classList.add('hidden'));
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
  if (state.turnStep === 3) showBlocks(['activeEffectsBlock', 'crewStatsBlock']);
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

function showBlocks(ids) {
  ids.forEach((id) => q(id).classList.remove('hidden'));
}

// Builds the instruction card and navigation controls for the active turn phase.
function turnStepMarkup() {
  const preActionCount = pendingPromptCount('preAction');
  const actionCheckCount = pendingPromptCount('action');
  const waterPromptCount = pendingPromptCount('water');
  const unconfirmedCount = state.crew.filter(
    (c) => state.plannedActions[c.name] && !state.confirmedActions[c.name]
  ).length;
  const confirmableCount = state.crew.filter((c) => canConfirmAction(c.name)).length;
  const eventRequired = openSeaEventRequiredForTurn();
  const eventStatus = !eventRequired
    ? 'No Open Sea Event is rolled this turn.'
    : state.eventResolvedThisTurn
      ? 'Event resolved.'
      : 'Enter the d20 result and resolve it before continuing.';
  const nightDecision = isNightDecisionPoint();
  const waterStatus = state.waterUpdatedThisTurn
    ? `Water update applied. ${waterPromptCount ? `${waterPromptCount} water-effect prompt(s) remain.` : nightDecision ? 'Nightfall reached. Choose Rest or Night Overtime in the panel under the scoreboard.' : 'Use the scoreboard for any final manual overrides, then advance the turn.'}`
    : 'Apply the water formula, review the scoreboard, then advance the turn.';
  const scripted = scriptedEventForTurn();
  const scriptedText = scripted
    ? scripted.stepDetail || scripted.title
    : 'No scripted event for this day and turn.';
  const scriptedAlertClass = scripted?.alert ? ' scripted-alert' : '';
  const scriptedButtonClass = scripted?.alert ? 'primary warn' : 'primary';
  if (state.turnStep === 1) {
    if (preActionCount && !state.scriptedCheckedThisTurn) {
      return `<div class="prompt-title">1. Resolve start-turn prompts</div>
        <div class="prompt-detail">${preActionCount} start-turn prompt(s) must be resolved before rolling the Open Sea Event or selecting actions.</div>
        <div class="actions">
          <button class="primary" data-action="run-scripted-step">Check Scripted Events</button>
        </div>`;
    }
    if (state.scriptedCheckedThisTurn) {
      return `<div class="prompt-title">1. Check scripted events or triggers</div>
        <div class="prompt-detail">${preActionCount ? `${preActionCount} scripted/start-turn prompt(s) remain. Resolve them before rolling the Open Sea Event.` : 'Scripted events and start-turn triggers are checked.'}</div>
        <div class="actions">
          <button data-action="run-scripted-step">Check Again</button>
          <button class="primary" data-action="go-to-turn-step" data-step="2"${preActionCount ? ' disabled' : ''}>Roll Open Sea Event</button>
        </div>`;
    }
    return `<div class="${`scripted-check${scriptedAlertClass}`}">
      <div class="prompt-title">1. Check scripted events or triggers</div>
      ${scripted?.alert ? `<div class="scripted-banner">SCRIPTED ENCOUNTER: ${h(scripted.title)}</div>` : ''}
      <div class="prompt-detail">${scriptedText}</div>
      <div class="actions">
        <button class="${scriptedButtonClass}" data-action="run-scripted-step">Check Scripted Events</button>
      </div>
    </div>`;
  }
  if (state.turnStep === 2) {
    return `<div class="prompt-title">2. Roll for Open Sea Event</div>
      <div class="prompt-detail">${preActionCount ? `${preActionCount} event check(s) must be resolved before actions can be selected.` : eventStatus}</div>
      <div class="actions">
        <button data-action="go-to-turn-step" data-step="3"${(!eventRequired || state.eventResolvedThisTurn) && !preActionCount ? '' : ' disabled'}>Continue to Actions</button>
      </div>`;
  }
  if (state.turnStep === 3) {
    return `<div class="prompt-title">3. Set each character's action visibly</div>
      <div class="prompt-detail">${setActionsStepText(unconfirmedCount)}</div>
      <div class="actions">
        <button class="primary" data-action="confirm-all-actions"${confirmableCount ? '' : ' disabled'}>Confirm All Available</button>
        <button data-action="go-to-turn-step" data-step="4"${actionsStepComplete(unconfirmedCount) ? '' : ' disabled'}>Resolve Required Checks</button>
        <button data-action="set-unset-actions-to-idle">Set Unset to Idle</button>
        <button data-action="force-scripted-scene-turn">Force All Idle for Scene</button>
      </div>`;
  }
  if (state.turnStep === 5) {
    const advanceControls = state.isNightOvertime
      ? `<button class="primary" data-action="continue-night-overtime"${state.waterUpdatedThisTurn && !waterPromptCount ? '' : ' disabled'}>Continue Night Overtime</button>
        <button class="good" data-action="end-night-overtime-and-rest"${state.waterUpdatedThisTurn && !waterPromptCount ? '' : ' disabled'}>End Night Overtime and Rest</button>`
      : `<button class="primary" data-action="advance-turn-no-ongoing-tick"${state.waterUpdatedThisTurn && !waterPromptCount && !nightDecision ? '' : ' disabled'}>Advance Turn</button>`;
    return `<div class="prompt-title">5. Update Water and Advance</div>
      <div class="prompt-detail">${waterStatus} Review the water update preview in the Water panel.</div>
      <div class="actions">
        <button class="primary" data-action="end-turn"${state.waterUpdatedThisTurn ? ' disabled' : ''}>Apply Water Formula</button>
        ${advanceControls}
      </div>`;
  }
  if (state.turnStep === 4) {
    return `<div class="prompt-title">4. Resolve required checks</div>
      <div class="prompt-detail">${actionCheckCount ? `${actionCheckCount} action check(s) remain. Resolve them before continuing unless you are intentionally overriding.` : 'No action checks remain.'}</div>
      <div class="actions">
        <button data-action="go-to-turn-step" data-step="3">Back to Actions</button>
        <button class="primary" data-action="go-to-turn-step" data-step="5"${actionCheckCount ? ' disabled' : ''}>Update Water</button>
      </div>`;
  }
  return `<div class="prompt-title">Turn Step</div>
    <div class="prompt-detail">Unknown turn step. Return to the current water/update step.</div>
    <div class="actions"><button class="primary" data-action="go-to-turn-step" data-step="5">Water / Advance</button></div>`;
}

function setActionsStepText(unconfirmedCount) {
  const parts = [planReadyText()];
  if (unconfirmedCount) {
    parts.push(
      `${unconfirmedCount} planned action(s) still need confirmation. Labor changes, checks, and ongoing work are applied when you continue to the Checks step.`
    );
  } else if (allPlansReady()) {
    parts.push('All planned actions are confirmed. Continue to Checks to commit the action plan.');
  }
  return parts.join(' ');
}

function actionsStepComplete(unconfirmedCount) {
  return allPlansReady() && unconfirmedCount === 0;
}

function planReadyText() {
  const missing = state.crew.filter((c) => !state.plannedActions[c.name]).map((c) => c.name);
  const warnings = groupWarnings();
  const parts = [];
  if (missing.length) parts.push(`Missing actions: ${missing.join(', ')}.`);
  if (warnings.length) parts.push(warnings.join(' '));
  if (!parts.length) parts.push('All characters have planned actions.');
  return parts.join(' ');
}

function allPlansReady() {
  const missing = state.crew.some((c) => !state.plannedActions[c.name]);
  return !missing && groupWarnings().length === 0;
}

function goToTurnStep(step) {
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

function runScriptedStep() {
  syncFromInputs();
  pushUndo('Checked scripted events');
  addStartTurnTriggers();
  state.scriptedCheckedThisTurn = true;
  saveStateSnapshot();
  render();
}

function renderWaterEffect() {
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

function renderWaterLedger() {
  q('waterLedger').innerHTML = waterEquationMarkup();
}

function waterEquationValues() {
  const current = Number(state.waterLevel || 0);
  const ingress = totalIngress();
  const pumping = Number(state.turnLedger.pumping || 0);
  const buckets = Number(state.turnLedger.buckets || 0);
  const next = Math.max(0, current + ingress - pumping - buckets);
  return { current, ingress, pumping, buckets, next };
}

function waterEquationMarkup() {
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

function renderCrewSizeControls() {
  const readout = q('crewSizeReadout');
  if (!readout) return;
  const size = state.crew.length;
  readout.textContent = size;
  const decrease = q('crewSizeDecrease');
  const increase = q('crewSizeIncrease');
  if (decrease) decrease.disabled = size <= MIN_CREW_SIZE;
  if (increase) increase.disabled = size >= MAX_CREW_SIZE;
}

function renderCrewSetup() {
  const box = q('crewSetup');
  if (!box) return;
  box.innerHTML = state.crew
    .map(
      (character, index) => `<div class="crew-setup-row">
    <label>
      <span>Name</span>
      <input type="text" value="${h(character.name)}" data-change-action="rename-crew-member" data-index="${index}" />
    </label>
    <div class="crew-setup-stat">
      <span>Labor</span>
      <div class="stat-stepper">
        <button data-action="crew-change" data-index="${index}" data-field="labor" data-amount="-1">-</button>
        <span>${h(formatNumber(character.labor))}</span>
        <button data-action="crew-change" data-index="${index}" data-field="labor" data-amount="1">+</button>
      </div>
    </div>
    <div class="crew-setup-stat">
      <span>Exhaustion</span>
      <div class="stat-stepper">
        <button data-action="crew-change" data-index="${index}" data-field="exhaustion" data-amount="-1">-</button>
        <span>${h(formatNumber(character.exhaustion))}</span>
        <button data-action="crew-change" data-index="${index}" data-field="exhaustion" data-amount="1">+</button>
      </div>
    </div>
    <div class="crew-background-grid">
      <label class="crew-background-toggle">
        <input type="checkbox" ${character.sailorPirateBackground ? ' checked' : ''} data-change-action="set-crew-background" data-index="${index}" />
        <span>Sailor/Pirate</span>
      </label>
      <label class="crew-background-toggle">
        <input type="checkbox" ${character.fishermanBackground ? ' checked' : ''} data-change-action="set-crew-proficiency" data-index="${index}" data-field="fishermanBackground" />
        <span>Fisherman</span>
      </label>
      <label class="crew-background-toggle">
        <input type="checkbox" ${character.waterVehiclesProficiency ? ' checked' : ''} data-change-action="set-crew-proficiency" data-index="${index}" data-field="waterVehiclesProficiency" />
        <span>Water Vehicles</span>
      </label>
      <label class="crew-background-toggle">
        <input type="checkbox" ${character.navigatorToolsProficiency ? ' checked' : ''} data-change-action="set-crew-proficiency" data-index="${index}" data-field="navigatorToolsProficiency" />
        <span>Navigator's Tools</span>
      </label>
      <label class="crew-background-toggle">
        <input type="checkbox" ${character.cartographerToolsProficiency ? ' checked' : ''} data-change-action="set-crew-proficiency" data-index="${index}" data-field="cartographerToolsProficiency" />
        <span>Cartographer's Tools</span>
      </label>
    </div>
  </div>`
    )
    .join('');
}

function renderCrew() {
  const body = q('crewBody');
  body.innerHTML = '';
  state.crew.forEach((c, i) => {
    const status = characterStatus(c.name);
    const planned = state.plannedActions[c.name] || '';
    const locked = isAutoPlanned(c.name) || Boolean(state.confirmedActions[c.name]);
    const options = availableActionOptions(c.name)
      .map((id) => {
        const action = actionById(id);
        const selected = planned === id ? ' selected' : '';
        return `<option value="${id}"${selected}>${h(action.name)}</option>`;
      })
      .join('');
    const confirmed = state.confirmedActions[c.name] ? 'Confirmed' : 'Confirm';
    const confirmDisabled = canConfirmAction(c.name) ? '' : ' disabled';
    const groupHelp = groupHelpText(c.name);
    const deckChoice = salvageLumberDeckChoiceControl(c.name, i, planned, locked);
    const tr = document.createElement('tr');
    tr.className = 'crewrow';
    tr.innerHTML = `<td>${h(c.name)}</td>
      <td>
        <select class="action-select" data-change-action="set-planned-action" data-index="${i}"${locked ? ' disabled' : ''}>
          <option value="">Choose action...</option>
        ${options}
        </select>
        ${locked ? `<span class="pill warn">${state.confirmedActions[c.name] ? 'locked' : 'auto'}</span>` : ''}
        ${deckChoice}
        ${groupHelp ? `<div class="small">${h(groupHelp)}</div>` : ''}
      </td>
      <td>
        <div class="stat-stepper">
          <button data-action="crew-change" data-index="${i}" data-field="labor" data-amount="-1">-</button>
          <span>${c.labor}</span>
          <button data-action="crew-change" data-index="${i}" data-field="labor" data-amount="1">+</button>
        </div>
      </td>
      <td>
        <div class="stat-stepper">
          <button data-action="crew-change" data-index="${i}" data-field="exhaustion" data-amount="-1">-</button>
          <span>${c.exhaustion}</span>
          <button data-action="crew-change" data-index="${i}" data-field="exhaustion" data-amount="1">+</button>
        </div>
      </td>
      <td>${h(characterTurnsRemaining(c.name))}</td>
      <td>${h(status)}</td>
      <td>
        <div class="row-actions">
          <button class="primary" data-action="confirm-character-action" data-index="${i}"${confirmDisabled}>${confirmed}</button>
          <button data-action="clear-character-action" data-index="${i}">Clear</button>
        </div>
      </td>`;
    body.appendChild(tr);
  });
  renderPlanSummary();
}

function salvageLumberDeckChoiceControl(name, index, plannedAction, locked) {
  if (plannedAction !== 'salvageLumber') return '';
  const checked = state.salvageLumberBelowDeck?.[name] ? ' checked' : '';
  const disabled = locked ? ' disabled' : '';
  return `<label class="small action-option-toggle">
    <input type="checkbox" data-change-action="set-salvage-lumber-deck" data-index="${index}"${checked}${disabled} />
    Below deck salvage (unchecked = above deck)
  </label>`;
}

function characterTurnsRemaining(name) {
  const ongoing = state.ongoing.find(
    (item) => item.status === 'active' && item.actors.includes(name)
  );
  if (ongoing) return String(Number(ongoing.remaining || 1));
  const action = actionById(state.confirmedActions[name]);
  if (action?.id === 'idle') return '-';
  if (action) return String(actionDuration(action, name));
  return '-';
}

function characterDoneInStatus(name) {
  const ongoing = state.ongoing.some(
    (item) => item.status === 'active' && item.actors.includes(name)
  );
  if (ongoing) return 'normal';
  const action = actionById(state.confirmedActions[name]);
  if (action?.id === 'idle') return '';
  if (action && belowDeckDurationPenalty(action, name) > 0) return 'flooded';
  return action ? 'normal' : '';
}

// Recomputed every render so impossible actions disappear as ship state changes.
function availableActionOptions(name) {
  return actionOrder
    .filter((actionId) => isActionDropdownAvailable(name, actionById(actionId)))
    .sort((leftId, rightId) => actionById(leftId).name.localeCompare(actionById(rightId).name));
}

// Availability checks are ordered from hard requirements to per-turn capacity limits.
function isActionDropdownAvailable(name, action) {
  if (!action) return false;
  if (state.confirmedActions[name] === action.id) return true;
  if (isLockedGroupMember(action.id, name)) return true;
  if (actionRequirementProblem(action)) return false;
  if (wouldViolateRepairMaterialCapacity(name, action)) return false;
  if (wouldViolateOncePerTurn(name, action.id)) return false;
  if (wouldViolateGroupCapacity(name, action)) return false;
  return true;
}

// Prevent mutually exclusive or limited actions from being over-assigned in the same turn.
function wouldViolateOncePerTurn(name, actionId) {
  if (actionId === 'helm') return selectedByOthers(name, ['helm']) > 0;
  if (actionId === 'pump') return selectedByOthers(name, ['pump', 'pumpCoop']) > 0;
  if (actionId === 'pumpCoop')
    return selectedByOthers(name, ['pump']) > 0 || selectedByOthers(name, ['pumpCoop']) >= 2;
  if (actionId === 'harpoon') return selectedByOthers(name, ['harpoon', 'assistHarpoon']) > 0;
  if (actionId === 'assistHarpoon')
    return (
      selectedByOthers(name, ['harpoon']) > 0 || selectedByOthers(name, ['assistHarpoon']) >= 2
    );
  if (actionId === 'castNet') return selectedByOthers(name, ['castNet']) >= 2;
  if (actionId === 'recoverWreckage') return selectedByOthers(name, ['recoverWreckage']) > 0;
  return false;
}

// Capacity checks handle fixed-size teams and multiple leak-repair teams.
function wouldViolateGroupCapacity(name, action) {
  if (action.id === 'repairLeak') {
    const maxRepairers = Number(state.activeLeaks || 0) * action.groupSize;
    return maxRepairers <= 0 || selectedByOthers(name, ['repairLeak']) >= maxRepairers;
  }
  if (action.groupSize && !action.allowMultipleGroups) {
    return selectedByOthers(name, [action.id]) >= action.groupSize;
  }
  return false;
}

function selectedByOthers(name, actionIds) {
  return state.crew.filter(
    (crew) => crew.name !== name && actionIds.includes(state.plannedActions[crew.name])
  ).length;
}

function wouldViolateRepairMaterialCapacity(name, action) {
  if (!action?.repairCost) return false;
  if (action.id === 'repairLeak') {
    const maxRepairers = availableRepairMaterials() * action.groupSize;
    return maxRepairers <= 0 || selectedByOthers(name, ['repairLeak']) >= maxRepairers;
  }
  return plannedRepairMaterialCost(name, action.id) > availableRepairMaterials();
}

function plannedRepairMaterialCost(candidateName = '', candidateActionId = null) {
  const actionActors = new Map();
  state.crew.forEach((character) => {
    const actionId =
      character.name === candidateName ? candidateActionId : state.plannedActions[character.name];
    const action = actionById(actionId);
    if (!action?.repairCost) return;
    if (!actionActors.has(action.id)) actionActors.set(action.id, []);
    actionActors.get(action.id).push(character.name);
  });
  return [...actionActors.entries()].reduce((total, [actionId, actors]) => {
    const action = actionById(actionId);
    return total + plannedRepairMaterialCostForAction(action, actors);
  }, 0);
}

function plannedRepairMaterialCostForAction(action, actors) {
  if (!action?.repairCost || !actors.length) return 0;
  if (action.id === 'repairLeak') return Math.ceil(actors.length / action.groupSize);
  if (action.groupSize || action.sharedStart || action.deferComplete) {
    return Number(valueOfRepairCost(action.repairCost, actors)) || 0;
  }
  return actors.reduce(
    (total, actor) => total + (Number(valueOfRepairCost(action.repairCost, [actor])) || 0),
    0
  );
}

// If state changes make a pending choice illegal, remove it before rendering the dropdown.
function pruneUnavailablePlannedActions() {
  state.crew.forEach((character) => {
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

function characterStatus(name) {
  const ongoing = state.ongoing.find((o) => o.actors.includes(name) && o.status === 'active');
  if (ongoing) {
    const action = actionById(ongoing.actionId);
    return `${action.name} (${turnCountLabel(ongoing.remaining)})`;
  }
  if (state.confirmedActions[name]) return 'Confirmed';
  return 'Active';
}

// A character can confirm only when requirements, group sizes, and per-turn limits are satisfied.
function canConfirmAction(name) {
  const action = actionById(state.plannedActions[name]);
  if (!action) return false;
  if (state.confirmedActions[name]) return false;
  if (isLockedGroupMember(action.id, name)) return true;
  if (actionRequirementProblem(action)) return false;
  if (actionPlanProblemsFor(action.id).length) return false;
  if (action.groupSize && !groupIsReady(action.id)) return false;
  return true;
}

function groupHelpText(name) {
  const action = actionById(state.plannedActions[name]);
  if (!action) return '';
  const requirementProblem = actionRequirementProblem(action);
  if (requirementProblem && !isLockedGroupMember(action.id, name)) return requirementProblem;
  const problems = actionPlanProblemsFor(action.id);
  if (problems.length) return problems.join(' ');
  if (!action.groupSize || groupIsReady(action.id)) return '';
  const selected = state.crew.filter((c) => state.plannedActions[c.name] === action.id).length;
  return `${action.name} requires ${action.groupSize} players. ${selected}/${action.groupSize} selected.`;
}

// Summary is intentionally plain text so problems are readable while scanning the crew table.
function renderPlanSummary() {
  const lines = state.crew.map((c) => {
    const id = state.plannedActions[c.name];
    const action = actionById(id);
    const confirmed = state.confirmedActions[c.name] ? ' confirmed' : '';
    return `${c.name}: ${action ? action.name : 'No action set'}${confirmed}`;
  });
  const groupLines = groupWarnings();
  q('planSummary').textContent = lines.concat(groupLines).join('\n');
}

function groupWarnings() {
  return [...new Set(actionPlanProblems().map((problem) => problem.message))];
}

function actionPlanProblemsFor(actionId) {
  return actionPlanProblems()
    .filter((problem) => problem.actionIds.includes(actionId))
    .map((problem) => problem.message);
}

// Collect all action-planning issues before the DM commits confirmations.
function actionPlanProblems() {
  const problems = [];
  addOncePerTurnProblems(problems);
  addGroupedActionProblems(problems);
  addRepairLeakProblems(problems);
  addRepairMaterialPlanProblems(problems);
  return problems;
}

function addPlanProblem(problems, actionIds, message) {
  problems.push({ actionIds, message });
}

function addOncePerTurnProblems(problems) {
  if (selectedCount('helm') > 1) {
    addPlanProblem(problems, ['helm'], 'Man Helm can only be assigned once per turn.');
  }
  if (selectedCount('pump') > 1 || (selectedCount('pump') > 0 && selectedCount('pumpCoop') > 0)) {
    addPlanProblem(
      problems,
      ['pump', 'pumpCoop'],
      'Only one bilge pump action can be assigned per turn: solo or cooperative.'
    );
  }
  if (
    selectedCount('harpoon') > 1 ||
    (selectedCount('harpoon') > 0 && selectedCount('assistHarpoon') > 0)
  ) {
    addPlanProblem(
      problems,
      ['harpoon', 'assistHarpoon'],
      'Only one harpoon fishing action can be assigned per turn: solo or assisted.'
    );
  }
}

function addGroupedActionProblems(problems) {
  actions
    .filter((action) => action.groupSize && !action.allowMultipleGroups)
    .forEach((action) => {
      const count = selectedCount(action.id);
      if (count > 0 && count !== action.groupSize) {
        addPlanProblem(
          problems,
          [action.id],
          `${action.name} requires exactly ${action.groupSize} player${action.groupSize === 1 ? '' : 's'}. ${count}/${action.groupSize} selected.`
        );
      }
    });
}

function addRepairLeakProblems(problems) {
  const count = selectedCount('repairLeak');
  if (!count) return;
  const activeLeaks = Number(state.activeLeaks || 0);
  if (activeLeaks <= 0) {
    addPlanProblem(
      problems,
      ['repairLeak'],
      'Repair Active Leak cannot be assigned because there are no active leaks.'
    );
    return;
  }
  if (count % 2 !== 0) {
    addPlanProblem(
      problems,
      ['repairLeak'],
      `Repair Active Leak requires 2 players per leak. ${count} selected.`
    );
  }
  const repairTeams = Math.floor(count / 2);
  if (repairTeams > activeLeaks) {
    addPlanProblem(
      problems,
      ['repairLeak'],
      `Only ${activeLeaks} active leak${activeLeaks === 1 ? '' : 's'} can be repaired this turn. Assign at most ${activeLeaks * 2} repair crew members.`
    );
  }
}

function addRepairMaterialPlanProblems(problems) {
  const repairActionIds = [
    ...new Set(
      Object.values(state.plannedActions || {}).filter(
        (actionId) => actionById(actionId)?.repairCost
      )
    )
  ];
  if (!repairActionIds.length) return;
  const required = plannedRepairMaterialCost();
  const available = availableRepairMaterials();
  if (required <= available) return;
  addPlanProblem(
    problems,
    repairActionIds,
    `Repair actions require ${required} Repair Material${required === 1 ? '' : 's'}, but only ${available} available.`
  );
}

function renderActiveEffects() {
  const box = q('activeEffects');
  if (!box) return;
  box.innerHTML = '';
  const effects = activePlayEffects();
  if (!effects.length) {
    box.innerHTML = '<span class="pill good">No active effects changing action choices</span>';
    return;
  }
  effects.forEach((effect) => {
    const row = document.createElement('div');
    row.className = `progress-row state-effect ${effect.className || ''}`;
    row.innerHTML = `<div class="prompt-title">${effect.title}</div>
      <div class="prompt-detail">${effect.detail}</div>`;
    box.appendChild(row);
  });
}

function activePlayEffects() {
  const effects = [];
  if (state.isNightOvertime) {
    effects.push({
      title: 'Night Overtime',
      detail: 'The crew is working through the night. Exhaustion risk is increasing.',
      className: 'danger'
    });
  }
  const waterEffect = activeWaterEffect();
  if (waterEffect) effects.push(waterEffect);
  const scripted = scriptedEventForTurn();
  if (scripted?.activeDetail) {
    effects.push({
      title: scripted.title,
      detail: scripted.activeDetail,
      className: scripted.className || '',
      dmOnly: scripted.dmOnly !== false
    });
  }
  state.conditions
    .filter((condition) => Number(condition.turns) > 0)
    .forEach((condition) => effects.push(conditionEffect(condition)));
  if (state.riggingStatus === 'Broken') {
    effects.push({
      title: 'Broken Rigging',
      detail:
        'At the start of each turn, a random top-deck creature may need a DC 13 Dexterity save.',
      className: 'danger'
    });
  }
  if (state.pumpStatus === 'Jammed') {
    effects.push({
      title: 'Bilge Pump Jammed',
      detail: 'Bilge pump actions are unavailable until Repair Bilge Pump is completed.',
      className: 'warn'
    });
  }
  if (state.netStatus === 'Tangled') {
    effects.push({
      title: 'Fishing Net Tangled',
      detail: 'Cast Fishing Net is unavailable until Reset Fishing Net is completed.',
      className: 'warn'
    });
  }
  if (!mastFunctional()) {
    effects.push({
      title: 'Mast Broken',
      detail:
        'Man Helm is automatic: no Helm check is made and the ship cannot make sail progress.',
      className: 'danger'
    });
  } else if (!rudderFunctional()) {
    effects.push({
      title: 'Rudder Broken',
      detail:
        'Man Helm is automatic: no Helm check is made and the ship randomly applies True Course, Drifting, Off Course, or Lost.',
      className: 'danger'
    });
  }
  return effects;
}

function activeWaterEffect() {
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

function conditionEffect(condition) {
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
      detail: `Gulls are swarming the ship. Characters may spend their action joining the fight to scare them off for 0 Labor. If not dispatched in 3 rounds, reduce Food by 0.5 days.${fogPackOfGullsText()} ${suffix}`,
      className: 'warn'
    },
    'Calm Seas': {
      title: 'Calm Seas',
      detail: `The helmsman recovers 1 Labor instead of gaining 1 while steering this turn. ${suffix}`,
      className: 'good'
    },
    'Floating Wreckage': {
      title: 'Floating Wreckage',
      detail: `Wreckage can be recovered this turn with a 1-Labor action and DC 12 Dexterity or Athletics check.${fogFloatingWreckageText()} ${suffix}`,
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

// Shows only checks that belong to the current phase; unresolved prompts block advancement.
function renderPendingChecks() {
  const box = q('pendingChecks');
  box.innerHTML = '';
  const pending = pendingPromptsForCurrentStep();
  if (!pending.length) {
    box.innerHTML = '<span class="pill good">No pending checks</span>';
    return;
  }
  pending.forEach((prompt) => {
    const card = document.createElement('div');
    card.className = [
      'prompt-card',
      safeClassTokens(prompt.type || 'manual'),
      safeClassTokens(prompt.emphasis || ''),
      promptRollClass(prompt)
    ]
      .filter(Boolean)
      .join(' ');
    const titleText = prompt.dc ? `DC ${h(prompt.dc)} ${h(prompt.title)}` : h(prompt.title);
    const actorText = prompt.character ? `${h(prompt.character)}: ` : '';
    const outcomeButtons = orderedPromptOutcomes(prompt.outcomes || [])
      .map(
        (outcome) =>
          `<button class="${safeClassTokens(outcome.className || '')}" data-action="resolve-prompt-outcome" data-prompt-id="${h(prompt.id)}" data-outcome-id="${h(outcome.id)}">${h(outcome.label)}</button>`
      )
      .join('');
    const defaultButtons =
      outcomeButtons ||
      (prompt.type === 'manual'
        ? `<button data-action="resolve-prompt" data-prompt-id="${h(prompt.id)}" data-result="manual">Done</button>`
        : `<button class="good" data-action="resolve-prompt" data-prompt-id="${h(prompt.id)}" data-result="success">Success</button>
        <button data-action="resolve-prompt" data-prompt-id="${h(prompt.id)}" data-result="manual">Manual / Done</button>
        <button class="danger" data-action="resolve-prompt" data-prompt-id="${h(prompt.id)}" data-result="failure">Failure</button>`);
    card.innerHTML = `<div class="prompt-title">${actorText}${titleText}</div>
      <div class="prompt-detail">${h(prompt.detail)}</div>
      <div class="actions">
        ${defaultButtons}
      </div>`;
    box.appendChild(card);
  });
}

// Prompt card borders communicate advantage/disadvantage without changing the underlying rules.
function promptRollClass(prompt) {
  const detail = String(prompt.detail || '').toLowerCase();
  if (detail.includes('disadvantage')) {
    if (
      detail.includes('canceled') ||
      detail.includes('cancelled') ||
      detail.includes('roll normally')
    )
      return '';
    return 'disadvantage';
  }
  if (detail.includes('advantage')) return 'advantage';
  return '';
}

function safeClassTokens(value) {
  return String(value || '')
    .split(/\s+/)
    .filter((token) => /^[a-z0-9_-]+$/i.test(token))
    .join(' ');
}

// Keeps success-style outcomes left and failure-style outcomes right.
function orderedPromptOutcomes(outcomes) {
  return [...outcomes].sort((left, right) => promptOutcomeRank(left) - promptOutcomeRank(right));
}

function promptOutcomeRank(outcome) {
  const text =
    `${outcome.id || ''} ${outcome.label || ''} ${outcome.className || ''}`.toLowerCase();
  if (
    text.includes('fail') ||
    text.includes('failure') ||
    text.includes('no success') ||
    text.includes('danger')
  )
    return 3;
  if (text.includes('success') || text.includes('recover') || text.includes('good')) return 1;
  return 2;
}

function renderConditions() {
  const div = q('conditions');
  div.innerHTML = '';
  if (!state.conditions.length) {
    div.innerHTML = '<span class="pill">None</span>';
    return;
  }
  state.conditions.forEach((c) => {
    const span = document.createElement('span');
    span.className = 'pill';
    span.textContent = `${c.name} (${c.turns})`;
    div.appendChild(span);
  });
}

// Phase filtering is what lets pre-action, action, and water prompts appear at the right time.
function pendingPrompts(phase = null) {
  return state.pendingChecks.filter((prompt) => {
    if (prompt.status === 'resolved') return false;
    if (!phase) return true;
    return promptPhase(prompt) === phase;
  });
}

function pendingPromptCount(phase = null) {
  return pendingPrompts(phase).length;
}

function promptPhase(prompt) {
  return prompt.phase || 'action';
}

function pendingPromptsForCurrentStep() {
  if (state.turnStep === 1 || state.turnStep === 2) return pendingPrompts('preAction');
  if (state.turnStep === 4) return pendingPrompts('action');
  if (state.turnStep === 5) return pendingPrompts('water');
  return pendingPrompts();
}
