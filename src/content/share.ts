/**
 * Compose engaging X (Twitter) posts for personal-best scores.
 */

import { CREDITS } from './credits';
import { getDifficulty } from '../sim/difficulty';
import type { ScoreEntry } from '../sim/scoreStore';

const REPO_URL = 'https://github.com/UnderdarkEcho/aegisProtocol';

const HOOKS = [
  'Jacked in. Node cleared. Privilege escalated.',
  'Corporate ICE blinked first.',
  'Probe team still online. Kernel is not.',
  'Another die falls. The outer sim waits.',
  'Data port locked. Hostiles wiped. Link stable.',
];

function hookFor(score: number): string {
  const i = Math.abs(score) % HOOKS.length;
  return HOOKS[i]!;
}

/** Build post text for a score entry (kept under typical X limits). */
export function composeScoreShareText(entry: ScoreEntry, rank?: number): string {
  const diff = getDifficulty(entry.difficulty).label;
  const score = entry.score.toLocaleString();
  const hook = hookFor(entry.score);

  if (entry.mode === 'campaign') {
    const track =
      entry.track === 'extended'
        ? 'EXTENDED arc (10 ops)'
        : 'STANDARD arc (3 ops)';
    const rankBit = rank === 1 ? ' · personal best' : rank ? ` · deck #${rank}` : '';
    return [
      `${hook}`,
      ``,
      `Aegis Protocol — ${track} STACK CLEAR`,
      `Score ${score}${rankBit} · ${diff}`,
      entry.totalXp != null ? `Privilege banked +${entry.totalXp} XP` : null,
      ``,
      `Browser TBS: cover, FOW, data-port holds, void ICE.`,
      `Free & open source by ${CREDITS.handle}`,
      REPO_URL,
    ]
      .filter((l) => l != null)
      .join('\n');
  }

  const map = (entry.mapId ?? 'NODE').toUpperCase();
  const grade = entry.grade ? ` · Grade ${entry.grade}` : '';
  const turns = entry.turns != null ? ` · T${entry.turns}` : '';
  const kills = entry.kills != null ? ` · ${entry.kills} kills` : '';
  const rankBit = rank === 1 ? ' · PB' : rank ? ` · #${rank}` : '';
  const vector =
    entry.reason === 'data_port'
      ? 'via data port link'
      : entry.reason === 'hostiles_eliminated'
        ? 'via hostile wipe'
        : 'breach complete';

  return [
    `${hook}`,
    ``,
    `Aegis Protocol — ${map} cracked on ${diff}${rankBit}`,
    `${score} pts${grade}${turns}${kills}`,
    vector,
    ``,
    `Jack a 4-probe team onto a hostile die. Free browser tactics.`,
    `by ${CREDITS.handle} · ${REPO_URL}`,
  ].join('\n');
}

/** Open X compose with prefilled text (new tab). */
export function shareScoreToX(entry: ScoreEntry, rank?: number): void {
  const text = composeScoreShareText(entry, rank);
  const url = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
