// Vice Bay v2 — every authored piece of content in one place:
// districts and roads, vehicles, weapons, shops, garage upgrades,
// respect ranks, the 8-chapter story arc, side jobs and dialogue.
// Pure data, no logic. The story follows Rico Vale against
// Los Tiburones.

// --- City layout -----------------------------------------------------------

export const DISTRICTS = [
  { id: 'marina', name: 'Old Marina', x0: 0, y0: 0, x1: 1000, y1: 700 },
  { id: 'heights', name: 'Palm Heights', x0: 1000, y0: 0, x1: 2100, y1: 700 },
  { id: 'downtown', name: 'Downtown Vice Bay', x0: 1000, y0: 700, x1: 2100, y1: 1500 },
  { id: 'docks', name: 'The Docks', x0: 0, y0: 1500, x1: 1100, y1: 2400 },
  { id: 'strip', name: 'Sunset Strip', x0: 1100, y0: 1500, x1: 2100, y1: 2400 },
  { id: 'beach', name: 'Beachfront', x0: 2100, y0: 0, x1: 3200, y1: 2400 },
];

export const AVENUES = [
  { x: 300, name: 'Harbor Ave' },
  { x: 700, name: 'Coral Ave' },
  { x: 1100, name: 'Palmetto Blvd' },
  { x: 1500, name: 'Neon Ave' },
  { x: 1900, name: 'Bayview Blvd' },
  { x: 2300, name: 'Pelican Ave' },
  { x: 2700, name: 'Ocean Drive' },
];

export const STREETS = [
  { y: 250, name: 'Marlin St' },
  { y: 600, name: 'Sunset St' },
  { y: 950, name: 'Flamingo St' },
  { y: 1300, name: 'Jacaranda St' },
  { y: 1650, name: 'Tiburon St' },
  { y: 2000, name: 'Anchor St' },
];

export const ROAD_HALF = 46;

// --- Vehicles --------------------------------------------------------------
// `top` is top speed in px/s; `grip` is how sharply the car turns.
export const CAR_DEFS = {
  marlin: { label: 'Marlin', kind: 'sedan', top: 330, grip: 1.0, len: 52, wid: 26, colors: ['#7fa8c9', '#c9c9c9', '#5d7a52'] },
  comet: { label: 'Comet GT', kind: 'sport', top: 470, grip: 1.25, len: 50, wid: 25, colors: ['#d8372e', '#f2c94c', '#37e6ff'] },
  vano: { label: 'Vano', kind: 'van', top: 280, grip: 0.8, len: 58, wid: 28, colors: ['#e8e4da', '#7a6a53', '#4a6b8a'] },
  cabrio: { label: 'Cabrio', kind: 'taxi', top: 340, grip: 1.0, len: 52, wid: 26, colors: ['#f2c94c'] },
  hauler: { label: 'Hauler', kind: 'truck', top: 260, grip: 0.7, len: 66, wid: 30, colors: ['#8a4a2e', '#5a6e7a'] },
  interceptor: { label: 'Interceptor', kind: 'police', top: 420, grip: 1.15, len: 54, wid: 27, colors: ['#1c2733'] },
  moto: { label: 'Vespa Moto', kind: 'motorcycle', top: 500, grip: 1.5, len: 40, wid: 16, colors: ['#ff4fd8', '#37e6ff', '#f2c94c'] },
  pickup: { label: 'Rancho Pickup', kind: 'pickup', top: 300, grip: 0.85, len: 60, wid: 28, colors: ['#5d7a52', '#8a4a2e', '#c9c9c9'] },
  limo: { label: 'Vice Limo', kind: 'limo', top: 320, grip: 0.75, len: 78, wid: 28, colors: ['#1c2733', '#c9c9c9', '#7a3b5e'] },
};
export const CAR_TYPES = Object.keys(CAR_DEFS);

// --- Weapons ---------------------------------------------------------------
export const GUN_DEFS = {
  fists: { label: 'Fists', dmg: 16, range: 42, rate: 0.34, auto: false, mag: Infinity, reserve: Infinity, spread: 0, speed: 0 },
  pistol: { label: 'P-9 Pistol', dmg: 22, range: 460, rate: 0.26, auto: false, mag: 12, reserve: 96, spread: 0.03, speed: 950 },
  smg: { label: 'VB-9 SMG', dmg: 13, range: 380, rate: 0.09, auto: true, mag: 30, reserve: 150, spread: 0.07, speed: 1000 },
  shotgun: { label: 'Boomstick', dmg: 15, range: 260, rate: 0.85, auto: false, mag: 6, reserve: 30, spread: 0.16, speed: 850, pellets: 6 },
  rifle: { label: 'LR-7 Rifle', dmg: 34, range: 640, rate: 0.55, auto: false, mag: 20, reserve: 80, spread: 0.02, speed: 1400 },
};
export const WEAPON_ORDER = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'];

