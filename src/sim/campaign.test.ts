import { describe, expect, it } from 'vitest';
import {
  applyCampaignOutcome,
  bankCampaignXp,
  CAMPAIGN_OP_COUNT,
  CAMPAIGN_OPS,
  CAMPAIGN_OPS_EXTENDED,
  CAMPAIGN_OPS_STANDARD,
  campaignProgressLabel,
  defaultCampaign,
  getCampaignOps,
  getCurrentOp,
  getOpCount,
  newCampaign,
  sanitizeCampaign,
} from './campaign';
import { defaultCampaignStore, sanitizeCampaignStore } from './campaignStore';

describe('campaign ops', () => {
  it('standard has three ops mapping training → vesper → kernel', () => {
    expect(CAMPAIGN_OPS).toHaveLength(3);
    expect(CAMPAIGN_OPS_STANDARD).toHaveLength(3);
    expect(CAMPAIGN_OP_COUNT).toBe(3);
    expect(CAMPAIGN_OPS[0]!.mapId).toBe('training');
    expect(CAMPAIGN_OPS[1]!.mapId).toBe('vesper');
    expect(CAMPAIGN_OPS[2]!.mapId).toBe('kernel');
  });

  it('extended has ten ops reusing only known maps', () => {
    expect(CAMPAIGN_OPS_EXTENDED).toHaveLength(10);
    expect(getOpCount('extended')).toBe(10);
    for (const op of CAMPAIGN_OPS_EXTENDED) {
      expect(['training', 'vesper', 'kernel']).toContain(op.mapId);
    }
  });

  it('starts at op 0 incomplete', () => {
    const c = defaultCampaign();
    expect(c.opIndex).toBe(0);
    expect(c.completed).toBe(false);
    expect(c.track).toBe('standard');
    expect(getCurrentOp(c).id).toBe('op01');
  });
});

describe('applyCampaignOutcome', () => {
  it('does not advance on defeat', () => {
    const c = defaultCampaign();
    const next = applyCampaignOutcome(c, false);
    expect(next.opIndex).toBe(0);
    expect(next.completed).toBe(false);
    expect(next.clears[0]).toBe(0);
  });

  it('advances op on victory', () => {
    let c = defaultCampaign();
    c = applyCampaignOutcome(c, true);
    expect(c.opIndex).toBe(1);
    expect(c.clears[0]).toBe(1);
    expect(c.completed).toBe(false);
    expect(getCurrentOp(c).mapId).toBe('vesper');
  });

  it('locks stealth path when OP-02 wins via data port', () => {
    let c = defaultCampaign();
    c = applyCampaignOutcome(c, true); // op01
    c = applyCampaignOutcome(c, true, 'data_port'); // op02
    expect(c.opIndex).toBe(2);
    expect(c.vesperPath).toBe('stealth');
    expect(getCurrentOp(c).title).toMatch(/quiet/i);
  });

  it('locks loud path when OP-02 wins via wipe', () => {
    let c = defaultCampaign();
    c = applyCampaignOutcome(c, true);
    c = applyCampaignOutcome(c, true, 'hostiles_eliminated');
    expect(c.vesperPath).toBe('loud');
    expect(getCurrentOp(c).title).toMatch(/alert/i);
  });

  it('completes after final op victory', () => {
    let c = defaultCampaign();
    c = applyCampaignOutcome(c, true); // op01
    c = applyCampaignOutcome(c, true, 'data_port'); // op02
    c = applyCampaignOutcome(c, true); // op03
    expect(c.completed).toBe(true);
    expect(c.clears[2]).toBe(1);
    expect(c.opIndex).toBe(CAMPAIGN_OP_COUNT - 1);
  });

  it('stays completed on further outcomes', () => {
    let c = defaultCampaign();
    for (let i = 0; i < 3; i++) c = applyCampaignOutcome(c, true);
    const again = applyCampaignOutcome(c, true);
    expect(again.completed).toBe(true);
    expect(again.clears[2]).toBe(1);
  });

  it('extended completes after 10 victories and locks path on EX-04', () => {
    let c = defaultCampaign('extended');
    expect(getOpCount(c.track)).toBe(10);
    for (let i = 0; i < 10; i++) {
      const op = getCampaignOps('extended')[i]!;
      const reason = op.locksVesperPath ? 'data_port' : 'hostiles_eliminated';
      c = applyCampaignOutcome(c, true, reason);
      if (op.locksVesperPath) expect(c.vesperPath).toBe('stealth');
    }
    expect(c.completed).toBe(true);
    expect(c.clears.filter((n) => n > 0).length).toBe(10);
  });
});

describe('sanitize + store', () => {
  it('migrates v1-shaped object to standard track', () => {
    const s = sanitizeCampaign({
      version: 1,
      opIndex: 1,
      completed: false,
      clears: [1, 0, 0],
      totalXpEarned: 40,
      vesperPath: null,
    });
    expect(s.version).toBe(2);
    expect(s.track).toBe('standard');
    expect(s.opIndex).toBe(1);
    expect(s.runScore).toBe(0);
  });

  it('dual-slot store keeps tracks independent', () => {
    const store = defaultCampaignStore();
    expect(store.standard.track).toBe('standard');
    expect(store.extended.track).toBe('extended');
    expect(store.extended.clears).toHaveLength(10);
    const migrated = sanitizeCampaignStore({
      version: 1,
      opIndex: 2,
      completed: true,
      clears: [1, 1, 1],
      totalXpEarned: 100,
      vesperPath: 'loud',
    });
    expect(migrated.standard.completed).toBe(true);
    expect(migrated.extended.completed).toBe(false);
  });
});

describe('bankCampaignXp', () => {
  it('adds finite positive amounts', () => {
    let c = defaultCampaign();
    c = bankCampaignXp(c, 50);
    expect(c.totalXpEarned).toBe(50);
  });
});

describe('campaignProgressLabel', () => {
  it('mentions complete when finished', () => {
    let c = defaultCampaign();
    for (let i = 0; i < 3; i++) c = applyCampaignOutcome(c, true);
    expect(campaignProgressLabel(c)).toMatch(/COMPLETE/);
  });
});

describe('newCampaign', () => {
  it('resets to track start', () => {
    const c = newCampaign('extended');
    expect(c.track).toBe('extended');
    expect(c.opIndex).toBe(0);
    expect(c.clears).toHaveLength(10);
  });
});
