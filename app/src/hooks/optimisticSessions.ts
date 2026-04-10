/**
 * Pure logic for the optimistic-session side-car used by `useProjectsState`.
 *
 * This module is intentionally free of React and DOM so every piece can be
 * unit-tested in isolation. `useProjectsState` owns the React state and
 * timers; these functions own the reasoning about what the merged projects
 * list should look like, which entries need to be promoted, and which
 * entries the server has confirmed with a real (non-placeholder) summary.
 *
 * See `useProjectsState.ts` for the long-form rationale behind the
 * side-car architecture. Quick recap:
 *
 *   projectsRaw  — server payload as-is (WS broadcasts + REST fetches)
 *   optimisticSessions — local map of user-initiated session rows that
 *                        exist outside of `projectsRaw` so nothing can
 *                        wipe them accidentally
 *   projects     — useMemo result produced by `mergeOptimisticSessions`,
 *                  what the sidebar actually renders
 */

import type { Project, ProjectSession } from '../types/app';

/**
 * Provider bucket on `Project`. Each provider's sessions live in their own
 * array so the sidebar can render the correct icon; the optimistic row
 * needs to go into the right one.
 */
export type BucketKey = 'sessions' | 'cursorSessions' | 'codexSessions' | 'geminiSessions';

export type OptimisticEntry = {
  projectName: string;
  bucketKey: BucketKey;
  session: ProjectSession;
};

export type OptimisticSessionMap = Record<string, OptimisticEntry>;

/**
 * Backend placeholder summaries. See `useProjectsState.ts` for the full
 * story — briefly, `app/server/projects.js` seeds new sessions with these
 * literal English strings before it parses the first user turn out of the
 * jsonl file, and the sidebar should show the real user text instead.
 */
export const BACKEND_PLACEHOLDER_SUMMARIES: ReadonlySet<string> = new Set([
  'New Session',
  'Codex Session',
  'Gemini CLI Session',
  'Untitled Session',
]);

export const isPlaceholderSummary = (summary: unknown): boolean => {
  if (typeof summary !== 'string') return false;
  const trimmed = summary.trim();
  if (trimmed === '') return true;
  return BACKEND_PLACEHOLDER_SUMMARIES.has(trimmed);
};

/**
 * Flatten the four provider buckets of a project into a single list.
 *
 * Mirrors `getAllSessions` in `sidebar/utils/utils.ts` but without the
 * provider-tag rewrite so we can use it for id lookups.
 */
export const flattenProjectSessions = (project: Project): ProjectSession[] => {
  return [
    ...(project.sessions ?? []),
    ...(project.cursorSessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.geminiSessions ?? []),
  ];
};

/**
 * Produce the merged `projects` array the sidebar renders.
 *
 * Two things happen here:
 *
 * 1. **Summary overlay.** If the server row for a given id exists but
 *    its summary is a placeholder (empty or one of
 *    `BACKEND_PLACEHOLDER_SUMMARIES`), paint the optimistic entry's
 *    summary onto it. This gives the sidebar the user's own text
 *    instead of the generic "New Session" / "Codex Session" strings
 *    that the backend emits while the file is still being parsed.
 *
 * 2. **Carry-forward.** If the server doesn't yet contain a row for
 *    an optimistic entry's id, inject that entry into its bucket so
 *    the row stays on screen. Once the server acknowledges the id the
 *    `existingIds` check dedupes and we stop inserting from the side-car.
 */
