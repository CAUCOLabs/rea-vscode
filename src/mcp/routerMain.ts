import { runRouterServer } from './routerServer';
const engineScript = process.argv[2];
void runRouterServer(engineScript).catch(error => { console.error(error); process.exitCode = 1; });
