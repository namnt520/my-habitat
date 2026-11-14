/**
 * Sổ đăng ký module hành vi. Thêm hành vi mới: viết một file module rồi thêm vào bảng dưới đây;
 * sau đó mọi loài có thể dùng nó qua `"behaviors": [{ "use": "<tên>" }]` trong file JSON.
 */
import type { BehaviorModule } from '../runtime';
import { drink } from './drink';
import { flee } from './flee';
import { forage } from './forage';
import { herd } from './herd';
import { hibernate } from './hibernate';
import { aerialHunt, hunt } from './hunt';
import { mate } from './mate';
import { nurse } from './nurse';
import { pack } from './pack';
import { packHunt } from './packHunt';
import { rest } from './rest';
import { scavenge } from './scavenge';
import { wander } from './wander';

export const BEHAVIORS: Readonly<Record<string, BehaviorModule<never>>> = {
  flee,
  drink,
  forage,
  hunt,
  aerialHunt,
  packHunt,
  scavenge,
  mate,
  nurse,
  rest,
  hibernate,
  herd,
  pack,
  wander,
} as unknown as Record<string, BehaviorModule<never>>;
