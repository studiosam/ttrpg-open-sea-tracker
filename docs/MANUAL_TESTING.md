# Manual Testing Checklist

This checklist covers browser behavior that the automated Node tests do not fully prove.

Use this checklist after changes that affect:

- Rendering
- Buttons or event handlers
- Turn flow
- Action assignment
- Player view publishing
- Import/export
- localStorage
- Setup/start state
- Demo Mode
- Major styling or layout

Do not use this as an exhaustive QA document. It is a browser smoke test. It should stay practical enough to run in about 5 to 10 minutes for a normal change, with the setup sections added when startup behavior changes.

---

# How to Use This Checklist

Before starting, run:

```powershell
npm run ci
```

The command should pass formatting, syntax checks, and automated tests.

Use the checkboxes while testing. If you mark items complete in VS Code, do not commit the checked-off version unless you intentionally want to save a test record. The repo version should normally stay blank.

---

# Test Environment

Use a normal desktop browser.

Recommended browsers:

- Chrome
- Edge
- Firefox

Recommended local setup:

- Open the DM screen: `open_sea_tracker.html`
- Open the player screen: `player_view.html`
- Open both pages in the same browser profile so localStorage sync works.
- Open DevTools Console on both pages.

If using Live Server, browser warnings from Live Server are acceptable as long as they do not reference project files or break the app.

---

# Serious Console Errors

These are acceptable:

- Browser or Live Server warnings that do not reference project files.
- Layout or style warnings that do not break behavior.

These are not acceptable:

- `SyntaxError`
- `ReferenceError`
- `TypeError`
- `Cannot read properties of null`
- Missing function errors
- Missing script errors
- Failed loads for project files such as:
  - `action_metadata.js`
  - `tracker_state.js`
  - `tracker_render_setup.js`
  - `tracker_render.js`
  - `tracker_gameplay.js`
  - `tracker_persistence.js`
  - `tracker_setup.js`
  - `tracker.js`
  - `player_view.js`
  - `styles.css`

---

# 1. Automated Baseline

Run this before opening the browser:

```powershell
npm run ci
```

Confirm:

- [ ] Prettier formatting check passes.
- [ ] JavaScript syntax check passes.
- [ ] Automated tests pass.
- [ ] No command fails before browser testing begins.

---

# 2. Landing Screen Initial Load

Open `open_sea_tracker.html`.

On initial load, the DM page should show the landing screen before the tracker screen.

Confirm:

- [ ] The page loads instead of showing a blank screen.
- [ ] The favicon appears in the browser tab.
- [ ] The landing screen is visible.
- [ ] `Start a New Voyage` is visible and enabled.
- [ ] `Load Demo Voyage` is visible and enabled.
- [ ] `Import Saved Voyage` is visible and enabled.
- [ ] `Resume Current Voyage` is visible.
- [ ] If no saved voyage exists in this browser profile, `Resume Current Voyage` is disabled or clearly unavailable.
- [ ] If a saved voyage exists in this browser profile, `Resume Current Voyage` is enabled.
- [ ] The tracker screen is not shown until a voyage is started, resumed, or imported.
- [ ] The DevTools Console shows no serious console errors.

Optional hosted check:

- [ ] If testing GitHub Pages, open the root site URL and confirm it redirects to the DM tracker.
- [ ] Confirm the root redirect page does not show broken styles or missing project-file errors.

---

# 3. Demo Mode No-Save Sandbox

Use this section to confirm that Demo Mode lets a visitor try the app without replacing a real saved voyage.

## Demo Load

From the landing screen:

- [ ] Click `Load Demo Voyage`.
- [ ] Confirm the app enters tracker mode immediately without opening setup.
- [ ] Confirm a visible DM-side Demo Mode banner appears.
- [ ] Confirm the banner text explains that changes are temporary unless saved.
- [ ] Confirm the default Marrowwind ship name appears.
- [ ] Confirm the default Marrowwind crew appear.
- [ ] Confirm the activity log records that the demo voyage was loaded.
- [ ] Confirm the DevTools Console shows no serious console errors.

Expected behavior:

- Demo Mode should not require setup.
- Demo Mode should not ask for overwrite confirmation when loading.
- Demo Mode should not save to the normal saved-voyage slot automatically.

## Demo Player View

With the demo loaded on the DM screen:

