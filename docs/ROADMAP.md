# Open Sea Tracker Roadmap

This roadmap tracks the current direction for the Open Sea Tracker project.

The project began as the Marrowwind voyage tracker for one campaign. The long-term goal is to turn it into a reusable browser-based encounter tracker for dangerous sea travel and other high-bookkeeping tabletop scenarios.

---

# Current Project Status

The project is a working MVP.

The core tracker can now be used at the table with a DM screen and a player-facing screen. It has automated tests, formatting checks, syntax checks, GitHub Actions CI, manual browser testing documentation, import/export support, save protection, a functional new-voyage setup flow, README screenshots, and GitHub Pages deployment.

---

# Completed Core Systems

- DM-facing tracker screen.
- Player-facing display screen.
- Browser `localStorage` saving.
- Export and import.
- Import validation and migration.
- Undo support.
- Turn-flow guidance.
- Open Sea Event handling.
- Scripted scene turns.
- Crew action assignment.
- Required checks and saves.
- Water ingress tracking.
- Course Meter and travel tracking.
- Repair-material blocking for repair actions.
- `Salvage Lumber` action for recovering repair supplies.
- Player knowledge and hidden information.
- Player-safe state publishing.
- Player view auto-sync through browser storage.
- Activity log.
- Automated Node test suite.
- Prettier formatting.
- Syntax checks.
- GitHub Actions CI.
- Manual browser testing checklist.
- README screenshots.
- GitHub Pages deployment.
- Root `index.html` redirect/loading page.
- DM tracker `Open Player View` link after tracker launch.

---

# Completed Setup Work

The landing and setup flow has been completed through Stage 3.

## Stage 1: Ship Name Foundation — Complete

Completed items:

- Added `shipName` to tracker state.
- Added default ship name: `The Marrowwind`.
- Added migration support for old saves missing `shipName`.
- Added validation for imported ship names.
- Included `shipName` in exported saves.
- Included `shipName` in published player state.
- Rendered ship name on the DM screen.
- Rendered ship name on the player screen.
- Added player-view fallback for older player snapshots.

## Stage 2: Setup Mode Shell — Complete

Completed items:

- Added landing/setup/tracker app modes.
- Changed `Start a New Voyage` to open setup mode.
- Added temporary setup draft state.
- Added setup screen shell.
- Added voyage preset display.
- Added ship-name setup field.
- Added crew-size setup field.
- Added active crew-name setup fields.
- Added background/proficiency trait checkboxes.
- Added `Back to Landing`.
- Added `Reset Setup Defaults`.
- Preserved existing saves when opening setup.
- Preserved existing saves when editing setup.
- Preserved existing saves when backing out of setup.

## Stage 2.5: Setup File Split — Complete

Completed items:

- Added `js/tracker_render_setup.js` for landing/setup rendering.
- Added `js/tracker_setup.js` for setup-mode behavior.
- Kept main tracker rendering in `js/tracker_render.js`.
- Kept persistence behavior in `js/tracker_persistence.js`.
- Updated browser script order.
- Updated syntax checks.
- Updated test harness loading.

## Stage 3: Setup Validation and Start Voyage — Complete

Completed items:

- Added setup validation for ship name.
- Reused active crew-name validation.
- Blocked invalid setup from starting.
- Blocked invalid setup from saving.
- Blocked invalid setup from publishing player state.
- Required active crew names to be unique after trimming, case-insensitive.
- Allowed inactive crew rows to be ignored when crew size is smaller.
- Enabled `Start Voyage` for valid setup.
- Created full tracker state from setup draft.
- Applied configured ship name.
- Applied configured crew size.
- Applied configured crew names.
- Applied configured background/proficiency traits.
- Saved valid setup-created voyage to `localStorage`.
- Published valid setup-created player state.
- Entered tracker mode after successful setup.
- Logged new voyage creation.
- Added existing-save overwrite confirmation.
- Preserved old save when overwrite confirmation is cancelled.

---

