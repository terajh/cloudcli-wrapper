/**
 * Regression tests for the optimistic-session side-car logic.
 *
 * These cover the exact scenarios that produced real user-visible bugs
 * during the side-car refactor, so any future change that breaks the
 * contract should fail here before it ever ships to Vienna.
 */

import { describe, expect, it } from 'vitest';
import type { Project, ProjectSession } from '../types/app';
import {
  applyPromotions,
  buildOptimisticEntry,
  findCleanupIds,
  findProactivePromotions,
  isPlaceholderSummary,
  mergeOptimisticSessions,
  sweepTempIdsForProject,
  type OptimisticSessionMap,
} from './optimisticSessions';

// --- test fixtures -------------------------------------------------------

const makeProject = (name: string, overrides: Partial<Project> = {}): Project => ({
  name,
  displayName: name,
  fullPath: `/tmp/${name}`,
  sessions: [],
  cursorSessions: [],
  codexSessions: [],
  geminiSessions: [],
  ...overrides,
});

const makeServerSession = (id: string, summary: string | undefined): ProjectSession => ({
  id,
  summary,
  title: summary,
  lastActivity: '2026-04-10T00:00:00.000Z',
  createdAt: '2026-04-10T00:00:00.000Z',
  created_at: '2026-04-10T00:00:00.000Z',
});

// --- isPlaceholderSummary -------------------------------------------------

describe('isPlaceholderSummary', () => {
  it('treats empty strings as placeholder', () => {
    expect(isPlaceholderSummary('')).toBe(true);
    expect(isPlaceholderSummary('   ')).toBe(true);
  });

  it('treats undefined/null/non-string as non-placeholder', () => {
    expect(isPlaceholderSummary(undefined)).toBe(false);
    expect(isPlaceholderSummary(null)).toBe(false);
    expect(isPlaceholderSummary(42)).toBe(false);
  });

  it('treats backend placeholder strings as placeholder', () => {
    expect(isPlaceholderSummary('New Session')).toBe(true);
    expect(isPlaceholderSummary('Codex Session')).toBe(true);
    expect(isPlaceholderSummary('Gemini CLI Session')).toBe(true);
    expect(isPlaceholderSummary('Untitled Session')).toBe(true);
  });

  it('treats real user text as non-placeholder', () => {
    expect(isPlaceholderSummary('안녕')).toBe(false);
    expect(isPlaceholderSummary('hello world')).toBe(false);
    expect(isPlaceholderSummary('dkssud')).toBe(false);
  });
});

// --- mergeOptimisticSessions ---------------------------------------------

