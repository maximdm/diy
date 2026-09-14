import type { Profile } from '../types';
import { clothes } from './clothes';
import { construction } from './construction';
import { electrical } from './electrical';
import { furniture } from './furniture';
import { gardening } from './gardening';
import { jewelry } from './jewelry';
import { landscaping } from './landscaping';
import { leatherworking } from './leatherworking';
import { metalwork } from './metalwork';
import { plumbing } from './plumbing';
import { tiling } from './tiling';
import { woodworking } from './woodworking';

export const profiles: Profile[] = [
  gardening,
  furniture,
  jewelry,
  clothes,
  construction,
  woodworking,
  tiling,
  landscaping,
  plumbing,
  electrical,
  metalwork,
  leatherworking,
];

export function profileById(id: string): Profile {
  return profiles.find((p) => p.id === id) ?? furniture;
}