# Immediate Priorities

These are the next practical steps before larger feature systems.

## 1. Focused Manual Browser Testing

Status: In Progress

Use `docs/MANUAL_TESTING.md` to test the current app in a real browser.

Focus areas:

- Landing screen.
- New voyage setup.
- Setup validation.
- Existing-save overwrite protection.
- Resume current voyage.
- Import saved voyage.
- DM tracker load.
- Player view sync.
- DM tracker `Open Player View` link.
- Repair-material blocking.
- `Salvage Lumber` above/below-deck behavior.
- GitHub Pages hosted behavior.
- Water visibility rules.
- Navigate reveal behavior.
- Scripted scene turn behavior.
- Export/import.
- Invalid import rejection.
- Prompt escaping.
- Layout smoke test.

Reason:

Automated tests are strong, but browser UI behavior, layout, `localStorage` behavior, hosted paths, and second-screen sync still need real-browser verification.

## 2. Fix Manual Test Failures

Status: As Needed

Only fix issues that surface during manual testing.

Do not add new feature work during a bug-fix pass unless the fix clearly requires it.

## 3. Keep Documentation Current

Status: Ongoing

Review old scratch/staging files before each new feature phase and remove or archive anything that is no longer a source of truth.

Recently completed:

- Removed obsolete `docs/todo.txt` after preserving the skeleton-helper backlog in this roadmap.
- Pruned low-risk stale code left by earlier UI iterations.

Reason:

The roadmap should be the main planning document. Loose scratch notes should not remain the source of truth.

---

# Next Feature Phase: Demo and First-Time Use

The setup flow works. The next work should make the live app easy to try without requiring someone to configure a real voyage first.

## 1. Demo Mode: Temporary No-Save Sandbox

Status: Next Feature

Goal:

Add a `Load Demo Voyage` option that lets someone try the tracker quickly without replacing a real saved voyage.

Recommended first version:

- Add `Load Demo Voyage` to the landing screen.
- Use the existing Marrowwind/default initial state.
- Enter tracker mode immediately.
- Publish player-safe state so the player screen works.
- Do not write to the normal saved-voyage slot automatically.
- Mark the tracker state as demo mode.
- Show a visible DM-side banner: `Demo Mode — changes are temporary unless saved.`
- Allow export.
- Decide whether manual `Save` should convert the demo into a normal saved voyage after confirmation.

Important behavior:

- Loading a demo should not overwrite an existing save.
- Loading a demo should not require overwrite confirmation because it should not touch the normal save slot.
- Refreshing should not be treated as a reliable way to preserve the demo unless the DM explicitly saves or exports it.

Reason:

This makes the GitHub Pages version useful immediately and gives a fast way to test the UI.

## 2. Demo Save Conversion

Status: Follow-Up to Demo Mode

Goal:

Decide what happens if the DM clicks `Save` while in demo mode.

Recommended behavior:

- Prompt: `Save this demo voyage as your current saved voyage?`
- If confirmed, write to the normal save slot.
- Clear `demoMode`.
- Log that the demo was saved as a real voyage.
- If cancelled, remain in demo mode and do not overwrite the current save.

Reason:

Demo mode should be safe by default but not a dead end.

## 3. Starting Presets

Status: Not Started

Goal:

Allow the DM to choose from predefined starting configurations.

Possible first presets:

- Marrowwind Voyage.
- Open Sea Default.
- Short Demo Voyage.
- Damaged Ship Start.
- Low-Supply Survival Start.

Each preset could define:

- default ship name.
- default crew size.
- default crew names.
- default crew traits.
- starting travel distance.
- starting water level.
- starting supplies.
- starting repair materials.
- starting Course Meter.
- scripted event table.
- Open Sea Event table.

Keep this limited at first. Do not build custom event-table editing during the first preset pass.

## 4. Setup Polish

Status: Not Started

Possible improvements:

- clearer setup validation messages.
- better visual grouping of background/proficiency traits.
- short help text explaining which traits affect which actions.
- optional collapse/expand for advanced fields.