describe('mergeOptimisticSessions', () => {
  it('returns projectsRaw unchanged when side-car is empty', () => {
    const projects = [makeProject('foo')];
    const result = mergeOptimisticSessions(projects, {});
    expect(result).toBe(projects);
  });

  it('carries forward an optimistic row the server does not know about', () => {
    const projects = [makeProject('foo', { codexSessions: [] })];
    const sideCar: OptimisticSessionMap = {
      'new-session-1': buildOptimisticEntry(
        'foo',
        { id: 'new-session-1', summary: '안녕' },
        'codex',
      ),
    };
    const result = mergeOptimisticSessions(projects, sideCar);
    expect(result[0].codexSessions).toHaveLength(1);
    expect(result[0].codexSessions![0].id).toBe('new-session-1');
    expect(result[0].codexSessions![0].summary).toBe('안녕');
  });

  it('overlays user summary onto a placeholder server row with matching id', () => {
    const projects = [
      makeProject('foo', {
        codexSessions: [makeServerSession('abc', 'Codex Session')],
      }),
    ];
    const sideCar: OptimisticSessionMap = {
      abc: buildOptimisticEntry('foo', { id: 'abc', summary: 'dkssud' }, 'codex'),
    };
    const result = mergeOptimisticSessions(projects, sideCar);
    expect(result[0].codexSessions).toHaveLength(1);
    expect(result[0].codexSessions![0].id).toBe('abc');
    expect(result[0].codexSessions![0].summary).toBe('dkssud');
  });

  it('does NOT overlay when server row has a real summary', () => {
    const projects = [
      makeProject('foo', {
        codexSessions: [makeServerSession('abc', 'actual user text')],
      }),
    ];
    const sideCar: OptimisticSessionMap = {
      abc: buildOptimisticEntry('foo', { id: 'abc', summary: '안녕' }, 'codex'),
    };
    const result = mergeOptimisticSessions(projects, sideCar);
    expect(result[0].codexSessions![0].summary).toBe('actual user text');
  });

  it('dedupes by id when server already has the row', () => {
    const projects = [
      makeProject('foo', {
        codexSessions: [makeServerSession('abc', 'Codex Session')],
      }),
    ];
    const sideCar: OptimisticSessionMap = {
      abc: buildOptimisticEntry('foo', { id: 'abc', summary: 'dkssud' }, 'codex'),
    };
    const result = mergeOptimisticSessions(projects, sideCar);
    // Server had 1 row, side-car had 1 row with the same id → final count is 1,
    // not 2. This is the regression guard for the "두 개의 안녕" duplicate bug.
    expect(result[0].codexSessions).toHaveLength(1);
  });

  it('empty server summary also gets overlaid', () => {
    const projects = [
      makeProject('foo', {
        codexSessions: [makeServerSession('abc', '')],
      }),
    ];
    const sideCar: OptimisticSessionMap = {
      abc: buildOptimisticEntry('foo', { id: 'abc', summary: 'hi' }, 'codex'),
    };
    const result = mergeOptimisticSessions(projects, sideCar);
    expect(result[0].codexSessions![0].summary).toBe('hi');
  });

  it('routes optimistic entries into the correct provider bucket', () => {
    const projects = [makeProject('foo')];
    const sideCar: OptimisticSessionMap = {
      c1: buildOptimisticEntry('foo', { id: 'c1', summary: 'x' }, 'claude'),
      c2: buildOptimisticEntry('foo', { id: 'c2', summary: 'y' }, 'cursor'),
      c3: buildOptimisticEntry('foo', { id: 'c3', summary: 'z' }, 'codex'),
      c4: buildOptimisticEntry('foo', { id: 'c4', summary: 'w' }, 'gemini'),
    };
    const result = mergeOptimisticSessions(projects, sideCar);
    expect(result[0].sessions?.map((s) => s.id)).toContain('c1');
    expect(result[0].cursorSessions?.map((s) => s.id)).toContain('c2');
    expect(result[0].codexSessions?.map((s) => s.id)).toContain('c3');
    expect(result[0].geminiSessions?.map((s) => s.id)).toContain('c4');
  });

  it('does not leak optimistic rows into other projects', () => {
    const projects = [makeProject('foo'), makeProject('bar')];
    const sideCar: OptimisticSessionMap = {
      x: buildOptimisticEntry('foo', { id: 'x', summary: 'x' }, 'claude'),
    };
    const result = mergeOptimisticSessions(projects, sideCar);
    expect(result[0].sessions).toHaveLength(1);
    expect(result[1].sessions).toHaveLength(0);
  });
});

// --- findProactivePromotions ---------------------------------------------

describe('findProactivePromotions', () => {
  it('returns empty when side-car is empty', () => {
    expect(findProactivePromotions([makeProject('foo')], {})).toEqual([]);
  });

  it('promotes a tempId to a unique placeholder server row', () => {
    const projects = [
      makeProject('foo', {
        codexSessions: [makeServerSession('real-id', 'Codex Session')],
      }),
    ];
    const sideCar: OptimisticSessionMap = {
      'new-session-1': buildOptimisticEntry(
        'foo',
        { id: 'new-session-1', summary: 'hi' },
        'codex',
      ),
    };
    expect(findProactivePromotions(projects, sideCar)).toEqual([
      { tempId: 'new-session-1', realId: 'real-id' },
    ]);
  });

  it('promotes a non-temp optimistic entry when server id diverges', () => {
    // Regression: codex backend historically emitted session_created with a
    // fake `codex-${Date.now()}` id while the real file was later indexed
    // under a UUID. The side-car entry has the fake id and the extended
    // match rule should heal the drift.
    const projects = [
      makeProject('foo', {
        codexSessions: [makeServerSession('real-uuid', 'Codex Session')],
      }),
    ];
    const sideCar: OptimisticSessionMap = {
      'codex-1775748544559': buildOptimisticEntry(
        'foo',
        { id: 'codex-1775748544559', summary: 'dkssud' },
        'codex',
      ),
    };
    expect(findProactivePromotions(projects, sideCar)).toEqual([
      { tempId: 'codex-1775748544559', realId: 'real-uuid' },
    ]);
  });

  it('skips promotion when there are multiple placeholder candidates', () => {
    const projects = [
      makeProject('foo', {
        codexSessions: [
          makeServerSession('a', 'Codex Session'),
          makeServerSession('b', 'Codex Session'),
        ],
      }),
    ];
    const sideCar: OptimisticSessionMap = {
      'new-session-1': buildOptimisticEntry(
        'foo',
        { id: 'new-session-1', summary: 'hi' },
        'codex',
      ),
    };
    // Ambiguous match → we refuse to guess, wait for session_created.
    expect(findProactivePromotions(projects, sideCar)).toEqual([]);
  });

  it('skips promotion for entries the server already knows about', () => {
    const projects = [
      makeProject('foo', {
        codexSessions: [makeServerSession('abc', 'Codex Session')],
      }),
    ];
    const sideCar: OptimisticSessionMap = {
      abc: buildOptimisticEntry('foo', { id: 'abc', summary: 'hi' }, 'codex'),
    };
    expect(findProactivePromotions(projects, sideCar)).toEqual([]);
  });

  it('does not promote across buckets', () => {
    const projects = [
      makeProject('foo', {
        sessions: [makeServerSession('claude-id', 'New Session')],
      }),
    ];
    const sideCar: OptimisticSessionMap = {
      'new-session-1': buildOptimisticEntry(
        'foo',
        { id: 'new-session-1', summary: 'hi' },
        'codex',
      ),
    };
    // Claude placeholder row, but the side-car is codex → no match.
    expect(findProactivePromotions(projects, sideCar)).toEqual([]);
  });
});

