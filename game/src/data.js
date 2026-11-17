// All authored content: districts, streets, vehicles, weapons, shops, the
// story and the side jobs. Everything is fictional; nothing here comes from
// any existing game, brand or recording artist.

// --- Districts: name + bounds, used for the HUD street/district readout.
export const DISTRICTS = [
  { name: 'Old Marina', x0: 0, y0: 0, x1: 1000, y1: 700 },
  { name: 'Palm Heights', x0: 1000, y0: 0, x1: 2100, y1: 700 },
  { name: 'Downtown Vice Bay', x0: 1000, y0: 700, x1: 2100, y1: 1500 },
  { name: 'The Docks', x0: 0, y0: 1500, x1: 1100, y1: 2400 },
  { name: 'Sunset Strip', x0: 1100, y0: 1500, x1: 2100, y1: 2400 },
  { name: 'Beachfront', x0: 2100, y0: 0, x1: 3200, y1: 2400 },
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

// --- Vehicles. `top` is top speed px/s, `grip` how sharply it turns.
export const CAR_DEFS = {
  marlin: { label: 'Marlin', kind: 'sedan', top: 330, grip: 1.0, len: 52, wid: 26, colors: ['#7fa8c9', '#c9c9c9', '#5d7a52'] },
  comet: { label: 'Comet GT', kind: 'sport', top: 470, grip: 1.25, len: 50, wid: 25, colors: ['#d8372e', '#f2c94c', '#37e6ff'] },
  vano: { label: 'Vano', kind: 'van', top: 280, grip: 0.8, len: 58, wid: 28, colors: ['#e8e4da', '#7a6a53', '#4a6b8a'] },
  cabrio: { label: 'Cabrio', kind: 'taxi', top: 340, grip: 1.0, len: 52, wid: 26, colors: ['#f2c94c'] },
  hauler: { label: 'Hauler', kind: 'truck', top: 260, grip: 0.7, len: 66, wid: 30, colors: ['#8a4a2e', '#5a6e7a'] },
  interceptor: { label: 'Interceptor', kind: 'police', top: 420, grip: 1.15, len: 54, wid: 27, colors: ['#1c2733'] },
};
export const CAR_TYPES = Object.keys(CAR_DEFS);

// --- Weapons.
export const GUN_DEFS = {
  fists: { label: 'Fists', dmg: 16, range: 42, rate: 0.34, auto: false, mag: Infinity, reserve: Infinity, spread: 0, speed: 0 },
  pistol: { label: 'P-9 Pistol', dmg: 22, range: 460, rate: 0.26, auto: false, mag: 12, reserve: 96, spread: 0.03, speed: 950 },
  smg: { label: 'VB-9 SMG', dmg: 13, range: 380, rate: 0.09, auto: true, mag: 30, reserve: 150, spread: 0.07, speed: 1000 },
  shotgun: { label: 'Boomstick', dmg: 15, range: 260, rate: 0.85, auto: false, mag: 6, reserve: 30, spread: 0.16, speed: 850, pellets: 6 },
};

// --- Shops (fixed spots in the city; positions picked by city.js).
export const SHOP_DEFS = [
  { id: 'dex', name: "Dex Garage", blurb: 'Repairs & tune-ups', color: '#ff9a3d',
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

// --- Story. Three missions, each a list of stages. A stage is:
// { key, text, target:{x,y,label} | null, kind, ... } — missions.js interprets kinds.
export const STORY = [
  {
    id: 'm1', title: 'First Delivery', giver: 'Mara',
    brief: 'Mara needs a package moved across town. Pick it up at Dex Garage, then drop it at the Beach Cafe. No cops, no fuss.',
    reward: 300,
    stages: [
      { key: 'pickup', text: 'Pick up the package at Dex Garage', kind: 'reach', target: { x: 700, y: 1300, label: 'Dex Garage' }, radius: 70, pressE: true },
      { key: 'deliver', text: 'Deliver the package to Beach Cafe', kind: 'reach', target: { x: 2740, y: 600, label: 'Beach Cafe' }, radius: 70, pressE: true },
    ],
  },
  {
    id: 'm2', title: 'Sharks at the Docks', giver: 'Mara',
    brief: 'Los Tiburones are muscling in on the docks. Go to the warehouse, deal with the crew, then report back to Mara.',
    reward: 600,
    stages: [
      { key: 'goto', text: 'Reach the dock warehouse', kind: 'reach', target: { x: 420, y: 1850, label: 'Dock Warehouse' }, radius: 80 },
      { key: 'clear', text: 'Deal with the Tiburones crew (0/3)', kind: 'kill', count: 3, spawn: { x: 420, y: 1850 } },
      { key: 'report', text: 'Report back to Mara', kind: 'reach', target: { x: 1500, y: 950, label: 'Mara' }, radius: 70, pressE: true },
    ],
  },
  {
    id: 'm3', title: 'Rosa Is Coming', giver: 'Dex',
    brief: 'Captain Rosa has your plate. Three stars and counting — lose the heat, then slip into the safehouse on Ocean Drive.',
    reward: 900,
    stages: [
      { key: 'heat', text: 'Lose the heat, then reach the safehouse', kind: 'escape', target: { x: 2700, y: 2000, label: 'Safehouse' }, radius: 80 },
    ],
  },
];

export const JOB_DEFS = {
  taxi: { label: 'Taxi fare', payMin: 80, payMax: 160 },
  race: { label: 'Street race', pay: 250, timeLimit: 75 },
  food: { label: 'Food run', pay: 120, stops: 3 },
};

export const STORY_LINES = {
  m1_start: 'MARA: Rico, first job. Package at Dex. Beach Cafe. Go.',
  m1_mid: 'DEX: Package is in the back room. Don\'t open it, Rico.',
  m1_done: 'MARA: Clean run. The Bay is starting to notice you.',
  m2_start: 'MARA: Tiburones at the docks. Three of them. Make it loud.',
  m2_done: 'MARA: Docks are ours again. Dex has something for you.',
  m3_start: 'DEX: Rosa put three stars on you. Lose them, then hide.',
  m3_done: 'MARA: You slipped Rosa again. Vice Bay is yours, Rico.',
};

export const PED_COLORS = ['#d84a6a', '#4a7ad8', '#e8b23a', '#6ad84a', '#9a5fd8', '#d8d8d8', '#e07a3a'];