- [ ] Click `Open Player View`.
- [ ] Confirm `player_view.html` opens in a new tab.
- [ ] Confirm the player view receives demo data.
- [ ] Confirm the player view shows the default ship name and crew.
- [ ] Confirm player-hidden values remain hidden according to the normal visibility rules.
- [ ] Confirm the DM-side Demo Mode banner does not appear on the player view.

## Demo Does Not Overwrite Existing Save

Use this section when a real saved voyage already exists.

Before loading the demo:

- [ ] Create or resume a real saved voyage.
- [ ] Note the ship name, day, turn, and at least one crew name.
- [ ] Return to the landing screen or reload the DM page.

Then:

- [ ] Click `Load Demo Voyage`.
- [ ] Confirm the demo loads.
- [ ] Do not click `Save`.
- [ ] Return to the landing screen or reload the DM page.
- [ ] Click `Resume Current Voyage`.
- [ ] Confirm the original real saved voyage resumes.
- [ ] Confirm the real saved voyage was not replaced by the demo.

Expected behavior:

- Loading demo should not alter the real saved voyage.
- `Resume Current Voyage` should ignore an unsaved demo and resume the real saved voyage.

## Demo Save Conversion

With Demo Mode loaded:

- [ ] Click `Save`.
- [ ] Confirm a warning appears before converting the demo into the current saved voyage.
- [ ] Cancel the warning.
- [ ] Confirm the app remains in Demo Mode.
- [ ] Confirm the Demo Mode banner remains visible.
- [ ] Confirm the existing real save was not overwritten.
- [ ] Click `Save` again.
- [ ] Confirm the warning.
- [ ] Confirm the demo is saved as the current real voyage.
- [ ] Confirm the Demo Mode banner disappears.
- [ ] Confirm the activity log records that the demo was saved as a real voyage.
- [ ] Return to landing or reload the DM page.
- [ ] Click `Resume Current Voyage`.
- [ ] Confirm the saved converted voyage resumes.

## Demo Export and Import

With Demo Mode loaded:

- [ ] Click `Export`.
- [ ] Confirm a JSON file downloads.
- [ ] Reset or return to landing.
- [ ] Import the exported demo JSON.
- [ ] Confirm the import succeeds.
- [ ] Confirm imported state is treated as a normal usable voyage.
- [ ] Confirm the imported state does not corrupt existing tracker behavior.

---

# 4. Start a New Voyage Setup Flow

From the landing screen:

- [ ] Click `Start a New Voyage`.
- [ ] Confirm the setup screen appears.
- [ ] Confirm the tracker screen has not opened yet.
- [ ] Confirm the setup screen shows the voyage preset.
- [ ] Confirm the setup screen shows the default ship name.
- [ ] Confirm the setup screen shows crew size.
- [ ] Confirm the setup screen shows active crew name fields.
- [ ] Confirm the setup screen shows background/proficiency trait checkboxes.
- [ ] Confirm the default crew names appear.
- [ ] Confirm the default trait selections appear.
- [ ] Confirm `Start Voyage` is enabled when setup is valid.
- [ ] Confirm the DevTools Console shows no serious console errors.

Expected behavior:

- Opening setup does not save a new voyage.
- Editing setup fields does not publish to the player screen.
- Existing saved voyages are not replaced by opening setup.

---

# 5. Setup Validation

On the setup screen:

- [ ] Clear the ship name.
- [ ] Confirm `Start Voyage` is disabled or blocked.
- [ ] Confirm a ship-name error appears.
- [ ] Restore a valid ship name.
- [ ] Try to paste or type a ship name longer than the field allows.
- [ ] Confirm the ship-name field prevents extra characters or truncates to the allowed limit.
- [ ] Confirm setup remains usable and no misleading ship-name length error appears.
- [ ] Restore a valid ship name.
- [ ] Clear an active crew name.
- [ ] Confirm `Start Voyage` is disabled or blocked.
- [ ] Confirm a crew-name error appears.
- [ ] Restore the crew name.
- [ ] Try to paste or type an active crew name longer than the field allows.
- [ ] Confirm the crew-name field prevents extra characters or truncates to the allowed limit.
- [ ] Confirm setup remains usable and no misleading crew-name length error appears.
- [ ] Restore the crew name.
- [ ] Give two active crew members the same name.
- [ ] Confirm duplicate crew names are blocked.
- [ ] Confirm duplicate detection is case-insensitive, such as `Tommy` and `tommy`.
- [ ] Restore unique crew names.
- [ ] Reduce crew size if the UI supports it.
- [ ] Confirm inactive crew rows do not block validation.