// --- applyPromotions ------------------------------------------------------

describe('applyPromotions', () => {
  it('returns the same reference when no promotions', () => {
    const sideCar: OptimisticSessionMap = {
      x: buildOptimisticEntry('foo', { id: 'x', summary: 'hi' }, 'claude'),
    };
    expect(applyPromotions(sideCar, [])).toBe(sideCar);
  });

  it('renames tempId to realId in place', () => {
    const sideCar: OptimisticSessionMap = {
      'new-session-1': buildOptimisticEntry(
        'foo',
        { id: 'new-session-1', summary: '안녕' },
        'codex',
      ),
    };
    const result = applyPromotions(sideCar, [
      { tempId: 'new-session-1', realId: 'real-uuid' },
    ]);
    expect(result['new-session-1']).toBeUndefined();
    expect(result['real-uuid']).toBeDefined();
    expect(result['real-uuid'].session.id).toBe('real-uuid');
    expect(result['real-uuid'].session.summary).toBe('안녕');
  });

  it('drops tempId if realId already exists (duplicate guard)', () => {
    const sideCar: OptimisticSessionMap = {
      'new-session-1': buildOptimisticEntry(
        'foo',
        { id: 'new-session-1', summary: 'a' },
        'codex',
      ),
      'real-uuid': buildOptimisticEntry(
        'foo',
        { id: 'real-uuid', summary: 'b' },
        'codex',
      ),
    };
    const result = applyPromotions(sideCar, [
      { tempId: 'new-session-1', realId: 'real-uuid' },
    ]);
    expect(result['new-session-1']).toBeUndefined();
    // Existing realId entry kept; its summary NOT clobbered.
    expect(result['real-uuid'].session.summary).toBe('b');
  });
});

// --- findCleanupIds -------------------------------------------------------

describe('findCleanupIds', () => {
  it('removes side-car entry when server has real (non-placeholder) summary', () => {
    const projects = [
      makeProject('foo', {
        codexSessions: [makeServerSession('abc', 'actual text from user')],
      }),
    ];
    const sideCar: OptimisticSessionMap = {
      abc: buildOptimisticEntry('foo', { id: 'abc', summary: 'hi' }, 'codex'),
    };
    expect(findCleanupIds(projects, sideCar)).toEqual(['abc']);
  });

  it('keeps side-car entry when server summary is still a placeholder', () => {
    const projects = [
      makeProject('foo', {
        codexSessions: [makeServerSession('abc', 'Codex Session')],
      }),
    ];
    const sideCar: OptimisticSessionMap = {
      abc: buildOptimisticEntry('foo', { id: 'abc', summary: 'hi' }, 'codex'),
    };
    expect(findCleanupIds(projects, sideCar)).toEqual([]);
  });

  it('keeps side-car entry when server does not have the row', () => {
    const projects = [makeProject('foo')];
    const sideCar: OptimisticSessionMap = {
      abc: buildOptimisticEntry('foo', { id: 'abc', summary: 'hi' }, 'codex'),
    };
    expect(findCleanupIds(projects, sideCar)).toEqual([]);
  });

  it('keeps side-car entry when project is gone entirely', () => {
    const projects: Project[] = [];
    const sideCar: OptimisticSessionMap = {
      abc: buildOptimisticEntry('foo', { id: 'abc', summary: 'hi' }, 'codex'),
    };
    expect(findCleanupIds(projects, sideCar)).toEqual([]);
  });
});

