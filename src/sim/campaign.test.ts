import { describe, expect, it } from 'vitest';
import {
  applyCampaignOutcome,
  bankCampaignXp,
  CAMPAIGN_OP_COUNT,
  CAMPAIGN_OPS,
  campaignProgressLabel,
  defaultCampaign,
  getCurrentOp,
  newCampaign,
  sanitizeCampaign,
} from './campaign';

describe('campaign ops', () => {
  it('has three ops mapping training → vesper → kernel', () => {
    expect(CAMPAIGN_OPS).toHaveLength(3);
    expect(CAMPAIGN_OPS[0]!.mapId).toBe('training');
    expect(CAMPAIGN_OPS[1]!.mapId).toBe('vesper');
    expect(CAMPAIGN_OPS[2]!.mapId).toBe('kernel');
  });

  it('starts at op 0 incomplete', () => {
    const c = defaultCampaign();
    expect(c.opIndex).toBe(0);
    expect(c.completed).toBe(false);
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
    expect(getCurrentOp(c).title).toContain('quiet');
  });

  it('locks loud path when OP-02 wins via wipe', () => {
    let c = defaultCampaign();
    c = applyCampaignOutcome(c, true);
    c = applyCampaignOutcome(c, true, 'hostiles_eliminated');
    expect(c.vesperPath).toBe('loud');
    expect(getCurrentOp(c).title).toContain('alert');
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
    expect(again.clears[2]).toBe(1); // no extra clear when already completed
  });
});

describe('sanitizeCampaign', () => {
  it('clamps bad indexes and fills clears', () => {
    const s = sanitizeCampaign({
      version: 1,
      opIndex: 99,
      completed: false,
      clears: [1],
    });
    expect(s.opIndex).toBe(CAMPAIGN_OP_COUNT - 1);
    expect(s.clears).toHaveLength(CAMPAIGN_OP_COUNT);
    expect(s.clears[0]).toBe(1);
  });

  it('rejects wrong version', () => {
    const s = sanitizeCampaign({ version: 2, opIndex: 2, completed: true });
    expect(s).toEqual(defaultCampaign());
  });
});

describe('newCampaign', () => {
  it('resets progress without depending on roster', () => {
    let c = defaultCampaign();
    c = applyCampaignOutcome(c, true);
    c = applyCampaignOutcome(c, true);
    const n = newCampaign();
    expect(n.opIndex).toBe(0);
    expect(n.completed).toBe(false);
    expect(n.clears.every((x) => x === 0)).toBe(true);
    expect(n.totalXpEarned).toBe(0);
  });
});

describe('bankCampaignXp', () => {
  it('accumulates XP across ops', () => {
    let c = defaultCampaign();
    c = bankCampaignXp(c, 100);
    c = bankCampaignXp(c, 50);
    expect(c.totalXpEarned).toBe(150);
    c = applyCampaignOutcome(c, true);
    expect(c.totalXpEarned).toBe(150);
  });

  it('ignores non-positive amounts', () => {
    const c = bankCampaignXp(defaultCampaign(), -5);
    expect(c.totalXpEarned).toBe(0);
  });
});

describe('campaignProgressLabel', () => {
  it('shows op codename mid-run', () => {
    const c = defaultCampaign();
    expect(campaignProgressLabel(c)).toContain('OP-01');
    expect(campaignProgressLabel(c)).toContain('1/3');
  });

  it('shows complete when done', () => {
    let c = defaultCampaign();
    for (let i = 0; i < 3; i++) c = applyCampaignOutcome(c, true);
    expect(campaignProgressLabel(c)).toContain('COMPLETE');
  });
});
