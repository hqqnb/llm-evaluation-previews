// ============================================================================
// maps/index.js — the map registry the menu and the loader read from.
// ============================================================================

import { dust2 } from './dust2.js';
import { refinery } from './refinery.js';
import { bazaar } from './bazaar.js';

export const MAPS = { dust2, refinery, bazaar };
export const MAP_LIST = [dust2, refinery, bazaar];
export const MAP_IDS = MAP_LIST.map((m) => m.id);
export const getMap = (id) => MAPS[id] || dust2;
export default MAPS;