export const mergeOptimisticSessions = (
  projectsRaw: Project[],
  optimisticSessions: OptimisticSessionMap,
): Project[] => {
  const entries = Object.values(optimisticSessions);
  if (entries.length === 0) return projectsRaw;

  const byProject = new Map<string, Map<BucketKey, ProjectSession[]>>();
  const entryById = new Map<string, OptimisticEntry>();
  for (const entry of entries) {
    entryById.set(entry.session.id, entry);
    let bucketMap = byProject.get(entry.projectName);
    if (!bucketMap) {
      bucketMap = new Map();
      byProject.set(entry.projectName, bucketMap);
    }
    const list = bucketMap.get(entry.bucketKey) ?? [];
    list.push(entry.session);
    bucketMap.set(entry.bucketKey, list);
  }

  return projectsRaw.map((project) => {
    const overlaySummary = (list: ProjectSession[] | undefined) => {
      if (!list || list.length === 0 || entryById.size === 0) return list;
      let mutated = false;
      const next = list.map((session) => {
        const entry = entryById.get(session.id);
        if (!entry) return session;
        const optimisticSummary =
          typeof entry.session.summary === 'string' ? entry.session.summary.trim() : '';
        if (!optimisticSummary) return session;
        if (!isPlaceholderSummary(session.summary)) return session;
        mutated = true;
        return { ...session, summary: optimisticSummary, title: optimisticSummary };
      });
      return mutated ? next : list;
    };

    const overlaid: Project = {
      ...project,
      sessions: overlaySummary(project.sessions) ?? project.sessions,
      cursorSessions: overlaySummary(project.cursorSessions) ?? project.cursorSessions,
      codexSessions: overlaySummary(project.codexSessions) ?? project.codexSessions,
      geminiSessions: overlaySummary(project.geminiSessions) ?? project.geminiSessions,
    };

    const bucketMap = byProject.get(project.name);
    if (!bucketMap) return overlaid;

    const existingIds = new Set<string>();
    for (const session of flattenProjectSessions(overlaid)) {
      existingIds.add(session.id);
    }

    const next: Project = overlaid;
    for (const [bucketKey, rows] of bucketMap) {
      const needed = rows.filter((row) => !existingIds.has(row.id));
      if (needed.length === 0) continue;
      const existing = (overlaid[bucketKey] as ProjectSession[] | undefined) ?? [];
      (next as unknown as Record<string, ProjectSession[]>)[bucketKey] = [...needed, ...existing];
    }
    return next;
  });
};

export type Promotion = { tempId: string; realId: string };

/**
 * Scan the latest server payload for rows that the side-car should be
 * promoted onto. Used when a `projects_updated` payload arrives with a
 * freshly-created session before `session_created` has fired, OR when
 * the provider backend emits a fake id in `session_created` and the
 * real row later shows up under a different id (historically: codex).
 *
 * Rule: for each optimistic entry whose id the server does not yet know,
 * look in the same project+bucket for server rows with placeholder
 * summaries that are not already tracked by the side-car. If **exactly
 * one** such candidate exists, promote the entry's tempId to that id.
 * We require exactly one so multi-session races don't misroute.
 */
export const findProactivePromotions = (
  projectsRaw: Project[],
  optimisticSessions: OptimisticSessionMap,
): Promotion[] => {
  const serverIdsByProject = new Map<string, Set<string>>();
  for (const project of projectsRaw) {
    const ids = new Set<string>();
    for (const session of flattenProjectSessions(project)) {
      ids.add(session.id);
    }
    serverIdsByProject.set(project.name, ids);
  }

  const pendingEntries = Object.entries(optimisticSessions).filter(([id, entry]) => {
    const serverIds = serverIdsByProject.get(entry.projectName);
    if (serverIds && serverIds.has(id)) return false;
    return true;
  });
  if (pendingEntries.length === 0) return [];

  const promotions: Promotion[] = [];
  for (const [tempId, entry] of pendingEntries) {
    const project = projectsRaw.find((p) => p.name === entry.projectName);
    if (!project) continue;
    const bucket = (project[entry.bucketKey] as ProjectSession[] | undefined) ?? [];
    if (bucket.length === 0) continue;

    const candidates = bucket.filter(
      (row) => isPlaceholderSummary(row.summary) && !(row.id in optimisticSessions),
    );
    if (candidates.length !== 1) continue;

    const realId = candidates[0].id;
    if (realId === tempId) continue;
    promotions.push({ tempId, realId });
  }

  return promotions;
};

/**
 * Apply the promotions from `findProactivePromotions` to a side-car map.
 * Returns a new map if anything changed, otherwise returns the original
 * reference (so React can skip the re-render).
 */