Do not add advanced mechanical setup yet unless presets require it.

---

# Next Feature Phase: Event Table Improvements

The current Open Sea Event system works, but it is still tied closely to the current voyage implementation.

## 1. Move Open Sea Events Into Table Data

Status: Not Started

Goal:

Represent Open Sea Events as structured data rather than hardcoded control flow where possible.

Possible event data fields:

- roll range.
- event name.
- DM-facing description.
- player-facing description, if needed.
- whether the event requires confirmation.
- whether the event creates prompts.
- whether the event modifies state.
- whether the event blocks normal turn flow.

Reason:

This is the foundation for reusable event tables, presets, and future custom scenarios.

## 2. Built-In Event Table Selector

Status: Not Started

Goal:

Allow the DM to choose a built-in event table during setup or preset selection.

Possible built-in tables:

- Marrowwind Open Sea.
- Generic Open Sea.
- Calm Coastal Waters.
- Stormy Waters.

Keep the first version simple. Do not build a custom event-table editor yet.

## 3. Custom Event Table Editor

Status: Future

Goal:

Allow a DM to define their own event table.

Possible future fields:

- d20 range.
- event title.
- event text.
- mechanical tags.
- prompt creation.
- state effects.

This is likely a larger publishability feature, not a near-term cleanup task.

---

# Next Feature Phase: Player View and Presentation

The player view works. The next presentation work should make it clearer and more atmospheric without making the tracker distracting.

## 1. Time-of-Day Visual Themes

Status: Not Started

Goal:

Change the player view's visual atmosphere based on the current time of day or voyage phase.

Possible phases:

- morning.
- afternoon.
- evening.
- night.
- storm or scripted crisis.

Implementation direction:

- Add a computed time phase to the published player state.
- Add a class or data attribute to the player page, such as `data-time-phase="night"`.
- Use CSS to adjust background, panel glow, and accent colors.
- Keep DM screen styling mostly stable.

Reason:

This creates a visual sense of passage and helps the player view feel more alive.

## 2. Turn-Advance Overlay

Status: Not Started

Goal:

When the DM advances the turn, the player view should briefly show that time has passed.

Possible behavior:

- Show a short overlay on the player view.
- Display something like `Day 1, Turn 1 → Day 1, Turn 2`.
- Optionally include a simple clock/wheel animation.
- Keep the overlay short and non-blocking.
- Do not cover the DM screen with an animation.

Implementation direction:

- Publish previous and current turn labels or a `lastTurnAdvanceId`.
- Let `player_view.js` detect turn changes and trigger the overlay.
- Add `prefers-reduced-motion` support to reduce or skip animation.

Reason:

Turn advancement is currently functional but visually quiet. A short player-facing transition would improve table feel.

## 3. Player View Polish

Status: Not Started

Possible improvements:

- stronger ship-name header.
- clearer travel/water/supply grouping.
- better active-effects layout.
- improved crew status cards.
- more readable projection mode.
- small visual indicators for hidden vs known information.

## 4. Value-Change Feedback

Status: Future

Possible improvements:

- subtle visual flash when water changes.
- subtle visual flash when travel changes.
- subtle visual flash when supplies change.
- log emphasis for major turn results.

Avoid heavy animations. The tracker should remain readable and stable.

## 5. Ship Diagram

Status: Future

Goal:

Add a simple visual ship status diagram.

Possible displayed systems:

- mast.
- rudder.
- pump.
- leaks.
- water level.
- cargo hold threshold.

This should remain simple and should not block more important usability work.

---

# Next Feature Phase: Save and Session Management

The current save/export/import system works, but longer use would benefit from better save management.

## 1. Save Slots

Status: Not Started

Goal:

Allow multiple browser saves instead of one current voyage.

Possible behavior:

- named save slots.
- save timestamp.
- ship name shown in slot list.
- resume selected slot.
- delete slot.
- export selected slot.