Expected behavior:

- Invalid setup stays on the setup screen.
- Invalid setup does not save to localStorage.
- Invalid setup does not publish player state.
- Invalid setup does not enter tracker mode.

---

# 6. Setup Back and Reset Save Protection

Use this section when a saved voyage already exists.

From the landing screen:

- [ ] Click `Start a New Voyage`.
- [ ] Change the ship name.
- [ ] Change at least one crew name.
- [ ] Toggle at least one background/proficiency checkbox.
- [ ] Click `Back to Landing`.
- [ ] Click `Resume Current Voyage`.
- [ ] Confirm the previous saved voyage is still intact.
- [ ] Return to the landing screen or reload the DM page.
- [ ] Click `Start a New Voyage` again.
- [ ] Change setup fields again.
- [ ] Click `Reset Setup Defaults`.
- [ ] Confirm the setup form returns to defaults.
- [ ] Click `Back to Landing`.
- [ ] Click `Resume Current Voyage`.
- [ ] Confirm the saved voyage was not overwritten by reset.

Expected behavior:

- `Back to Landing` does not overwrite the current save.
- `Reset Setup Defaults` changes only the temporary setup draft.
- The existing saved voyage stays intact until `Start Voyage` is completed and confirmed.

---

# 7. Successful Start Voyage

From the setup screen:

- [ ] Enter a custom ship name.
- [ ] Change at least one active crew name.
- [ ] Change at least one background/proficiency checkbox.
- [ ] Click `Start Voyage`.
- [ ] If an overwrite confirmation appears, confirm it.
- [ ] Confirm the app enters tracker mode.
- [ ] Confirm the custom ship name appears on the DM screen.
- [ ] Confirm the active crew names appear on the DM screen.
- [ ] Confirm the activity log records that a new voyage was started.
- [ ] Open or refresh `player_view.html`.
- [ ] Confirm the custom ship name appears on the player screen.
- [ ] Confirm the active crew names appear on the player screen.
- [ ] Confirm hidden player information remains hidden.

Optional trait check:

- [ ] Assign an action affected by a changed trait, such as Helm, Navigate, or Fishing.
- [ ] Confirm the relevant prompt text reflects the selected background/proficiency advantage source.

---

# 8. Existing Save Overwrite Protection

Create and save a voyage first.

Then:

- [ ] Reload the DM page.
- [ ] Click `Start a New Voyage`.
- [ ] Change the setup ship name.
- [ ] Click `Start Voyage`.
- [ ] Confirm an overwrite warning appears.
- [ ] Cancel the warning.
- [ ] Confirm the app remains on the setup screen.
- [ ] Click `Back to Landing`.
- [ ] Click `Resume Current Voyage`.
- [ ] Confirm the old saved voyage is still intact.
- [ ] Repeat the setup flow.
- [ ] Click `Start Voyage`.
- [ ] Confirm the overwrite warning.
- [ ] Confirm the new configured voyage replaces the old save.

Expected behavior:

- Cancelling overwrite does not change localStorage.
- Cancelling overwrite does not change the published player state.
- Confirming overwrite replaces the saved voyage with the configured setup-created voyage.

---

# 9. Player Screen Initial Load

Open `player_view.html` in the same browser profile after a voyage has been started, resumed, or imported.

Confirm:

- [ ] The page loads instead of showing a blank screen.
- [ ] The favicon appears in the browser tab.
- [ ] The player-facing layout is visible.
- [ ] The configured ship name is visible.
- [ ] The voyage or travel section is visible.
- [ ] The ship condition section is visible.
- [ ] The water display is visible.
- [ ] The systems display is visible.
- [ ] The supplies display is visible.
- [ ] The active crew names are visible.
- [ ] The DevTools Console shows no serious console errors.

The player screen does not need to show every DM value. Hidden player information should stay hidden until revealed by the rules.

---

# 10. Resume Current Voyage

Use this section after a voyage has been successfully started and saved.

On the DM screen:

- [ ] Reload `open_sea_tracker.html`.
- [ ] Confirm the landing screen appears.
- [ ] Confirm `Resume Current Voyage` is enabled.
- [ ] Click `Resume Current Voyage`.
- [ ] Confirm the tracker screen opens.
- [ ] Confirm the saved ship name appears.
- [ ] Confirm the saved crew names appear.
- [ ] Confirm the saved voyage state appears intact.
- [ ] Confirm the DevTools Console shows no serious console errors.