// --- sweepTempIdsForProject ----------------------------------------------

describe('sweepTempIdsForProject', () => {
  it('removes only new-session-* entries for the given project', () => {
    const sideCar: OptimisticSessionMap = {
      'new-session-1': buildOptimisticEntry(
        'foo',
        { id: 'new-session-1', summary: 'a' },
        'codex',
      ),
      'new-session-2': buildOptimisticEntry(
        'bar',
        { id: 'new-session-2', summary: 'b' },
        'codex',
      ),
      'real-1': buildOptimisticEntry('foo', { id: 'real-1', summary: 'c' }, 'codex'),
    };
    const { next, removed } = sweepTempIdsForProject(sideCar, 'foo');
    expect(removed).toEqual(['new-session-1']);
    expect(next['new-session-1']).toBeUndefined();
    expect(next['new-session-2']).toBeDefined(); // different project
    expect(next['real-1']).toBeDefined(); // not temp
  });

  it('returns same reference when nothing to remove', () => {
    const sideCar: OptimisticSessionMap = {
      'real-1': buildOptimisticEntry('foo', { id: 'real-1', summary: 'c' }, 'codex'),
    };
    const { next } = sweepTempIdsForProject(sideCar, 'foo');
    expect(next).toBe(sideCar);
  });

  it('no-ops on empty projectName', () => {
    const sideCar: OptimisticSessionMap = {
      'new-session-1': buildOptimisticEntry(
        'foo',
        { id: 'new-session-1', summary: 'a' },
        'codex',
      ),
    };
    const { next, removed } = sweepTempIdsForProject(sideCar, '');
    expect(next).toBe(sideCar);
    expect(removed).toEqual([]);
  });
});

// --- buildOptimisticEntry ------------------------------------------------

describe('buildOptimisticEntry', () => {
  it('populates BOTH createdAt and created_at timestamps', () => {
    // Regression: cursor reads `createdAt`, claude reads `created_at`.
    // If only one is populated the sidebar shows "알 수 없음" for the other.
    const entry = buildOptimisticEntry(
      'foo',
      { id: 'id1', summary: 'hi' },
      'cursor',
    );
    expect(entry.session.createdAt).toBeTruthy();
    expect(entry.session.created_at).toBeTruthy();
    expect(entry.session.lastActivity).toBeTruthy();
    expect(entry.session.updated_at).toBeTruthy();
  });

  it('defaults provider to claude and routes to sessions bucket', () => {
    const entry = buildOptimisticEntry('foo', { id: 'id1', summary: 'hi' });
    expect(entry.bucketKey).toBe('sessions');
    expect(entry.session.__provider).toBe('claude');
  });

  it('routes codex provider to codexSessions bucket', () => {
    const entry = buildOptimisticEntry('foo', { id: 'id1', summary: 'hi' }, 'codex');
    expect(entry.bucketKey).toBe('codexSessions');
    expect(entry.session.__provider).toBe('codex');
  });

  it('marks the entry session as __optimistic', () => {
    const entry = buildOptimisticEntry('foo', { id: 'id1', summary: 'hi' }, 'claude');
    expect(entry.session.__optimistic).toBe(true);
  });
});

// --- end-to-end scenarios -------------------------------------------------

