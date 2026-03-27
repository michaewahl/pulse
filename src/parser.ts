import fs from 'fs';
import path from 'path';
import os from 'os';

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface Turn {
  uuid: string;
  role: 'user' | 'assistant';
  timestamp: string;
  toolCalls: ToolCall[];
  usage?: {
    input_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
    output_tokens: number;
  };
}

export interface Session {
  id: string;
  projectSlug: string;
  projectPath: string;
  slug: string;
  startTime: string;
  endTime: string;
  turns: Turn[];
  memoryFiles: string[];
}

const FILE_READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const MEMORY_PATH_PATTERN = /\.claude\/projects\/[^/]+\/memory\//;

export function parseSession(jsonlPath: string, projectSlug: string): Session | null {
  let raw: string;
  try {
    raw = fs.readFileSync(jsonlPath, 'utf-8');
  } catch {
    return null;
  }

  const lines = raw.split('\n').filter(Boolean);
  const turns: Turn[] = [];
  let sessionId = '';
  let slug = '';
  let projectPath = '';

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const type = obj.type as string;
    if (type !== 'user' && type !== 'assistant') continue;

    if (!sessionId && obj.sessionId) sessionId = obj.sessionId as string;
    if (!slug && obj.slug) slug = obj.slug as string;
    if (!projectPath && obj.cwd) projectPath = obj.cwd as string;

    const uuid = obj.uuid as string;
    const timestamp = obj.timestamp as string;
    const message = obj.message as Record<string, unknown>;
    if (!message) continue;

    const content = message.content as Array<Record<string, unknown>> | undefined;

    // Skip tool result callbacks — these are type:"user" but contain tool results,
    // not actual human messages. Only count turns with text content as human turns.
    const isToolResult = Array.isArray(content) &&
      content.some(b => b.type === 'tool_result');
    if (type === 'user' && isToolResult) continue;

    const role = type as 'user' | 'assistant';
    const toolCalls: ToolCall[] = [];
    let usage: Turn['usage'] | undefined;

    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_use') {
          toolCalls.push({
            name: block.name as string,
            input: (block.input as Record<string, unknown>) ?? {},
          });
        }
      }
    }

    if (role === 'assistant' && message.usage) {
      const u = message.usage as Record<string, number>;
      usage = {
        input_tokens: u.input_tokens ?? 0,
        cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
        output_tokens: u.output_tokens ?? 0,
      };
    }

    turns.push({ uuid, role, timestamp, toolCalls, usage });
  }

  if (turns.length === 0) return null;

  const timestamps = turns.map(t => t.timestamp).filter(Boolean).sort();

  // Find memory files for this project
  const memoryDir = path.join(os.homedir(), '.claude', 'projects', projectSlug, 'memory');
  let memoryFiles: string[] = [];
  try {
    memoryFiles = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'));
  } catch {
    // no memory dir
  }

  return {
    id: sessionId || path.basename(jsonlPath, '.jsonl'),
    projectSlug,
    projectPath,
    slug,
    startTime: timestamps[0] ?? '',
    endTime: timestamps[timestamps.length - 1] ?? '',
    turns,
    memoryFiles,
  };
}

export function loadAllSessions(scopeProject?: string): Session[] {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  const sessions: Session[] = [];

  let projectSlugs: string[];
  try {
    projectSlugs = fs.readdirSync(projectsDir).filter(d =>
      fs.statSync(path.join(projectsDir, d)).isDirectory()
    );
  } catch {
    return [];
  }

  for (const slug of projectSlugs) {
    const projDir = path.join(projectsDir, slug);

    // If scoping, match against the cwd-encoded slug
    if (scopeProject) {
      const cwdSlug = scopeProject.replace(/\//g, '-').replace(/^-/, '');
      if (!slug.toLowerCase().includes(cwdSlug.toLowerCase().slice(-20))) continue;
    }

    const files = fs.readdirSync(projDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const session = parseSession(path.join(projDir, file), slug);
      if (session) sessions.push(session);
    }
  }

  return sessions.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function getFileReadsFromTurn(turn: Turn): string[] {
  return turn.toolCalls
    .filter(tc => FILE_READ_TOOLS.has(tc.name))
    .map(tc => {
      if (tc.name === 'Read') return tc.input.file_path as string ?? '';
      if (tc.name === 'Grep') return (tc.input.path as string) ?? '';
      if (tc.name === 'Glob') return (tc.input.pattern as string) ?? '';
      return '';
    })
    .filter(Boolean);
}
