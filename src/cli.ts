#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadAllSessions } from './parser.js';
import { computeSessionMetrics, rollupByProject } from './metrics.js';
import { generateReport } from './report.js';

const program = new Command();

program
  .name('pulse')
  .description('Agent health monitor for Claude Code sessions')
  .version('0.1.0');

program
  .command('analyze')
  .description('Parse Claude Code sessions and generate a health report')
  .option('-o, --output <file>', 'Output HTML file', 'pulse-report.html')
  .option('-p, --project <path>', 'Scope to a specific project path')
  .option('--open', 'Open the report in your browser after generating')
  .action(async (opts) => {
    console.log('pulse — scanning Claude Code sessions...\n');

    const sessions = loadAllSessions(opts.project);
    if (sessions.length === 0) {
      console.error('No sessions found in ~/.claude/projects');
      process.exit(1);
    }

    console.log(`  Found ${sessions.length} sessions across ${new Set(sessions.map(s => s.projectSlug)).size} projects`);

    const metrics = sessions.map(computeSessionMetrics);
    const rollups = rollupByProject(metrics);

    const html = generateReport(rollups, new Date());
    const outPath = path.resolve(opts.output);
    fs.writeFileSync(outPath, html, 'utf-8');

    console.log(`\n  Report written → ${outPath}`);
    console.log('\n  Top projects by health score:');
    for (const p of rollups.slice(0, 5)) {
      const bar = '█'.repeat(Math.round(p.healthScore / 10));
      const color = p.healthScore >= 70 ? '\x1b[32m' : p.healthScore >= 40 ? '\x1b[33m' : '\x1b[31m';
      console.log(`  ${color}${String(p.healthScore).padStart(3)}\x1b[0m  ${bar.padEnd(10)}  ${p.projectName} (${p.sessionCount} sessions)`);
    }

    console.log(`\n  Run: open ${outPath}`);

    if (opts.open) {
      const { default: open } = await import('open');
      await open(outPath);
    }
  });

program
  .command('report')
  .description('Open the last generated pulse-report.html')
  .option('-f, --file <path>', 'Report file to open', 'pulse-report.html')
  .action(async (opts) => {
    const filePath = path.resolve(opts.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Report not found: ${filePath}\nRun "pulse analyze" first.`);
      process.exit(1);
    }
    const { default: open } = await import('open');
    await open(filePath);
    console.log(`Opened ${filePath}`);
  });

program
  .command('stats')
  .description('Print quick stats to the terminal without generating a report')
  .action(() => {
    const sessions = loadAllSessions();
    if (sessions.length === 0) {
      console.error('No sessions found.');
      process.exit(1);
    }
    const metrics = sessions.map(computeSessionMetrics);
    const rollups = rollupByProject(metrics);

    console.log('\npulse — quick stats\n');
    console.log(`  Sessions:  ${sessions.length}`);
    console.log(`  Projects:  ${rollups.length}`);
    console.log('');
    console.log('  Project                          Sessions  Health  Turns  Revisit  CacheEff');
    console.log('  ' + '─'.repeat(75));
    for (const p of rollups) {
      const name = p.projectName.slice(0, 30).padEnd(30);
      const score = String(p.healthScore).padStart(6);
      const turns = p.avgUserTurns.toFixed(1).padStart(7);
      const revisit = `${Math.round(p.avgFileRevisitRate * 100)}%`.padStart(9);
      const eff = `${Math.round(p.avgContextEfficiency * 100)}%`.padStart(9);
      const count = String(p.sessionCount).padStart(8);
      console.log(`  ${name}  ${count}  ${score}  ${turns}  ${revisit}  ${eff}`);
    }
    console.log('');
  });

program.parse();