This should wait until the current single-save setup flow and demo behavior are fully tested.

## 2. Structured Turn History

Status: Future

Goal:

Improve the activity log into a clearer turn history.

Possible behavior:

- grouped by day/turn.
- actions confirmed.
- event rolled.
- checks resolved.
- water update.
- travel update.
- supplies update.

## 3. Copy Recap Button

Status: Future

Goal:

Generate a short plain-text recap from the latest turn or session segment.

Possible uses:

- DM notes.
- Discord update.
- session recap drafting.

---

# Current Known Feature Backlog

## Temporary Skeleton Helpers

Status: Backlog

Goal:

Represent temporary helper crew or skeleton crew members if the scenario calls for them.

Open questions:

- Do skeleton helpers take normal actions?
- Do they have labor/exhaustion?
- Do they appear on the player screen?
- Are they controlled by the DM only?
- Are they temporary effects instead of crew rows?

This should not be built until the desired table behavior is clear.

---

# Publishable Tool Preparation

These tasks matter if the project moves from personal tool to public tool.

## 1. Rename Public Identity

Status: Future

Current identity:

- Marrowwind Open Sea Tracker.

Possible broader identity:

- Open Sea Encounter Tracker.
- Open Sea Voyage Tracker.
- Dangerous Voyage Tracker.

Reason:

The current name is campaign-specific. A public tool should sound reusable.

## 2. Scenario and Rules Documentation

Status: Future

Goal:

Document the rules enough that another DM can use the tracker without knowing the original Marrowwind scenario.

Possible docs:

- basic voyage procedure.
- crew actions reference.
- water/flooding rules.
- travel/Course Meter rules.
- player knowledge rules.
- event table explanation.
- setup/preset explanation.

## 3. Product Packaging and Demo Strategy

Status: Future

Goal:

Plan how a future purchasable version would differ from a free demo.

Possible direction:

- Free demo build includes Demo Mode only.
- Full version unlocks setup, save, export/import, presets, and custom tables.
- Demo build intentionally cannot save.
- In a public demo, full-version buttons could be visible but disabled with purchase messaging.
- Paid version should not rely only on disabled client-side buttons for real protection.

Possible distribution models:

- free public GitHub Pages demo plus paid download.
- hosted paid version with account/license check.
- separate demo build and full build.
- desktop/package download through a storefront.

This is a long-term product decision, not a near-term code task.

## 4. Legal/Product Cleanup

Status: Future

If the project becomes public or monetized:

- avoid official D&D branding.
- avoid copied rules text.
- avoid proprietary setting names.
- avoid non-original protected content.
- keep the public framing as an original 5e-compatible encounter tool unless a different license path is chosen.

---

# Not Planned Yet

These are valid ideas, but they should not be built until the current roadmap items are more stable.

- Full scenario builder.
- Custom action-list editor.
- Custom scripted-event editor.
- Custom flooding formula editor.
- Custom ship-system editor.
- Multiplayer/network sync.
- Account system.
- Cloud saves.
- Mobile-first rewrite.
- Framework rewrite.
- Full automated browser testing suite.

---

# Recommended Next Order

Use this order unless a table need forces something else:

1. Finish focused manual browser testing.
2. Fix any manual test failures.
3. Keep docs current as features and decisions change.
4. Add temporary no-save Demo Mode.
5. Add demo save-conversion behavior if needed.
6. Add starting presets.
7. Move Open Sea Events into structured table data.
8. Add built-in event table selector.
9. Add player-view time-of-day visual themes.
10. Add player-view turn-advance overlay.
11. Improve player view layout/presentation.
12. Add save slots.
13. Improve structured turn history.
14. Add scenario/rules documentation.
15. Plan product packaging and public identity.

---

# Maintenance Rule

Before starting a new feature phase:

1. Run `npm run ci`.
2. Check that GitHub Actions passes.
3. Run the relevant parts of `docs/MANUAL_TESTING.md`.
4. Update this roadmap if the feature changes the plan.