describe('end-to-end scenarios', () => {
  it('codex: submit → session_created (wrong id) → projects_updated → proactive promote → overlay → cleanup', () => {
    // 1. User submits "dkssud" in a new codex session.
    let sideCar: OptimisticSessionMap = {
      'new-session-1': buildOptimisticEntry(
        'foo',
        { id: 'new-session-1', summary: 'dkssud' },
        'codex',
      ),
    };
    let projectsRaw = [makeProject('foo')];

    // Sidebar shows the side-car row (server doesn't have it yet).
    let merged = mergeOptimisticSessions(projectsRaw, sideCar);
    expect(merged[0].codexSessions).toHaveLength(1);
    expect(merged[0].codexSessions![0].summary).toBe('dkssud');

    // 2. `session_created` arrives with an id that doesn't match what the
    //    file watcher will eventually index (pre-fix codex behaviour).
    //    The composer renames the side-car entry to that fake id via the
    //    hook's promoteOptimisticSession path.
    sideCar = applyPromotions(sideCar, [
      { tempId: 'new-session-1', realId: 'codex-fake-id' },
    ]);
    expect(sideCar['codex-fake-id']).toBeDefined();
    expect(sideCar['new-session-1']).toBeUndefined();

    // 3. `projects_updated` arrives with the REAL uuid the chokidar watcher
    //    found in the jsonl file. Different id than what session_created
    //    reported. Server summary is still the 'Codex Session' placeholder.
    projectsRaw = [
      makeProject('foo', {
        codexSessions: [makeServerSession('real-uuid', 'Codex Session')],
      }),
    ];

    // Merge at this point: two rows visible (fake-id from side-car +
    // real-uuid from server). This is the "duplicate codex session"
    // regression we want to heal.
    merged = mergeOptimisticSessions(projectsRaw, sideCar);
    expect(merged[0].codexSessions).toHaveLength(2);

    // 4. Proactive promotion runs. It sees the side-car entry under a
    //    non-acknowledged id and finds exactly one placeholder candidate
    //    in the same bucket → promote.
    const promotions = findProactivePromotions(projectsRaw, sideCar);
    expect(promotions).toEqual([{ tempId: 'codex-fake-id', realId: 'real-uuid' }]);
    sideCar = applyPromotions(sideCar, promotions);

    // 5. Merge again — now exactly one row, with the overlay applied so
    //    the user sees "dkssud" not "Codex Session".
    merged = mergeOptimisticSessions(projectsRaw, sideCar);
    expect(merged[0].codexSessions).toHaveLength(1);
    expect(merged[0].codexSessions![0].summary).toBe('dkssud');
    expect(merged[0].codexSessions![0].id).toBe('real-uuid');

    // 6. Server eventually parses the jsonl and upgrades the summary to
    //    the real user text. Smart cleanup now drops the side-car entry.
    projectsRaw = [
      makeProject('foo', {
        codexSessions: [makeServerSession('real-uuid', 'dkssud')],
      }),
    ];
    expect(findCleanupIds(projectsRaw, sideCar)).toEqual(['real-uuid']);
  });

  it('claude: submit → session_created (correct id) → projects_updated → overlay → cleanup', () => {
    // Claude's session_created is always correct because it waits for the
    // first streaming message's session_id. No id drift → no proactive
    // promotion needed.
    let sideCar: OptimisticSessionMap = {
      'new-session-A': buildOptimisticEntry(
        'foo',
        { id: 'new-session-A', summary: '안녕' },
        'claude',
      ),
    };
    sideCar = applyPromotions(sideCar, [
      { tempId: 'new-session-A', realId: 'claude-real-id' },
    ]);

    const projectsRaw = [
      makeProject('foo', {
        sessions: [makeServerSession('claude-real-id', 'New Session')],
      }),
    ];
    const merged = mergeOptimisticSessions(projectsRaw, sideCar);
    expect(merged[0].sessions).toHaveLength(1);
    expect(merged[0].sessions![0].summary).toBe('안녕'); // overlay applied
  });

  it('no accumulation across sessions', () => {
    // Regression: after cleanup was removed, each submission left an
    // entry in the side-car forever, producing multiple "안녕" rows in
    // the sidebar after testing several times.
    let sideCar: OptimisticSessionMap = {};

    // Submit + complete first session.
    sideCar = { ...sideCar, ...{
      'new-session-1': buildOptimisticEntry('foo', { id: 'new-session-1', summary: 'a' }, 'codex'),
    } };
    sideCar = applyPromotions(sideCar, [
      { tempId: 'new-session-1', realId: 'real-1' },
    ]);

    // Server acknowledges with real summary → cleanup should drop the entry.
    const projectsRaw = [
      makeProject('foo', {
        codexSessions: [makeServerSession('real-1', 'a')],
      }),
    ];
    const toRemove = findCleanupIds(projectsRaw, sideCar);
    expect(toRemove).toEqual(['real-1']);

    // After cleanup, side-car is empty.
    for (const id of toRemove) delete sideCar[id];
    expect(Object.keys(sideCar)).toHaveLength(0);
  });
});
