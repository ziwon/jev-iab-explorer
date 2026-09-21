import {writeFile} from 'node:fs/promises';
try {
  await writeFile(new URL('../.dev.vars',import.meta.url),`TYPESAFE_API_KEY=""\nYOUTUBE_API_KEY=""\nJEV_MODEL="jev-latest"\n`,{flag:'wx',mode:0o600});
  console.log('Created .dev.vars. Add your TypeSafe and YouTube Data API keys locally. Never paste those keys into the web UI.');
} catch(e) { if(e.code==='EEXIST') {console.error('.dev.vars already exists; not overwritten.');process.exitCode=1;} else throw e; }