// --- Shops -----------------------------------------------------------------

export const SHOP_DEFS = [
  { id: 'dex', name: 'Dex Garage', blurb: 'Repairs & tune-ups', color: '#ff9a3d',
    goods: [
      { id: 'repair', label: 'Full repair', price: 80, desc: 'Restore your car to 100 HP' },
      { id: 'armorcar', label: 'Armored panels', price: 150, desc: '+40 max car HP this session' },
      { id: 'paint', label: 'Neon underglow', price: 60, desc: 'Your car glows at night' },
    ] },
  { id: 'arms', name: 'Bay Arms', blurb: 'Guns & armor', color: '#e5534b',
    goods: [
      { id: 'ammo_pistol', label: 'Pistol ammo x48', price: 40, desc: '+48 pistol rounds' },
      { id: 'buy_smg', label: 'VB-9 SMG', price: 350, desc: 'Rapid-fire SMG + 90 rounds' },
      { id: 'buy_shotgun', label: 'Boomstick', price: 300, desc: 'Close-range shotgun + 18 shells' },
      { id: 'buy_rifle', label: 'LR-7 Rifle', price: 650, desc: 'Long-range rifle + 40 rounds (rank 1+)' },
      { id: 'vest', label: 'Kevlar vest', price: 120, desc: '+50 armor' },
    ] },
  { id: 'thread', name: 'Neon Thread', blurb: 'Outfits', color: '#ff4fd8',
    goods: [
      { id: 'outfit_street', label: 'Street outfit', price: 60, desc: 'Teal jacket — Rico default' },
      { id: 'outfit_neon', label: 'Neon outfit', price: 90, desc: 'Hot-pink night look' },
      { id: 'outfit_suit', label: 'Sharp suit', price: 140, desc: 'Downtown clean look' },
    ] },
];

export const OUTFIT_COLORS = { street: '#2fa8a0', neon: '#ff4fd8', suit: '#2b3242' };

// --- Garage upgrades -------------------------------------------------------
// Three upgrade lines, three tiers each. The prices are the cash
// sink competing against shops, respect unlocks and crew — maxing
// everything is deliberately unaffordable early.
export const GARAGE_TIERS = 3;
export const GARAGE_DEFS = {
  engine: { label: 'Engine', blurb: '+8% top speed per tier', tiers: [
    { price: 300, desc: 'Stage 1 tune — +8% top speed' },
    { price: 700, desc: 'Stage 2 tune — +16% top speed' },
    { price: 1400, desc: 'Stage 3 tune — +24% top speed' },
  ] },
  armor: { label: 'Armor', blurb: '+25% max HP, less damage per tier', tiers: [
    { price: 250, desc: 'Plated doors — +25% max HP' },
    { price: 600, desc: 'Plated body — +50% max HP' },
    { price: 1200, desc: 'Full cage — +75% max HP' },
  ] },
  nitro: { label: 'Nitro', blurb: 'Burst boost per tier', tiers: [
    { price: 200, desc: 'Small bottle — short burst' },
    { price: 500, desc: 'Twin bottles — longer burst' },
    { price: 1000, desc: 'Race kit — longest burst' },
  ] },
};

// --- Respect ranks ---------------------------------------------------------
export const RESPECT_RANKS = [
  { name: 'Street', points: 0, unlock: '—' },
  { name: 'Hustler', points: 400, unlock: 'Rifle unlocked at Bay Arms' },
  { name: 'Shot-Caller', points: 1000, unlock: 'Sports cars unlocked + new vehicle class' },
  { name: 'Kingpin', points: 2000, unlock: 'Shop discount 20% + crew slot' },
  { name: 'Legend', points: 3500, unlock: 'Finale + title flair' },
];

// --- Story: 8 chapters, Rico Vale vs Los Tiburones ------------------------
// Stage kinds: reach | kill | escape | chase | tail.
//  - reach: get within `radius` of the target (`pressE` asks for an
//    E press to complete it).
//  - kill: defeat `count` enemies spawned at `spawn`.
//  - escape: lose all wanted heat, then reach the target; a
//    `duration` means survive that many seconds under pursuit
//    before the target opens.
//  - chase: stay within `radius` of a moving target for `duration`
//    seconds.
//  - tail: follow a moving target car within `radius` for
//    `duration` seconds; being spotted (too close, or ramming it)
//    raises wanted, but never fails the stage outright.
// The finale payout is kept in one constant: the c8 chapter reward
// (3000 cash / 800 respect, in its STORY entry below) and the
// engine's results display must never disagree about it.
export const FINALE_REWARD = { cash: 3000, respect: 800 };