export const applyPromotions = (
  optimisticSessions: OptimisticSessionMap,
  promotions: Promotion[],
): OptimisticSessionMap => {
  if (promotions.length === 0) return optimisticSessions;
  let changed = false;
  const next: OptimisticSessionMap = { ...optimisticSessions };
  for (const { tempId, realId } of promotions) {
    const entry = next[tempId];
    if (!entry) continue;
    if (next[realId]) {
      // Guard: realId already in side-car. Drop the temp so we never
      // render two rows for the same logical session.
      delete next[tempId];
      changed = true;
      continue;
    }
    delete next[tempId];
    next[realId] = { ...entry, session: { ...entry.session, id: realId } };
    changed = true;
  }
  return changed ? next : optimisticSessions;
};

/**
 * Find side-car ids that the server has acknowledged with a **real**
 * (non-placeholder) summary. These entries are no longer needed — the
 * overlay has nothing to contribute once the server has parsed the real
 * summary — so they can be dropped from the side-car map.
 *
 * This is intentionally conservative: while the server is still showing
 * a placeholder summary we keep the side-car entry alive so the overlay
 * can paint the user text, and so transient "row dropped" payloads still
 * have a fallback.
 */
export const findCleanupIds = (
  projectsRaw: Project[],
  optimisticSessions: OptimisticSessionMap,
): string[] => {
  const entries = Object.entries(optimisticSessions);
  if (entries.length === 0) return [];

  const toRemove: string[] = [];
  for (const [id, entry] of entries) {
    const project = projectsRaw.find((p) => p.name === entry.projectName);
    if (!project) continue;
    const serverRow = flattenProjectSessions(project).find((s) => s.id === id);
    if (!serverRow) continue;
    if (isPlaceholderSummary(serverRow.summary)) continue;
    toRemove.push(id);
  }
  return toRemove;
};

/**
 * Remove any leftover `new-session-*` temp entries for a given project.
 * Called from the `session_created` handler as a belt-and-suspenders
 * cleanup in case the exact-tempId promote path didn't catch one.
 */
export const sweepTempIdsForProject = (
  optimisticSessions: OptimisticSessionMap,
  projectName: string,
): { next: OptimisticSessionMap; removed: string[] } => {
  if (!projectName) return { next: optimisticSessions, removed: [] };
  const removed: string[] = [];
  const next: OptimisticSessionMap = {};
  for (const [id, entry] of Object.entries(optimisticSessions)) {
    if (entry.projectName === projectName && id.startsWith('new-session-')) {
      removed.push(id);
      continue;
    }
    next[id] = entry;
  }
  if (removed.length === 0) return { next: optimisticSessions, removed: [] };
  return { next, removed };
};

/**
 * Build a brand-new optimistic entry for the composer's submission path.
 * Timestamps are populated on BOTH `createdAt` (camelCase, cursor/codex)
 * and `created_at` (snake_case, claude) plus `lastActivity` so every
 * sidebar code path can read a valid date and `formatTimeAgo` never has
 * to fall back to "알 수 없음".
 */
export const buildOptimisticEntry = (
  projectName: string,
  sessionMeta: { id: string; summary?: string; lastActivity?: string },
  provider?: string,
): OptimisticEntry => {
  const bucketByProvider: Record<string, BucketKey> = {
    claude: 'sessions',
    cursor: 'cursorSessions',
    codex: 'codexSessions',
    gemini: 'geminiSessions',
  };
  const providerKey = (provider ?? 'claude') as ProjectSession['__provider'];
  const bucketKey = bucketByProvider[providerKey ?? 'claude'] ?? 'sessions';
  const now = sessionMeta.lastActivity || new Date().toISOString();
  const session: ProjectSession = {
    id: sessionMeta.id,
    summary: sessionMeta.summary,
    title: sessionMeta.summary,
    lastActivity: now,
    createdAt: now,
    created_at: now,
    updated_at: now,
    __provider: providerKey,
    __optimistic: true,
  };
  return { projectName, bucketKey, session };
};
