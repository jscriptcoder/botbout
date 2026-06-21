// Zero-dependency smoke test mirroring packages/engine (run: `node scripts/selftest.mjs`).
// The TypeScript in packages/engine is canonical; this is a convenience check so a
// fresh clone can prove the validator + interpreter work before any `npm install`.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dir = dirname(fileURLToPath(import.meta.url));

const LIMITS={maxBytes:16384,maxNodes:2000,maxDepth:32,maxRules:64,maxCells:16,intMin:-2147483648,intMax:2147483647};
const ALLOWED_FIELDS=new Set(["self.hp","self.stamina","self.x","self.facing","self.phaseRemaining","self.canAct","opponent.x","opponent.vx","opponent.distance","opponent.predictedDistance","opponent.hp","opponent.stamina","opponent.facing","opponent.staleness","opponent.phaseElapsed","opponent.moveRecoveryRemaining","ring.width","clock.tick","clock.ticksRemaining"]);
const MOVES=new Set(["punch","kick","grab","dodge"]),MOVE_STATS=new Set(["startup","active","recovery","damage","staminaCost","range","onBlock"]),PHASES=new Set(["idle","startup","active","recovery","blocking","stunned","dodging"]);
const CELL_RE=/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const isInt=x=>typeof x==="number"&&Number.isInteger(x);
const clampInt=x=>Math.max(LIMITS.intMin,Math.min(LIMITS.intMax,Math.trunc(x)));
function validate(doc){const issues=[];let nodeCount=0;const cells=new Set();const fail=(p,r)=>issues.push({path:p,reason:r});
 if(doc?.version!==1)fail("version","must be 1");if(typeof doc?.name!=="string")fail("name","string");
 if(doc?.memory)for(const k of Object.keys(doc.memory)){if(!CELL_RE.test(k))fail("memory."+k,"name");if(!isInt(doc.memory[k]))fail("memory."+k,"int");cells.add(k);}
 const num=(n,p,d)=>{if(++nodeCount>LIMITS.maxNodes)return fail(p,"nodes");if(d>LIMITS.maxDepth)return fail(p,"depth");if(!n||typeof n!=="object")return fail(p,"expr");switch(n.op){case "const":if(!isInt(n.value))fail(p,"int");break;case "field":if(!ALLOWED_FIELDS.has(n.path))fail(p,"field "+n.path);break;case "mem":if(!cells.has(n.cell))fail(p,"cell");break;case "rule":if(!MOVES.has(n.move))fail(p,"move");if(!MOVE_STATS.has(n.stat))fail(p,"stat");break;case "latency":if(n.of!=="action"&&n.of!=="position")fail(p,"lat");break;case "add":case "sub":case "mul":case "min":case "max":n.args.forEach((a,i)=>num(a,p+"."+i,d+1));break;case "div":n.args.forEach((a,i)=>num(a,p+"."+i,d+1));break;case "neg":case "abs":num(n.arg,p,d+1);break;default:fail(p,"op "+n.op);}};
 const bool=(n,p,d)=>{if(++nodeCount>LIMITS.maxNodes)return fail(p,"nodes");if(!n||typeof n!=="object")return fail(p,"cond");switch(n.op){case "gt":case "lt":case "gte":case "lte":case "eq":case "neq":n.args.forEach((a,i)=>num(a,p+"."+i,d+1));break;case "and":case "or":n.args.forEach((a,i)=>bool(a,p+"."+i,d+1));break;case "not":bool(n.arg,p,d+1);break;case "phase":if(!PHASES.has(n.is))fail(p,"phase");break;case "move_is":if(n.move!==null&&!MOVES.has(n.move))fail(p,"move");break;default:fail(p,"bop "+n.op);}};
 const action=(a,p)=>{if(!a)return fail(p,"action");switch(a.type){case "idle":case "block":case "punch":case "kick":case "grab":break;case "move":if(![-1,0,1].includes(a.dir))fail(p,"dir");break;case "dodge":if(![-1,1].includes(a.dir))fail(p,"dir");break;default:fail(p,"act "+a.type);}};
 if(!Array.isArray(doc?.rules))fail("rules","arr");else doc.rules.forEach((r,i)=>{bool(r.when,"rules."+i,0);if(r.set)r.set.forEach(s=>{if(!cells.has(s.cell))fail("set","cell");num(s.to,"set",0);});if(r.do)action(r.do,"do");});
 action(doc?.default,"default");return {ok:issues.length===0,issues,nodeCount};}