export const STORY = [
  {
    id: 'c1', title: 'First Delivery', giver: 'Mara', reward: 300, respect: 120,
    brief: 'Mara needs a package moved across town. Pick it up at Dex Garage, then drop it at the Beach Cafe. No cops, no fuss.',
    stages: [
      { key: 'pickup', text: 'Pick up the package at Dex Garage', kind: 'reach', target: { x: 700, y: 1300, label: 'Dex Garage' }, radius: 70, pressE: true },
      { key: 'deliver', text: 'Deliver the package to Beach Cafe', kind: 'reach', target: { x: 2740, y: 600, label: 'Beach Cafe' }, radius: 70, pressE: true },
    ],
  },
  {
    id: 'c2', title: 'Sharks at the Docks', giver: 'Mara', reward: 600, respect: 200,
    brief: 'Los Tiburones are muscling in on the docks. Go to the warehouse, deal with the crew, then report back to Mara.',
    stages: [
      { key: 'goto', text: 'Reach the dock warehouse', kind: 'reach', target: { x: 420, y: 1850, label: 'Dock Warehouse' }, radius: 80 },
      { key: 'clear', text: 'Deal with the Tiburones crew (0/3)', kind: 'kill', count: 3, spawn: { x: 420, y: 1850 } },
      { key: 'report', text: 'Report back to Mara', kind: 'reach', target: { x: 1500, y: 950, label: 'Mara' }, radius: 70, pressE: true },
    ],
  },
  {
    id: 'c3', title: 'Rosa Is Coming', giver: 'Dex', reward: 900, respect: 250,
    brief: 'Captain Rosa has your plate. Three stars and counting — lose the heat, then slip into the safehouse on Ocean Drive.',
    stages: [
      { key: 'heat', text: 'Lose the heat, then reach the safehouse', kind: 'escape', target: { x: 2700, y: 2000, label: 'Safehouse' }, radius: 80 },
    ],
  },
  {
    id: 'c4', title: 'The Getaway Driver', giver: 'Dex', reward: 800, respect: 220,
    brief: 'A Tiburones courier is running product through the Strip. Tail his car without being spotted, then lift the cargo when he parks.',
    stages: [
      { key: 'tail', text: 'Tail the courier car — stay close, do not get spotted', kind: 'tail', target: { x: 1500, y: 1650, label: 'Courier car' }, radius: 260, duration: 25 },
      { key: 'cargo', text: 'Steal the cargo from the parked courier car', kind: 'reach', target: { x: 1500, y: 1650, label: 'Courier car' }, radius: 60, pressE: true },
    ],
  },
  {
    id: 'c5', title: 'Air One', giver: 'Mara', reward: 1100, respect: 300,
    brief: 'Air One is in the sky and Rosa wants you grounded. Survive a 4-star pursuit for 90 seconds, break the spotlight, then meet Mara\u2019s van.',
    stages: [
      { key: 'survive', text: 'Survive the 4-star pursuit — 90 seconds under Air One', kind: 'escape', duration: 90, target: null },
      { key: 'van', text: 'Stay with Mara\u2019s van to the rendezvous', kind: 'chase', target: { x: 1500, y: 950, label: 'Mara\u2019s van' }, radius: 220, duration: 20 },
      { key: 'hide', text: 'Reach the Marina hideout', kind: 'reach', target: { x: 300, y: 250, label: 'Marina hideout' }, radius: 80 },
    ],
  },
  {
    id: 'c6', title: 'Neon Heist', giver: 'Mara', reward: 1400, respect: 350,
    brief: 'Three checkpoints across the neon Strip, then grab the take and vanish before Rosa\u2019s net closes.',
    stages: [
      { key: 'cp1', text: 'Checkpoint 1 — Neon Ave', kind: 'reach', target: { x: 1500, y: 1300, label: 'Checkpoint 1' }, radius: 70 },
      { key: 'cp2', text: 'Checkpoint 2 — Bayview Blvd', kind: 'reach', target: { x: 1900, y: 950, label: 'Checkpoint 2' }, radius: 70 },
      { key: 'cp3', text: 'Checkpoint 3 — Sunset Strip', kind: 'reach', target: { x: 1500, y: 2000, label: 'Checkpoint 3' }, radius: 70 },
      { key: 'take', text: 'Grab the take at the Strip drop', kind: 'reach', target: { x: 1500, y: 2000, label: 'The take' }, radius: 60, pressE: true },
      { key: 'vanish', text: 'Escape the heat, then reach the Beach Cafe', kind: 'escape', target: { x: 2740, y: 600, label: 'Beach Cafe' }, radius: 80 },
    ],
  },
  {
    id: 'c7', title: 'Kingpin Rising', giver: 'Dex', reward: 1800, respect: 450,
    brief: 'Four Tiburones lieutenants run Downtown and the Docks. Clear them all, then report to Dex — the lookout joins you after this.',
    stages: [
      { key: 'downtown', text: 'Clear the Downtown lieutenants (0/2)', kind: 'kill', count: 2, spawn: { x: 1500, y: 950 } },
      { key: 'docks', text: 'Clear the Docks lieutenants (0/2)', kind: 'kill', count: 2, spawn: { x: 420, y: 1850 } },
      { key: 'report', text: 'Report back to Dex', kind: 'reach', target: { x: 700, y: 1300, label: 'Dex Garage' }, radius: 70, pressE: true },
    ],
  },
  {
    id: 'c8', title: 'The Last Job', giver: 'Mara', reward: 3000, respect: 800,
    brief: 'The vault car is rolling to the Docks under a 5-star escort with Air One overhead. Take it, outrun everything, deliver it to the pier.',
    stages: [
      { key: 'vault', text: 'Reach the Tiburones vault car', kind: 'reach', target: { x: 1900, y: 1300, label: 'Vault car' }, radius: 90 },
      { key: 'escort', text: 'Stay with the vault car through the escort', kind: 'chase', target: { x: 1900, y: 1300, label: 'Vault car' }, radius: 240, duration: 25 },
      { key: 'deliver', text: 'Outrun 5 stars + Air One — deliver the vault car to the pier', kind: 'escape', target: { x: 420, y: 2100, label: 'Docks pier' }, radius: 90 },
    ],
  },
];

