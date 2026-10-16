// Traverse only the production entry graph; prototype retains its own isolated fixtures.
import {it,expect} from 'vitest';
import fs from 'node:fs';import path from 'node:path';
it('production never imports prototype or demo fixtures',()=>{
 const seen=new Set<string>();const visit=(file:string)=>{if(seen.has(file))return;seen.add(file);const source=fs.readFileSync(file,'utf8');for(const m of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){if(!m[1].startsWith('.'))continue;const base=path.resolve(path.dirname(file),m[1]);const resolved=[base,base+'.ts',base+'.tsx',path.join(base,'index.ts'),path.join(base,'index.tsx')].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());if(resolved&&/\.tsx?$/.test(resolved))visit(resolved)}};
 visit(path.resolve('src/main.tsx'));expect([...seen].filter(p=>/\/prototype\/|\/data\/demo|retrieved-reports/.test(p))).toEqual([]);
});