On the player screen:

- [ ] Refresh `player_view.html`.
- [ ] Confirm the player view still shows the saved player-facing voyage state.

---

# 11. Reset to a Known Baseline

Use this after entering tracker mode.

On the DM screen:

- [ ] Click `Reset`.
- [ ] Confirm the reset prompt appears.
- [ ] Confirm the reset.

After reset, confirm:

- [ ] The tracker shows Day 1, Turn 1.
- [ ] Travel remaining is at the default starting value.
- [ ] Course Meter is at the default starting value.
- [ ] Water Level is at the default starting value.
- [ ] Minimum Ingress is at the default starting value.
- [ ] Active Leaks are at the default starting value.
- [ ] Food is at the default starting value.
- [ ] Fresh Water is at the default starting value.
- [ ] Repair Supplies are at the default starting value.
- [ ] Mast status is functional.
- [ ] Rudder status is functional.
- [ ] Pump status is functional.
- [ ] Net status is usable.
- [ ] Rigging status is intact.
- [ ] Crew names appear correctly.
- [ ] The log records the reset or current state cleanly.

On the player screen:

- [ ] Confirm the player view updates after reset.
- [ ] Confirm player-hidden values remain hidden if they should not be known yet.
- [ ] Confirm no DM-only values are exposed incorrectly.

---

# 12. Reach the Action-Assignment Phase

This section checks that the normal turn flow can reach the point where crew actions are assigned.

On the DM screen:

- [ ] Click `Check Scripted Events`.
- [ ] If a scripted prompt appears, confirm it displays cleanly.
- [ ] Resolve or acknowledge any required scripted prompt if the UI requires it.
- [ ] If an Open Sea Event is required, click `Roll Open Sea Event`.
- [ ] If an Open Sea Event appears, confirm the event title and description display cleanly.
- [ ] Click `Confirm Event` when available.
- [ ] Continue until the app reaches the action-assignment phase.

At the action-assignment phase, confirm:

- [ ] Action assignment controls are now visible for available crew.
- [ ] Each available crew member has an action selector or action control.
- [ ] The available action list appears readable.
- [ ] Disabled or unavailable actions are handled clearly.
- [ ] The app does not show duplicate action controls for the same crew member.

---

# 13. Complete a Simple Idle Turn

This section confirms that the basic turn loop works without special actions.

On the DM screen:

- [ ] Click `Set Unset to Idle`.
- [ ] Confirm every available crew member now has an assigned action.
- [ ] Click `Confirm All Available`.
- [ ] Confirm the app moves past action assignment.
- [ ] If any prompts appear, resolve them or confirm that they are expected.
- [ ] Click `Apply Water Formula` when available.
- [ ] Confirm water updates or remains stable according to the displayed values.
- [ ] Click `Advance Turn`.
- [ ] Confirm the tracker advances to the next turn.
- [ ] Confirm the log records the turn activity.

On the player screen:

- [ ] Confirm the player view updates after the turn advances.
- [ ] Confirm crew action/status information changes appropriately.
- [ ] Confirm hidden information remains hidden unless revealed.

---

# 14. Navigate Action Test

This section checks the navigation prompt, DC display, Course Meter behavior, and player Course State and travel reveal.

On the DM screen, proceed to an action-assignment phase.

Then:

- [ ] Assign one crew member to `Navigate / Study Map` or the equivalent navigation action.
- [ ] Set all other unset crew to Idle.
- [ ] Confirm all available crew actions.
- [ ] Confirm a Navigate prompt appears.
- [ ] Confirm the Navigate prompt shows a visible DC.
- [ ] Confirm the prompt text reflects Navigator's Tools or Cartographer's Tools advantage when applicable.
- [ ] Resolve the Navigate prompt with a success result.
- [ ] Confirm the Course Meter changes appropriately.
- [ ] Confirm the Course State updates if the result changes it.
- [ ] Confirm the log records the Navigate result.
- [ ] Apply the water formula if required.
- [ ] Advance the turn.

On the player screen:

- [ ] Confirm Course State becomes visible after Navigate resolves.
- [ ] Confirm the displayed Course State matches the DM result.
- [ ] Confirm Travel Remaining is visible and rounded to the nearest half day.
- [ ] Confirm unrelated hidden values remain hidden.

---

# 15. Helm Action Test

This section checks travel progress from the Helm action.

On the DM screen, proceed to an action-assignment phase.

Then:

