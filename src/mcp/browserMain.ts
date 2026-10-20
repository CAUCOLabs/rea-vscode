import { runBrowserServer } from './browserServer';
import { AgentBrowserManager } from '../services/agentBrowser';
import { startAnalysisBrowser } from '../services/analysisBrowser';
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--browser-executable')) throw new Error('Expected --browser-executable followed by an absolute browser path.');
void runBrowserServer(new AgentBrowserManager(options => startAnalysisBrowser({ ...options, executablePath: args[1] }))).catch(error => { console.error(error); process.exitCode = 1; });
