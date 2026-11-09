#!/usr/bin/env node
import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { launchProfile, connectCDP } from './src/browser.js';
import { runAgent } from './src/agent.js';
import { loadConfig } from './src/config.js';

function parseArgs(argv) {
  const args = { mode: 'profile', auto: false, task: null, startUrl: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cdp') args.mode = 'cdp';
    else if (a === '--auto') args.auto = true;
    else if (a === '--url') args.startUrl = argv[++i];
    else if (a === '--task') args.task = argv[++i];
    else if (!args.task) args.task = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  const cfg = loadConfig();

  const rl = readline.createInterface({ input: stdin, output: stdout });

  let task = args.task;
  if (!task) task = await rl.question('Task: ');

  const { page, context, close } =
    args.mode === 'cdp'
      ? await connectCDP()
      : await launchProfile({ profileDir: process.env.AGENT_PROFILE_DIR || './.agent-profile' });

  if (args.startUrl) {
    await page.goto(args.startUrl, { waitUntil: 'domcontentloaded' });
  } else if (page.url() === 'about:blank') {
    await page.goto('https://duckduckgo.com', { waitUntil: 'domcontentloaded' });
  }

  // Human-in-the-loop: confirm each action unless --auto.
  const confirm = args.auto
    ? null
    : async (action) => {
        const ans = await rl.question(`  run this? [Enter=yes / n=skip / q=quit] `);
        if (ans.trim().toLowerCase() === 'q') {
          throw new Error('quit by user');
        }
        return ans.trim().toLowerCase() !== 'n';
      };

  try {
    const answer = await runAgent({ page, context, task, cfg, confirm });
    console.log(`\n=== RESULT ===\n${answer}\n`);
  } catch (err) {
    console.error(`\nAgent stopped: ${err.message}`);
  } finally {
    rl.close();
    await close().catch(() => {});
  }
}

main();