- [ ] Assign one crew member to `Man Helm` or the equivalent helm action.
- [ ] Set all other unset crew to Idle.
- [ ] Confirm all available crew actions.
- [ ] Confirm a Helm prompt appears if mast and rudder are functional.
- [ ] Confirm the prompt shows a visible DC.
- [ ] Confirm the prompt text reflects Sailor/Pirate or Water Vehicles advantage when applicable.
- [ ] Resolve the prompt with a success result.
- [ ] Confirm travel changes according to Course State.
- [ ] Confirm the log records the Helm result.

Broken mast behavior:

- [ ] Break the mast using the DM controls.
- [ ] Assign `Man Helm`.
- [ ] Confirm no normal Helm check appears.
- [ ] Confirm no normal travel progress is applied.
- [ ] Confirm the log explains the broken mast behavior.

Broken rudder behavior:

- [ ] Repair or restore the mast.
- [ ] Break the rudder.
- [ ] Assign `Man Helm`.
- [ ] Confirm no normal Helm check appears.
- [ ] Confirm random movement behavior is applied.
- [ ] Confirm the log explains the broken rudder behavior.

---

# 16. Bilge Rod and Player Knowledge

On the DM screen:

- [ ] Set Water Level below Cargo Hold if needed.
- [ ] Confirm the player screen does not show the exact below-cargo water value before reveal.
- [ ] Assign one crew member to examine the Bilge Sounding Rod.
- [ ] Confirm all actions.
- [ ] Confirm the Bilge Rod prompt appears.
- [ ] Confirm success reveals Water Level and Total Ingress.
- [ ] Confirm failure reveals Water Level only.
- [ ] Resolve the prompt.

On the player screen:

- [ ] Confirm Water Level appears after the Bilge Rod reveals it.
- [ ] Confirm Total Ingress only appears when the rules say it should.
- [ ] Confirm below-cargo water is hidden before it is revealed.
- [ ] Confirm water at or above Cargo Hold becomes automatically visible.

---

# 17. Two-Person and Group Actions

On the DM screen:

- [ ] Assign only one crew member to a two-person/group action, such as cooperative pumping or net-related work.
- [ ] Confirm the app prevents or warns against invalid group assignment.
- [ ] Assign the correct number of crew members to the group action.
- [ ] Confirm the action.
- [ ] Confirm only one shared group prompt or work item is created.
- [ ] Resolve the prompt or complete the work.
- [ ] Confirm the log records the group action correctly.

On the player screen:

- [ ] Confirm participating crew display the correct current action.
- [ ] Confirm turns remaining displays correctly for ongoing work.

---

# 18. Fishing Trait Check

Use this section if setup background/proficiency changes touched Fisherman behavior.

On the setup screen before starting a voyage:

- [ ] Mark one active crew member as having the Fisherman background.
- [ ] Start the voyage.

On the DM screen:

- [ ] Proceed to an action-assignment phase.
- [ ] Assign that crew member to `Cast Fishing Net`, `Harpoon Fishing`, or the equivalent fishing action.
- [ ] Confirm all actions.
- [ ] Confirm the fishing prompt text reflects Fisherman advantage.
- [ ] Resolve the prompt.
- [ ] Confirm the log records the fishing result cleanly.

---

# 19. Water Update

On the DM screen:

- [ ] Set a known combination of Minimum Ingress, Active Leaks, Pumping, and Bucket Brigade.
- [ ] Click `Apply Water Formula`.
- [ ] Confirm Water Level changes according to the formula.
- [ ] Confirm water does not update twice in the same turn unless intentionally reset.
- [ ] Confirm the log explains the water update.
- [ ] Confirm water threshold prompts appear when appropriate.

On the player screen:

- [ ] Confirm Water Level visibility follows player knowledge rules.
- [ ] Confirm Total Ingress visibility follows player knowledge rules.
- [ ] Confirm water severity display updates.

---

# 20. Supplies and Inventory Actions

On the DM screen:

- [ ] Assign a crew member to inventory food.
- [ ] Complete the action.
- [ ] Confirm food becomes known to players.
- [ ] Repeat with fresh water.
- [ ] Repeat with repair supplies.
- [ ] Confirm each inventory action logs correctly.

On the player screen:

- [ ] Confirm revealed supplies are shown.
- [ ] Confirm unrevealed supplies remain hidden.

---

# 21. Scripted Scene Turn

This section checks that scripted scene turns interrupt normal turn flow safely.

