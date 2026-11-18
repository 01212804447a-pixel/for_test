// Боец со скелетной моделью и анимациями motion capture (обёртка над CharAnimator
// с тем же интерфейсом, что и процедурная SoldierModel).
import * as THREE from 'three';
import { CharAnimator, charAvailable } from './charRig.js';
import { thirdPersonGun } from '../weapons/guns.js';

export const TP_KIND = { ak74m: 'ak74', ak74m_gp: 'ak74gp', ak74m_1p78: 'ak74scope', akm: 'akm', svd: 'svd', pkm: 'pkm', rpg7: 'rpg7', ptrd: 'ptrd' };

export function characterAvailable() { return charAvailable('negs'); }

function kindFor(faction, seed) {
  if (faction === 'negs') return 'negs';
  if (faction === 'officer') return 'officer';
  if (faction === 'krandi') return 'krandi';
  return 'denter' + (1 + (((seed % 4) + 4) % 4));
}

export class CharacterModel {
  constructor(faction, weaponId, { scale = 1, seed = 0 } = {}) {
    this.faction = faction;
    this.kind = kindFor(faction, seed);
    this.gun = thirdPersonGun(TP_KIND[weaponId] || 'ak74');
    this.anim = new CharAnimator(this.kind, this.gun);
    this.root = this.anim.root;
    this.root.scale.setScalar(scale);
    this.scale = scale;
    this.skinUpdate = true;
    this._acc = 0;
    this.far = false;
  }

  get deadT() { return this.anim.deadT; }
  set kick(v) { if (v > 0) this.anim.shot(); }
  get kick() { return 0; }
  hit(dir) { this.anim.hit(dir); }
  shot() { this.anim.shot(); }
  setDetail(v) { this.far = !v; }

  update(dt, st) {
    this._acc += dt;
    if (!this.skinUpdate) return;
    const d = Math.min(this._acc, 0.25);
    this._acc = 0;
    this.anim.update(d, st);
  }

  muzzleWorld(out) { return this.anim.muzzleWorld(out); }
  hitboxes(out) { return this.anim.hitboxes(out); }
}
