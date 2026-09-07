#!/usr/bin/env node
// Batch dispatcher: runs the noAir ticket pipeline on the refined backlog.
//
// Source of truth is the `refine-ticket` skill output in `.opencode/plans/`:
// the README.md index lists every ticket; each ready ticket has a file
// `<id>-<slug>.md` whose front-matter carries status/priority/type.
//
// For every runnable ticket (status `ready`, or `failed` with --include-failed)
// the dispatcher:
//   1. creates an isolated git worktree + branch ticket/<id> from master
//   2. copies gitignored secrets (.env, docs/credentials.local.md) so agents
//      can build/test, plus the ticket + index into the worktree
//   3. runs the global `ticket-fix` opencode agent headless in that worktree
//      with the ticket attached (--auto approves non-denied permissions)
//   4. on success pushes the branch and opens a PR via `gh`, then moves the
//      ticket ready -> in-progress -> pr-open in both the file and the index
//   5. on failure marks the ticket `failed` with a reason
//
// Safe by default: prints a plan (dry-run) unless --run is passed.
//
//   node scripts/dispatch-tickets.mjs                    # dry-run
//   node scripts/dispatch-tickets.mjs --run              # all ready tickets
//   node scripts/dispatch-tickets.mjs --run --only T-001
//   node scripts/dispatch-tickets.mjs --run --priority P1 --concurrency 3
//   node scripts/dispatch-tickets.mjs --run --no-pr      # implement, keep worktree
//
// Worktrees live under .worktrees/<id> (gitignored). Transcripts land in
// .worktrees/.logs/<id>.jsonl. Run from the repo root with a clean master;
// agents branch from the local `master` ref.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, createWriteStream, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plansDir = path.join(root, '.opencode', 'plans');
const indexFile = path.join(plansDir, 'README.md');
const wtBase = path.join(root, '.worktrees');
const logsDir = path.join(wtBase, '.logs');
const baseBranch = 'master';
const agentName = 'ticket-fix';
const today = () => new Date().toISOString().slice(0, 10);