// --- Side jobs -------------------------------------------------------------
// Each job is gated by the player's standing in their CURRENT
// district: taxi needs 25, race 50, food 75.
export const JOB_DEFS = {
  taxi: { label: 'Taxi fare', payMin: 80, payMax: 160, standing: 25 },
  race: { label: 'Street race', pay: 250, timeLimit: 75, standing: 50 },
  food: { label: 'Food run', pay: 120, stops: 3, standing: 75 },
};

// --- Dialogue --------------------------------------------------------------
export const STORY_LINES = {
  c1_start: 'Mara: "Rico. One package, no detours. Dex has it — Beach Cafe wants it. Go."',
  c1_mid: 'Dex: "Package is light, Rico. Keep it that way. Beach Cafe, Ocean Drive side."',
  c1_done: 'Mara: "Clean run. The Bay notices people who deliver. Keep moving."',
  c2_start: 'Mara: "Sharks at the Docks, Rico. Warehouse crew, three of them. Make it quiet."',
  c2_mid: 'Dex: "Warehouse on Tiburon St. They will not talk — do not bother asking."',
  c2_done: 'Mara: "Docks are ours again. Rosa heard about it, though. Watch the sky."',
  c3_start: 'Dex: "Rosa has your plate, three stars. Lose them, then the safehouse on Ocean Drive."',
  c3_mid: 'Mara: "Do not fight the whole Bay, Rico. Just disappear."',
  c3_done: 'Dex: "You slipped Rosa. She hates that. She will remember it."',
  c4_start: 'Dex: "Courier runs product through the Strip. Follow him — close, not seen. Then take the cargo."',
  c4_mid: 'Mara: "If he spots you, he runs and Rosa gets a call. Patience, Rico."',
  c4_done: 'Dex: "Cargo is ours. And the driver who ran it? He drives for us now."',
  c5_start: 'Mara: "Air One is up. Four stars, spotlight on your head. Survive ninety seconds, then find my van."',
  c5_mid: 'Dex: "Spotlight holds you, heat never cools. Break line of sight — tunnels, garages, shadows."',
  c5_done: 'Mara: "You outflew Air One. The whole Bay saw it. Rosa did too."',
  c6_start: 'Mara: "Neon Heist. Three checkpoints, one take, and Rosa\u2019s net closing behind you."',
  c6_mid: 'Dex: "Checkpoints are lit. The take is at the Strip drop. Move."',
  c6_done: 'Mara: "Fourteen hundred and the Strip still buzzing your name. Beautiful."',
  c7_start: 'Dex: "Four lieutenants, two districts. Clear them and the Bay is yours to tax."',
  c7_mid: 'Mara: "Downtown first, then the Docks. Leave no one to report back."',
  c7_done: 'Dex: "Kingpin Rising, Rico. The lookout watches the roads for you now."',
  c8_start: 'Mara: "The Last Job. Vault car, five stars, Air One. Take it to the pier — and Rico, do not die."',
  c8_mid: 'Dex: "Escort is tight. Stay with the vault car until the road opens, then run."',
  c8_done: 'Mara: "It is done. The Bay is yours, Legend. Vice Bay remembers this night."',
};

// --- Pedestrians -----------------------------------------------------------
export const PED_COLORS = ['#e8b48a', '#c98d5f', '#8a5a3b', '#f2c94c', '#37e6ff', '#ff4fd8', '#58b368'];