const readField=(st,path)=>{const[g,k]=path.split(".");const v=st[g][k];return typeof v==="boolean"?(v?1:0):clampInt(v);};
function evalNum(n,st,R,mem){switch(n.op){case "const":return n.value;case "field":return readField(st,n.path);case "mem":return mem[n.cell]??0;case "rule":return R.moves[n.move][n.stat];case "latency":return R.latency[n.of];case "add":return clampInt(n.args.reduce((s,a)=>s+evalNum(a,st,R,mem),0));case "sub":return clampInt(n.args.slice(1).reduce((s,a)=>s-evalNum(a,st,R,mem),evalNum(n.args[0],st,R,mem)));case "mul":return clampInt(n.args.reduce((s,a)=>s*evalNum(a,st,R,mem),1));case "min":return clampInt(Math.min(...n.args.map(a=>evalNum(a,st,R,mem))));case "max":return clampInt(Math.max(...n.args.map(a=>evalNum(a,st,R,mem))));case "div":{const b=evalNum(n.args[1],st,R,mem);return b===0?0:clampInt(evalNum(n.args[0],st,R,mem)/b);}case "neg":return clampInt(-evalNum(n.arg,st,R,mem));case "abs":return clampInt(Math.abs(evalNum(n.arg,st,R,mem)));}}
function evalBool(n,st,R,mem){switch(n.op){case "gt":return evalNum(n.args[0],st,R,mem)>evalNum(n.args[1],st,R,mem);case "lt":return evalNum(n.args[0],st,R,mem)<evalNum(n.args[1],st,R,mem);case "gte":return evalNum(n.args[0],st,R,mem)>=evalNum(n.args[1],st,R,mem);case "lte":return evalNum(n.args[0],st,R,mem)<=evalNum(n.args[1],st,R,mem);case "eq":return evalNum(n.args[0],st,R,mem)===evalNum(n.args[1],st,R,mem);case "neq":return evalNum(n.args[0],st,R,mem)!==evalNum(n.args[1],st,R,mem);case "and":return n.args.every(a=>evalBool(a,st,R,mem));case "or":return n.args.some(a=>evalBool(a,st,R,mem));case "not":return !evalBool(n.arg,st,R,mem);case "phase":return st[n.who].phase===n.is;case "move_is":return (st[n.who].move??null)===n.move;}}
function runTick(doc,st,R,mem){for(const rule of doc.rules){if(!evalBool(rule.when,st,R,mem))continue;if(rule.set)for(const s of rule.set)mem[s.cell]=clampInt(evalNum(s.to,st,R,mem));if(rule.do)return rule.do;}return doc.default;}

const R={moves:{punch:{startup:4,active:2,recovery:6,damage:6,staminaCost:5,range:60,onBlock:-2},kick:{startup:10,active:3,recovery:14,damage:16,staminaCost:14,range:110,onBlock:-8},grab:{startup:8,active:2,recovery:18,damage:14,staminaCost:12,range:55,onBlock:0},dodge:{startup:3,active:0,recovery:8,damage:0,staminaCost:18,range:0,onBlock:0}},latency:{action:6,position:1}};
const bot=JSON.parse(readFileSync(join(__dir,"../packages/engine/examples/footsie-spacer.json"),"utf8"));

let pass=0,failc=0;
const assert=(cond,msg)=>{if(cond){pass++;}else{failc++;console.error("  ✗",msg);}};
const v=validate(bot);
assert(v.ok,"example bot validates");
const base={self:{hp:100,stamina:100,x:0,facing:1,phaseRemaining:0,canAct:true,phase:"idle",move:null},opponent:{x:50,vx:0,distance:50,predictedDistance:50,hp:100,stamina:100,facing:-1,staleness:6,phaseElapsed:0,moveRecoveryRemaining:0,phase:"idle",move:null},ring:{width:600},clock:{tick:0,maxTicks:3600,ticksRemaining:3600}};
const mem={oppAttacks:0};
const run=patch=>{const st=structuredClone(base);Object.assign(st.self,patch.self||{});Object.assign(st.opponent,patch.opponent||{});return runTick(bot,st,R,mem);};
assert(run({}).type==="grab","turtle-buster grabs a never-attacked opponent in range");
run({opponent:{move:"kick",phase:"active",phaseElapsed:0,x:90,predictedDistance:90}});
assert(mem.oppAttacks===1,"tracker counted one opponent attack");
assert(run({}).type==="punch","switches to punch after witnessing offense");
assert(run({opponent:{move:"kick",phase:"startup",x:100,predictedDistance:100}}).type==="block","reaction-blocks a telegraphed kick");
assert(run({opponent:{phase:"recovery",move:"kick",moveRecoveryRemaining:12}}).type==="punch","whiff-punishes a recovering kick");
assert(run({self:{stamina:14}}).type==="move","retreats when gassed");
// validator rejects malicious docs
assert(!validate({version:1,name:"x",rules:[{when:{op:"gt",args:[{op:"field",path:"process.env"},{op:"const",value:0}]},do:{type:"idle"}}],default:{type:"idle"}}).ok,"rejects disallowed field");
assert(!validate({version:1,name:"x",rules:[{when:{op:"exec",cmd:"rm"},do:{type:"idle"}}],default:{type:"idle"}}).ok,"rejects unknown op");
console.log(`\n${failc===0?"PASS":"FAIL"} — ${pass} passed, ${failc} failed`);
process.exit(failc===0?0:1);
