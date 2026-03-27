import path from 'path';
import os from 'os';
import { Session, getFileReadsFromTurn } from './parser.js';

export interface SessionMetrics {
  sessionId: string;
  projectSlug: string;
  projectName: string;
  slug: string;
  date: string;
  durationMinutes: number;

  // Metric 1: Turns-to-resolution
  userTurns: number;
  assistantTurns: number;

  // Metric 2: File revisit rate
  totalFileReads: number;
  uniqueFileReads: number;
  fileRevisitRate: number; // 0–1, higher = more thrashing

  // Metric 3: Memory utilization
  memoryFilesTotal: number;
  memoryFilesRead: number;
  memoryUtilization: number; // 0–1, higher = better

  // Metric 4: Context efficiency (cache hit ratio)
  totalInputTokens: number;
  cacheReadTokens: number;
  contextEfficiency: number; // 0–1, higher = better cache reuse

  totalOutputTokens: number;
  toolCallCount: number;
}

export interface ProjectRollup {
  projectSlug: string;
  projectName: string;
  sessionCount: number;
  avgUserTurns: number;
  avgFileRevisitRate: number;
  avgMemoryUtilization: number;
  avgContextEfficiency: number;
  healthScore: number; // 0–100
  sessions: SessionMetrics[];
}

function projectName(slug: string): string {
  // Convert -Users-mikewahl-local-projects-Foo-Bar → Foo-Bar
  return slug
    .replace(/^-Users-[^-]+-local-projects-/, '')
    .replace(/^-Users-[^-]+-Library-[^-]+-[^-]+-[^-]+-[^-]+-projects-/, '')
    .replace(/^-Users-[^-]+-/, '')
    .replace(/-/g, ' ')
    .trim() || slug;
}

function durationMinutes(start: string, end: string): number {
  if (!start || !end) return 0;
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
}

export function computeSessionMetrics(session: Session): SessionMetrics {
  const memoryDir = path.join(os.homedir(), '.claude', 'projects', session.projectSlug, 'memory');

  // Turns
  const userTurns = session.turns.filter(t => t.role === 'user').length;
  const assistantTurns = session.turns.filter(t => t.role === 'assistant').length;

  // File reads
  const allReads: string[] = [];
  for (const turn of session.turns) {
    allReads.push(...getFileReadsFromTurn(turn));
  }
  const uniqueReads = new Set(allReads);
  const totalFileReads = allReads.length;
  const uniqueFileReads = uniqueReads.size;
  const fileRevisitRate = totalFileReads > 0
    ? parseFloat(((totalFileReads - uniqueFileReads) / totalFileReads).toFixed(3))
    : 0;

  // Memory utilization — what fraction of memory files were read this session
  const memoryFilesTotal = session.memoryFiles.length;
  const memoryFilesRead = session.turns.reduce((acc, turn) => {
    for (const tc of turn.toolCalls) {
      if (tc.name === 'Read') {
        const fp = tc.input.file_path as string ?? '';
        if (fp.includes('/memory/') && fp.endsWith('.md')) acc++;
      }
    }
    return acc;
  }, 0);
  const memoryUtilization = memoryFilesTotal > 0
    ? parseFloat((memoryFilesRead / memoryFilesTotal).toFixed(3))
    : 0;

  // Context efficiency — cache read ratio
  let totalInputTokens = 0;
  let cacheReadTokens = 0;
  let totalOutputTokens = 0;
  for (const turn of session.turns) {
    if (turn.usage) {
      totalInputTokens += turn.usage.input_tokens + turn.usage.cache_read_input_tokens;
      cacheReadTokens += turn.usage.cache_read_input_tokens;
      totalOutputTokens += turn.usage.output_tokens;
    }
  }
  const contextEfficiency = totalInputTokens > 0
    ? parseFloat((cacheReadTokens / totalInputTokens).toFixed(3))
    : 0;

  // Tool call count
  const toolCallCount = session.turns.reduce((acc, t) => acc + t.toolCalls.length, 0);

  return {
    sessionId: session.id,
    projectSlug: session.projectSlug,
    projectName: projectName(session.projectSlug),
    slug: session.slug,
    date: session.startTime ? session.startTime.split('T')[0] : '',
    durationMinutes: durationMinutes(session.startTime, session.endTime),
    userTurns,
    assistantTurns,
    totalFileReads,
    uniqueFileReads,
    fileRevisitRate,
    memoryFilesTotal,
    memoryFilesRead,
    memoryUtilization,
    totalInputTokens,
    cacheReadTokens,
    contextEfficiency,
    totalOutputTokens,
    toolCallCount,
  };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return parseFloat((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(3));
}

export function rollupByProject(sessions: SessionMetrics[]): ProjectRollup[] {
  const byProject = new Map<string, SessionMetrics[]>();
  for (const s of sessions) {
    const arr = byProject.get(s.projectSlug) ?? [];
    arr.push(s);
    byProject.set(s.projectSlug, arr);
  }

  const rollups: ProjectRollup[] = [];
  for (const [slug, projectSessions] of byProject) {
    const avgTurns = avg(projectSessions.map(s => s.userTurns));
    const avgRevisit = avg(projectSessions.map(s => s.fileRevisitRate));
    const avgMemory = avg(projectSessions.map(s => s.memoryUtilization));
    const avgEfficiency = avg(projectSessions.map(s => s.contextEfficiency));

    // Health score: higher is better
    // - Low revisit rate (0 = great, 1 = bad) → invert
    // - High memory utilization (1 = great)
    // - High context efficiency (1 = great)
    // - Low turns relative to avg (normalize 1–20 range, invert)
    const revisitScore = (1 - avgRevisit) * 100;
    const memoryScore = avgMemory * 100;
    const efficiencyScore = avgEfficiency * 100;
    const turnsScore = Math.max(0, 100 - (avgTurns / 20) * 100);
    const healthScore = Math.round((revisitScore + memoryScore + efficiencyScore + turnsScore) / 4);

    rollups.push({
      projectSlug: slug,
      projectName: projectSessions[0].projectName,
      sessionCount: projectSessions.length,
      avgUserTurns: avgTurns,
      avgFileRevisitRate: avgRevisit,
      avgMemoryUtilization: avgMemory,
      avgContextEfficiency: avgEfficiency,
      healthScore,
      sessions: projectSessions.sort((a, b) => a.date.localeCompare(b.date)),
    });
  }

  return rollups.sort((a, b) => b.healthScore - a.healthScore);
}