On the DM screen:

- [ ] Set the tracker to a scripted scene turn, such as Day 1 Turn 8.
- [ ] Click `Check Scripted Events`.
- [ ] Confirm the scripted event appears.
- [ ] Confirm Open Sea Event rolling is blocked if the scripted event blocks it.
- [ ] Confirm the scripted event text displays cleanly.
- [ ] Click `Force All Idle for Scene`.
- [ ] Confirm all crew are forced to Idle.
- [ ] Confirm pending action prompts are removed.
- [ ] Confirm ongoing work is preserved and does not tick during the scripted scene turn.
- [ ] Advance the turn.
- [ ] Confirm normal flow resumes afterward.

On the player screen:

- [ ] Confirm player-facing state updates cleanly after the scripted scene turn.
- [ ] Confirm no broken or duplicated crew actions appear.

---

# 22. Export and Import

## Valid Export/Import

On the DM screen:

- [ ] Export the current state.
- [ ] Confirm a JSON file downloads.
- [ ] Reset the tracker or start another voyage.
- [ ] Import the exported JSON file.
- [ ] Confirm the imported state restores correctly.
- [ ] Confirm the imported ship name restores correctly.
- [ ] Confirm the imported crew names restore correctly.
- [ ] Confirm the log records the import.
- [ ] Confirm the player screen updates after import.

## Invalid Import

Create a bad JSON file such as:

```json
{
  "day": -1,
  "turn": 1,
  "crew": []
}
```

Then:

- [ ] Try to import the bad file.
- [ ] Confirm the import is rejected.
- [ ] Confirm an error message appears.
- [ ] Confirm the current tracker state is not damaged.
- [ ] Confirm the app still works after the failed import.

---

# 23. Prompt Escaping

This checks that imported or manually created prompt text is displayed safely.

Use a test prompt or import state containing text like:

```html
<img src=x onerror=alert('bad')> <b>test</b>
```

Then:

- [ ] Confirm the text displays as literal text.
- [ ] Confirm no alert appears.
- [ ] Confirm the browser does not render the fake HTML as real HTML.
- [ ] Confirm prompt buttons still work.

---

# 24. Player View Sync

With both pages open:

- [ ] Change a visible ship system on the DM screen.
- [ ] Confirm the player view updates.
- [ ] Change water level on the DM screen.
- [ ] Confirm the player view updates according to visibility rules.
- [ ] Reveal travel.
- [ ] Confirm the player view updates.
- [ ] Assign a crew action.
- [ ] Confirm the player view updates.
- [ ] Advance the turn.
- [ ] Confirm the player view updates.

Expected behavior:

- Player view should update automatically while both pages are open in the same browser profile.
- If it does not update immediately, refreshing the player page should show the latest published player state.

---

# 25. Layout Smoke Test

DM landing/setup screens:

- [ ] Confirm the landing screen is readable at normal desktop width.
- [ ] Confirm the setup screen is readable at normal desktop width.
- [ ] Confirm ship-name and crew-name fields are usable.
- [ ] Confirm trait/proficiency checkboxes are readable and do not overlap badly.
- [ ] Shrink the window and confirm the setup screen remains recoverable.

DM tracker screen:

- [ ] Confirm the main controls are usable at normal desktop width.
- [ ] Confirm crew rows are readable.
- [ ] Confirm pending prompts are readable.
- [ ] Confirm the log remains usable.
- [ ] Shrink the window and confirm the app remains recoverable.

Player screen:

- [ ] Confirm the player screen is readable at fullscreen size.
- [ ] Confirm it remains readable when projected or shown on a second display.
- [ ] Confirm the water meter/readout is not hidden behind marker lines.
- [ ] Confirm crew rows do not overlap badly.
- [ ] Confirm major ship status panels do not overlap.

---

# 26. Final Pass Before Commit

Before committing a major change:

- [ ] Run `npm run ci`.
- [ ] Run this manual checklist if browser behavior may have changed.
- [ ] Confirm GitHub Actions passes after pushing.
- [ ] Confirm the app still loads from a clean browser tab.
- [ ] Confirm no serious console errors appear.

---

# Notes for Future Expansion

When presets, custom event tables, save slots, or skeleton helpers are added, expand this checklist with specific tests for those features.

Current future checklist sections to add later:

- Starting presets beyond the current default voyage.
- Built-in event table selector.
- Custom event table editor.
- Temporary skeleton helpers.
- Save slots.