function parseFlags(argv) {
  const f = { run: false, only: null, priority: null, status: 'ready', concurrency: 2, keepFailed: false, noPr: false, includeFailed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--run': f.run = true; break;
      case '--dry-run': f.run = false; break;
      case '--only': f.only = argv[++i]; break;
      case '--priority': f.priority = argv[++i]; break;
      case '--status': f.status = argv[++i]; break;
      case '--concurrency': f.concurrency = parseInt(argv[++i], 10) || 2; break;
      case '--keep-failed': f.keepFailed = true; break;
      case '--no-pr': f.noPr = true; break;
      case '--include-failed': f.includeFailed = true; break;
      default:
        if (a === '-h' || a === '--help') {
          console.log('dispatch-tickets.mjs — run one implementer agent per refined ticket');
          console.log('  flags: --run  --only <id>  --priority <P0..P3>  --status <s>  --concurrency <n>');
          console.log('         --keep-failed  --no-pr  --include-failed  --dry-run (default)');
          process.exit(0);
        }
        console.error(`Unknown flag: ${a}`);
        process.exit(1);
    }
  }
  if (Number.isNaN(f.concurrency) || f.concurrency < 1) f.concurrency = 1;
  return f;
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd || root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function runAsync(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd || root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    if (opts.outFile) {
      const ws = createWriteStream(opts.outFile, { flags: 'a' });
      child.stdout.pipe(ws);
    } else {
      child.stdout.on('data', (d) => (out += d));
    }
    let err = '';
    if (opts.errFile) {
      const es = createWriteStream(opts.errFile, { flags: 'a' });
      child.stderr.pipe(es);
    } else {
      child.stderr.on('data', (d) => (err += d));
    }
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

// --- .opencode/plans parsing -------------------------------------------------

function parseFrontMatter(text) {
  const data = {};
  const ls = text.split('\n');
  if (ls[0].trim() !== '---') return { data, end: -1 };
  let end = -1;
  for (let i = 1; i < ls.length; i++) {
    if (ls[i].trim() === '---') { end = i; break; }
    const m = ls[i].match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (m) {
      let v = m[2].trim().replace(/^["']|["']$/g, '');
      v = v.replace(/\s+#.*$/, '');
      data[m[1]] = v;
    }
  }
  return { data, end };
}

function setFrontMatterField(file, updates) {
  const text = readFileSync(file, 'utf8');
  const ls = text.split('\n');
  if (ls[0].trim() !== '---') throw new Error(`No front matter in ${file}`);
  let end = -1;
  for (let i = 1; i < ls.length; i++) {
    if (ls[i].trim() === '---') { end = i; break; }
  }
  if (end < 0) throw new Error(`Unterminated front matter in ${file}`);
  for (const [key, value] of Object.entries(updates)) {
    let replaced = false;
    for (let j = 1; j < end; j++) {
      if (ls[j].match(new RegExp(`^${key}:`))) {
        ls[j] = `${key}: ${value}`;
        replaced = true;
        break;
      }
    }
    if (!replaced) { ls.splice(end, 0, `${key}: ${value}`); end++; }
  }
  writeFileSync(file, ls.join('\n'));
}

function parseIndex(text) {
  const ls = text.split('\n');
  let headerIdx = -1;
  let cols = [];
  for (let i = 0; i < ls.length; i++) {
    const cells = ls[i].split('|').map((c) => c.trim().toLowerCase());
    if (cells.some((c) => c === 'id') && cells.some((c) => c === 'file')) {
      headerIdx = i; cols = cells.filter(Boolean); break;
    }
  }
  if (headerIdx < 0) return [];
  const rows = [];
  for (let i = headerIdx + 1; i < ls.length; i++) {
    const line = ls[i];
    if (!line.includes('|')) continue;
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    if (!cells.some(Boolean)) continue;
    if (cells.every((c) => /^[-:]+$/.test(c))) continue;
    const row = {};
    cells.forEach((c, idx) => { row[cols[idx] || `c${idx}`] = c; });
    rows.push({ raw: line.trim(), row });
  }
  return rows;
}

function rewriteIndexRow(id, newStatus) {
  const text = readFileSync(indexFile, 'utf8');
  const rows = parseIndex(text);
  const hit = rows.find((r) => r.row.id === id);
  if (!hit) return;
  const { id: _i, ...rest } = hit.row;
  const order = Object.keys(hit.row);
  const cells = [];
  for (const k of order) {
    if (k === 'status') cells.push(newStatus);
    else cells.push(hit.row[k]);
  }
  const newLine = '| ' + cells.join(' | ') + ' |';
  writeFileSync(indexFile, text.replace(hit.raw, newLine));
}

// --- candidate selection ------------------------------------------------------

function loadCandidates(flags) {
  if (!existsSync(indexFile)) {
    console.log(`No ticket index at ${path.relative(root, indexFile)} — refine tickets first (refine-ticket skill).`);
    return [];
  }
  const runnable = new Set([flags.status]);
  if (flags.includeFailed) runnable.add('failed');
  const rows = parseIndex(readFileSync(indexFile, 'utf8'));
  const out = [];
  for (const r of rows) {
    const { id, status, priority, file } = r.row;
    if (!id || !file || file === '—' || file === '-') continue;
    if (flags.only && id !== flags.only) continue;
    const ticketPath = path.join(plansDir, file);
    if (!existsSync(ticketPath)) { console.warn(`skip ${id}: file missing ${file}`); continue; }
    const fm = parseFrontMatter(readFileSync(ticketPath, 'utf8')).data;
    if (!runnable.has(fm.status || status)) continue;
    if (flags.priority && fm.priority !== flags.priority) continue;
    out.push({ id: fm.id || id, title: fm.title || r.row.ticket || id, priority: fm.priority, type: fm.type, file, ticketPath });
  }
  return out;
}

// --- worktree plumbing --------------------------------------------------------

function worktreeExists(id) {
  const r = sh('git', ['worktree', 'list', '--porcelain'], { cwd: root });
  return r.out.split('\n').some((l) => l.startsWith('worktree ') && l.endsWith(path.join('.worktrees', id)));
}

function removeWorktree(wtDir) {
  const rel = path.relative(root, wtDir);
  const r = sh('git', ['worktree', 'remove', '--force', rel], { cwd: root });
  if (r.code !== 0 && existsSync(wtDir)) rmSync(wtDir, { recursive: true, force: true });
}

function setupWorktree(id) {
  const wtDir = path.join(wtBase, id);
  const branch = `ticket/${id}`;
  if (worktreeExists(id) || existsSync(wtDir)) removeWorktree(wtDir);
  const local = sh('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root });
  const remote = sh('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], { cwd: root });
  if (remote.code === 0) throw new Error(`branch origin/${branch} already pushed — not re-dispatching`);
  if (local.code === 0) sh('git', ['branch', '-D', branch], { cwd: root });
  const add = sh('git', ['worktree', 'add', path.relative(root, wtDir), '-b', branch, baseBranch], { cwd: root });
  if (add.code !== 0) throw new Error(`worktree add failed: ${add.err || add.out}`);
  mkdirSync(wtDir, { recursive: true });
  return { wtDir, branch };
}

function copySecrets(wtDir) {
  for (const rel of ['.env', 'docs/credentials.local.md']) {
    const src = path.join(root, rel);
    if (existsSync(src)) copyFileSync(src, path.join(wtDir, rel));
  }
}

function stageTicket(wtDir, cand) {
  const target = path.join(wtDir, '.opencode', 'plans');
  mkdirSync(target, { recursive: true });
  copyFileSync(cand.ticketPath, path.join(target, cand.file));
  copyFileSync(indexFile, path.join(target, 'README.md'));
  return path.join(target, cand.file);
}

// --- status transitions --------------------------------------------------------

function moveTicket(cand, status, extra = {}) {
  const updates = { status, updated: today(), ...extra };
  setFrontMatterField(cand.ticketPath, updates);
  rewriteIndexRow(cand.id, status);
}

// --- dispatch a single ticket --------------------------------------------------

async function dispatch(cand, flags) {
  const id = cand.id;
  const shortTitle = cand.title.length > 60 ? cand.title.slice(0, 57) + '…' : cand.title;
  const log = (m) => console.log(`[${id}] ${m}`);

  log(`starting → branch ticket/${id} (${cand.priority}/${cand.type})`);
  moveTicket(cand, 'in-progress', cand.prUrl ? { prUrl: cand.prUrl } : {});
  if (cand.prUrl) delete cand.prUrl;

  let wtDir, branch;
  try {
    ({ wtDir, branch } = setupWorktree(id));
  } catch (e) {
    log(`FAILED to set up worktree: ${e.message}`);
    moveTicket(cand, 'failed', { failedReason: `worktree: ${e.message}` });
    return { id, ok: false, reason: e.message };
  }

  copySecrets(wtDir);
  const stagedTicket = stageTicket(wtDir, cand);

  mkdirSync(logsDir, { recursive: true });
  const jsonLog = path.join(logsDir, `${id}.jsonl`);
  const errLog = path.join(logsDir, `${id}.err.log`);
  rmSync(jsonLog, { force: true }); rmSync(errLog, { force: true });

  const instruction =
    `Implement ticket ${id}. The ticket is attached and copied to .opencode/plans/${cand.file} in this ` +
    `checkout (gitignored). Acceptance Criteria = definition of done; Scope — Out is binding; follow AGENTS.md. ` +
    `Run typecheck/test/lint and the frontend build in touched packages, fix what they flag, then commit on this ` +
    `branch. Do NOT push, do NOT open a PR, do NOT touch .env.`;

  log(`agent running (${agentName}, worktree ${path.relative(root, wtDir)})…`);
  const t0 = Date.now();
  const res = await runAsync('opencode', ['run', '--format', 'json', '--agent', agentName, '--dir', wtDir, '--auto',
    '--file', stagedTicket, '--title', `${id}: ${cand.title.slice(0, 60)}`, instruction],
    { cwd: root, outFile: jsonLog, errFile: errLog });
  const minutes = ((Date.now() - t0) / 60000).toFixed(1);

  const ahead = sh('git', ['rev-list', '--count', `${baseBranch}..HEAD`], { cwd: wtDir });
  const commits = Number(ahead.code === 0 ? ahead.out : 0) || 0;

  if (res.code === 0 && commits > 0) {
    log(`agent done in ${minutes}m with ${commits} commit(s) → pushing + PR`);
    if (flags.noPr) {
      log(`--no-pr: left worktree at ${path.relative(root, wtDir)}; ticket stays in-progress. Finish with:`);
      log(`  git -C ${path.relative(root, wtDir)} push -u origin ${branch} && gh pr create --base ${baseBranch} --head ${branch} --title "${id}: ${shortTitle}"`);
      return { id, ok: true, noPr: true, wtDir };
    }
    const push = sh('git', ['push', '-u', 'origin', branch], { cwd: wtDir });
    if (push.code !== 0) {
      log(`FAILED to push: ${push.err || push.out}`);
      moveTicket(cand, 'failed', { failedReason: `push failed` });
      if (!flags.keepFailed) removeWorktree(wtDir);
      return { id, ok: false, reason: 'push failed' };
    }
    const bodyFile = path.join(logsDir, `${id}-pr.md`);
    const body =
      `Implements **${id}** (${cand.priority}, ${cand.type}).\n\n` +
      `> **${cand.title}**\n\n` +
      `Source: refined ticket \`.opencode/plans/${cand.file}\` (local backlog).\n\n` +
      `_Auto-generated by \`scripts/dispatch-tickets.mjs\` — please review before merging._`;
    writeFileSync(bodyFile, body);
    const pr = sh('gh', ['pr', 'create', '--base', baseBranch, '--head', branch, '--title', `${id}: ${cand.title}`,
      '--body-file', bodyFile], { cwd: root });
    if (pr.code !== 0) {
      log(`PR created-branch pushed but gh pr create failed: ${pr.err || pr.out}`);
      moveTicket(cand, 'failed', { failedReason: `gh pr create failed (branch pushed)` });
      if (!flags.keepFailed) removeWorktree(wtDir);
      return { id, ok: false, reason: 'pr create failed' };
    }
    const url = pr.out.trim();
    moveTicket(cand, 'pr-open', { prUrl: url });
    log(`PR: ${url}`);
    removeWorktree(wtDir);
    return { id, ok: true, pr: url };
  }

  const reason = res.code !== 0 ? `agent exited ${res.code} (see ${path.relative(root, errLog)})` : 'agent finished with no commits';
  log(`FAILED after ${minutes}m: ${reason}`);
  moveTicket(cand, 'failed', { failedReason: reason });
  if (!flags.keepFailed) {
    removeWorktree(wtDir);
    log('worktree removed; transcript kept at ' + path.relative(root, jsonLog));
  } else {
    log(`--keep-failed: worktree left at ${path.relative(root, wtDir)}`);
  }
  return { id, ok: false, reason };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const candidates = loadCandidates(flags);

  if (candidates.length === 0) {
    console.log(`No runnable tickets (status ${flags.status}${flags.includeFailed ? ' or failed' : ''}${flags.priority ? `, priority ${flags.priority}` : ''}). Refine more with the refine-ticket skill, or adjust filters.`);
    process.exit(0);
  }

  if (!flags.run) {
    console.log('DRY-RUN — nothing dispatched. Pass --run to execute.');
    console.log('Selected tickets:');
    for (const c of candidates) {
      console.log(`  • ${c.id}  [${c.priority}/${c.type}] ${c.title}\n      → branch ticket/${c.id}  ·  file .opencode/plans/${c.file}`);
    }
    process.exit(0);
  }

  console.log(`Fetching origin…`);
  sh('git', ['fetch', 'origin', '--quiet'], { cwd: root });

  const pre = sh('git', ['rev-parse', '--verify', '--quiet', baseBranch], { cwd: root });
  if (pre.code !== 0) { console.error(`No local branch ${baseBranch}.`); process.exit(1); }

  let next = 0;
  const results = [];
  const workers = [];
  const n = Math.min(flags.concurrency, candidates.length);
  const work = async () => {
    while (next < candidates.length) {
      const c = candidates[next++];
      results.push(await dispatch(c, flags));
    }
  };
  for (let i = 0; i < n; i++) workers.push(work());
  await Promise.all(workers);

  console.log('\nSummary:');
  for (const r of results) {
    console.log(r.ok ? `  ✓ ${r.id} → ${r.pr || 'worktree left (--no-pr)'}` : `  ✗ ${r.id} → ${r.reason}`);
  }
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} tickets succeeded. Review the PRs, merge, and delete branches — merged tickets you can flip to 'done' by hand (or I can add a flag).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
