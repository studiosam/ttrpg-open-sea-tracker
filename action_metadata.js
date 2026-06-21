(function exposeActionMetadata(global) {
  const ACTION_METADATA = [
    { id: 'idle', short: 'Idle', name: 'Idle / Watch', playerLabel: 'Idle', labor: 0 },
    {
      id: 'inventoryFood',
      short: 'Food Inv.',
      name: 'Inventory Food',
      playerLabel: 'Inventory Food',
      labor: 0,
      belowDeck: true,
      manual: 'Update the total amount of food available to the players.',
      reveals: ['food']
    },
    {
      id: 'inventoryWater',
      short: 'Water Inv.',
      name: 'Inventory Water',
      playerLabel: 'Inventory Water',
      labor: 0,
      belowDeck: true,
      manual: 'Update the total amount of drinking water available to the players.',
      reveals: ['freshWater']
    },
    {
      id: 'inventoryRepairs',
      short: 'Repair Inv.',
      name: 'Inventory Repair Supplies',
      playerLabel: 'Check Supplies',
      labor: 0,
      belowDeck: true,
      manual: 'Update the total amount of repair supplies available to the players.',
      reveals: ['repairMaterials']
    },
    {
      id: 'inventoryCargo',
      short: 'Cargo Inv.',
      name: 'Inventory Cargo',
      playerLabel: 'Inventory Cargo',
      labor: 0,
      belowDeck: true,
      manual: 'Update cargo information available to the players.'
    },
    {
      id: 'studyMap',
      short: 'Navigate',
      name: 'Navigate / Study Map',
      playerLabel: 'Navigate',
      labor: 0,
      check: 'navigate'
    },
    {
      id: 'examineRod',
      short: 'Bilge Rod',
      name: 'Examine Bilge Sounding Rod',
      playerLabel: 'Sound Bilge',
      labor: 0,
      belowDeck: true,
      noFloodedExtraTurn: true,
      check: 'bilgeRod'
    },
    {
      id: 'fightGulls',
      short: 'Fight Gulls',
      name: 'Fight Pack of Gulls',
      playerLabel: 'Fight Gulls',
      labor: 0,
      requirement: 'gullsPresent'
    },
    {
      id: 'collectRainwater',
      short: 'Rainwater',
      name: 'Collect Rainwater',
      playerLabel: 'Collect Rainwater',
      labor: 0,
      requirement: 'rainwaterAvailable'
    },
    {
      id: 'recoverWreckage',
      short: 'Wreckage',
      name: 'Recover Floating Wreckage',
      playerLabel: 'Recover Wreckage',
      labor: 1,
      requirement: 'wreckageAvailable',
      check: 'recoverWreckage'
    },
    { id: 'helm', short: 'Helm', name: 'Man Helm', playerLabel: 'Helm', labor: 1, check: 'helm' },
    {
      id: 'pump',
      short: 'Pump',
      name: 'Operate Bilge Pump (Solo)',
      playerLabel: 'Bilge Pump',
      labor: 1,
      requirement: 'pumpWorking',
      check: 'pumpSolo'
    },
    {
      id: 'harpoon',
      short: 'Harpoon',
      name: 'Harpoon Fishing (Solo)',
      playerLabel: 'Harpoon Fishing',
      labor: 1,
      check: 'harpoon'
    },
    {
      id: 'resetNet',
      short: 'Reset Net',
      name: 'Reset Fishing Net',
      playerLabel: 'Reset Net',
      labor: 1,
      requirement: 'netTangled',
      deferComplete: true
    },
    {
      id: 'repairPump',
      short: 'Fix Pump',
      name: 'Repair Bilge Pump',
      playerLabel: 'Repair Pump',
      labor: 1,
      requirement: 'pumpJammed',
      deferComplete: true,
      repairCost: 1
    },
    {
      id: 'repairRigging',
      short: 'Rigging Repair',
      name: 'Repair Rigging',
      playerLabel: 'Repair Rigging',
      labor: 1,
      requirement: 'riggingBroken',
      repairCost: 1
    },
    {
      id: 'bucket',
      short: 'Bucket',
      name: 'Bucket Brigade',
      playerLabel: 'Bucket Brigade',
      labor: 1,
      belowDeck: true,
      duration: 2
    },
    {
      id: 'rest',
      short: 'Recover',
      name: 'Recover',
      playerLabel: 'Resting',
      labor: 0,
      duration: 2,
      completeChoice: 'rest'
    },
    {
      id: 'pumpCoop',
      short: 'Pump x2',
      name: 'Operate Bilge Pump (Cooperative)',
      playerLabel: 'Bilge Pump',
      labor: 1,
      groupSize: 2,
      sharedStart: true,
      requirement: 'pumpWorking',
      check: 'pumpCoop'
    },
    {
      id: 'castNet',
      short: 'Cast Net',
      name: 'Cast Fishing Net',
      playerLabel: 'Cast Net',
      labor: 1,
      groupSize: 2,
      requirement: 'netReady',
      check: 'castNet',
      deferComplete: true
    },
    {
      id: 'assistHarpoon',
      short: 'Harpoon x2',
      name: 'Harpoon Fishing (Cooperative)',
      playerLabel: 'Harpoon Fishing',
      labor: 1,
      groupSize: 2,
      check: 'assistHarpoon'
    },
    {
      id: 'repairLeak',
      short: 'Leak Repair',
      name: 'Repair Active Leak',
      playerLabel: 'Repair Leak',
      labor: 1,
      belowDeck: true,
      groupSize: 2,
      allowMultipleGroups: true,
      deferComplete: true,
      requirement: 'activeLeaks'
    },
    {
      id: 'repairMast',
      short: 'Mast Repair',
      name: 'Repair Mast',
      playerLabel: 'Repair Mast',
      labor: 2,
      groupSize: 2,
      sharedStart: true,
      requirement: 'mastBroken',
      duration: 2,
      repairCost: 1
    },
    {
      id: 'repairRudder',
      short: 'Rudder Repair',
      name: 'Repair Rudder',
      playerLabel: 'Repair Rudder',
      labor: 2,
      groupSize: 2,
      sharedStart: true,
      requirement: 'rudderBroken',
      duration: 2,
      repairCost: 1
    }
  ];

  const ACTION_METADATA_BY_ID = Object.fromEntries(
    ACTION_METADATA.map((action) => [action.id, action])
  );
  const ACTION_METADATA_BY_NAME = Object.fromEntries(
    ACTION_METADATA.map((action) => [action.name, action])
  );

  global.ACTION_METADATA = ACTION_METADATA;
  global.ACTION_METADATA_BY_ID = ACTION_METADATA_BY_ID;
  global.ACTION_METADATA_BY_NAME = ACTION_METADATA_BY_NAME;
})(typeof window !== 'undefined' ? window : globalThis);
