import { launchProfile } from './src/browser.js';
import { observe, renderObservation } from './src/observe.js';
import { loadConfig } from './src/config.js';
import { chat } from './src/llm.js';
const cfg = loadConfig();
const { page, close } = await launchProfile({ profileDir:'./.agent-profile', headless:true });
await page.goto('https://github.com/trending', { waitUntil:'domcontentloaded' });
await page.waitForTimeout(2000);
const view = renderObservation(await observe(page));
console.log('browser STILL OPEN, calling chat()…');
const messages=[{role:'system',content:'Respond with one JSON action {"action":{"type":"done","answer":"..."}}'},{role:'user',content:`TASK: list repos\n\n${view}\n\nRespond with one action as JSON.`}];
const t=Date.now();
try{ const raw=await chat({...cfg,messages}); console.log('chat latency (browser open):', ((Date.now()-t)/1000).toFixed(1)+'s | reply:', raw.slice(0,50)); }
catch(e){ console.log('chat ERROR (browser open) after', ((Date.now()-t)/1000).toFixed(1)+'s:', e.message); }
await close();
